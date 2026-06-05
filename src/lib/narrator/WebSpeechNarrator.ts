import type {
  NarratorEngine,
  NarratorState,
  NarratorVoice,
  NarrationUnit,
} from "./types";

// Read-aloud narration on the browser's built-in SpeechSynthesis API. Zero
// dependencies, works in all modern browsers.
//
// Core technique: speak ONE utterance per sentence (the units the reader hands
// us already follow splitSentences boundaries, so each utterance maps 1:1 to a
// sentence sid). This:
//   - keeps utterances short, dodging Chrome's ~200-char single-utterance cutoff;
//   - gives sentence-level highlight sync for free (currentSid = the unit speaking);
//   - lets word-level sync ride on utterance.onboundary within the sentence.
//
// FUTURE — KokoroNarrator: a neural engine (kokoro-js, Apache-2.0) implementing
// the same NarratorEngine interface would slot in here. It takes the identical
// NarrationUnit[] input, synthesizes audio per sentence via WebGPU/WASM, plays
// through Web Audio, and emits currentWordRange from the timestamped model
// (onnx-community/Kokoro-82M-v1.0-ONNX-timestamped) instead of onboundary. The
// reader never learns which engine it's using.

// Word segmenter for deriving a word's end when onboundary omits charLength.
const wordSeg =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("en", { granularity: "word" })
    : null;

export class WebSpeechNarrator implements NarratorEngine {
  readonly id = "web-speech" as const;

  private synth: SpeechSynthesis | null =
    typeof window !== "undefined" && "speechSynthesis" in window
      ? window.speechSynthesis
      : null;

  private state: NarratorState = {
    playing: false,
    currentSid: null,
    currentWordRange: null,
    voices: [],
    voiceId: null,
    rate: 1,
    supported: false,
  };

  private subscribers = new Set<(s: NarratorState) => void>();
  private rawVoices: SpeechSynthesisVoice[] = [];
  private units: NarrationUnit[] = [];
  private cursor = 0;
  private current: SpeechSynthesisUtterance | null = null;
  private onVoicesChanged = () => this.loadVoices();

  constructor() {
    if (!this.synth) return;
    this.state.supported = true;
    this.loadVoices();
    // Chrome populates voices asynchronously.
    this.synth.addEventListener("voiceschanged", this.onVoicesChanged);
  }

  // ---- state plumbing ----------------------------------------------------

  getState(): NarratorState {
    return this.state;
  }

  subscribe(cb: (s: NarratorState) => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private emit(patch: Partial<NarratorState>) {
    this.state = { ...this.state, ...patch };
    for (const cb of this.subscribers) cb(this.state);
  }

  private loadVoices() {
    if (!this.synth) return;
    this.rawVoices = this.synth.getVoices();
    const voices: NarratorVoice[] = this.rawVoices.map((v) => ({
      id: v.voiceURI,
      label: `${v.name} (${v.lang})`,
      lang: v.lang,
      isPremium: false,
    }));
    // Default to the first English local voice, else the first voice.
    let voiceId = this.state.voiceId;
    if (!voiceId && voices.length) {
      const en = this.rawVoices.find((v) => v.lang.toLowerCase().startsWith("en"));
      voiceId = (en ?? this.rawVoices[0]).voiceURI;
    }
    this.emit({ voices, voiceId });
  }

  private resolveVoice(): SpeechSynthesisVoice | null {
    return (
      this.rawVoices.find((v) => v.voiceURI === this.state.voiceId) ?? null
    );
  }

  // ---- playback ----------------------------------------------------------

  play(units: NarrationUnit[], fromSid?: string) {
    if (!this.synth) return;
    this.synth.cancel(); // clear any queued/in-flight utterance
    this.units = units;
    this.cursor = fromSid ? Math.max(0, units.findIndex((u) => u.sid === fromSid)) : 0;
    if (this.cursor >= units.length || !units.length) {
      this.stop();
      return;
    }
    this.emit({ playing: true });
    this.speakCurrent();
  }

  private speakCurrent() {
    if (!this.synth) return;
    const unit = this.units[this.cursor];
    if (!unit) {
      this.stop();
      return;
    }
    const u = new SpeechSynthesisUtterance(unit.text);
    u.rate = this.state.rate;
    const voice = this.resolveVoice();
    if (voice) u.voice = voice;

    u.onboundary = (e: SpeechSynthesisEvent) => {
      if (e.name !== "word") return;
      const start = e.charIndex;
      const end = this.wordEnd(unit.text, start, e.charLength);
      this.emit({ currentWordRange: { sid: unit.sid, start, end } });
    };

    u.onend = () => {
      // Ignore stale callbacks from a cancelled utterance.
      if (u !== this.current) return;
      this.cursor += 1;
      if (this.state.playing && this.cursor < this.units.length) {
        this.speakCurrent();
      } else {
        this.stop();
      }
    };

    u.onerror = (e: SpeechSynthesisErrorEvent) => {
      if (u !== this.current) return;
      // "interrupted"/"canceled" happen on our own cancel() — expected, ignore.
      if (e.error === "interrupted" || e.error === "canceled") return;
      // Otherwise skip the bad sentence so one failure doesn't wedge playback.
      this.cursor += 1;
      if (this.state.playing && this.cursor < this.units.length) this.speakCurrent();
      else this.stop();
    };

    this.current = u;
    this.emit({ currentSid: unit.sid, currentWordRange: null });
    this.synth.speak(u);
  }

  // Derive the end offset of the word starting at `start`. Web Speech often
  // provides charLength; when it doesn't (0/undefined), fall back to the word
  // segmenter (same approach as countWords), else to the next space.
  private wordEnd(text: string, start: number, charLength?: number): number {
    if (charLength && charLength > 0) return start + charLength;
    if (wordSeg) {
      for (const seg of wordSeg.segment(text.slice(start))) {
        if (seg.isWordLike) return start + seg.segment.length;
        // first segment is the word (boundary lands on word start)
        return start + seg.segment.length;
      }
    }
    const sp = text.indexOf(" ", start);
    return sp === -1 ? text.length : sp;
  }

  pause() {
    if (!this.synth || !this.state.playing) return;
    this.synth.pause();
    this.emit({ playing: false });
  }

  resume() {
    if (!this.synth) return;
    this.synth.resume();
    this.emit({ playing: true });
  }

  stop() {
    if (!this.synth) return;
    this.current = null;
    this.synth.cancel();
    this.cursor = 0;
    this.emit({ playing: false, currentSid: null, currentWordRange: null });
  }

  // Web Speech can't retune an in-flight utterance, so apply the new rate/voice
  // by seamlessly restarting the CURRENT sentence (re-reads the current line).
  private restartCurrent() {
    if (!this.synth || !this.state.playing) return;
    this.synth.cancel();
    this.speakCurrent();
  }

  setRate(mult: number) {
    this.emit({ rate: mult });
    this.restartCurrent();
  }

  setVoice(id: string) {
    this.emit({ voiceId: id });
    this.restartCurrent();
  }

  dispose() {
    if (this.synth) {
      this.synth.cancel();
      this.synth.removeEventListener("voiceschanged", this.onVoicesChanged);
    }
    this.subscribers.clear();
  }
}
