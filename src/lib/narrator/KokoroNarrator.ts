import type {
  NarratorEngine,
  NarratorState,
  NarratorVoice,
  NarrationUnit,
} from "./types";

// In-browser neural narration via kokoro-js (Apache-2.0). The sole
// NarratorEngine implementation; the reader talks only to the interface.
//
// Properties that shape this implementation:
//   - Synthesis is ASYNC and has real latency, so we PREFETCH the next couple of
//     sentences while the current one plays (the buffering feature).
//   - Audio is a generated PCM clip played through an HTMLAudioElement, which
//     gives playbackRate (cheap setRate, no re-synth), pause/play, and onended.
//   - kokoro-js@1.2.1 returns no per-word timestamps, so word-level highlight is
//     ESTIMATED: split the sentence with Intl.Segmenter and distribute the clip
//     duration across words by length, then emit ranges off the audio clock.
//
// The model is large; it downloads once and is cached by the browser, and we
// keep the loaded instance in a module-level singleton so reader remounts don't
// re-initialise it.

import type { KokoroTTS, GenerateOptions } from "kokoro-js";

const MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX";
const DEFAULT_VOICE = "af_heart";
const PREFETCH_AHEAD = 2; // synthesize this many sentences past the one playing

const wordSeg =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("en", { granularity: "word" })
    : null;

interface WordTiming {
  start: number; // char offset into the sentence text
  end: number;
  tStart: number; // seconds into the clip (at 1x)
  tEnd: number;
}

interface SynthResult {
  url: string; // object URL for the clip
  duration: number; // clip length in seconds (at 1x)
  words: WordTiming[];
}

// ---- module-level model singleton (survives reader remounts) ---------------

// onnxruntime-web's native (C++/WASM) layer prints two benign perf warnings to
// stderr at session init — "VerifyEachNodeIsAssignedToAnEp" (ORT pins shape ops
// to CPU on purpose). They aren't errors, but Next's dev overlay surfaces stderr
// as "Console Error". kokoro-js's from_pretrained doesn't expose ORT session
// options (no logSeverityLevel hook), and the JS-side env.logLevel doesn't gate
// the native logger — so we filter just these exact lines from the console. The
// patch is installed once and passes everything else through unchanged.
let ortFilterInstalled = false;
function silenceOrtNodeWarnings() {
  if (ortFilterInstalled || typeof console === "undefined") return;
  ortFilterInstalled = true;
  const isOrtNoise = (args: unknown[]) =>
    typeof args[0] === "string" &&
    args[0].includes("VerifyEachNodeIsAssignedToAnEp");
  for (const level of ["warn", "error"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      if (isOrtNoise(args)) return;
      orig(...args);
    };
  }
}

let modelPromise: Promise<KokoroTTS> | null = null;

async function loadModel(
  onProgress: (p: number) => void
): Promise<KokoroTTS> {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    silenceOrtNodeWarnings();
    const { KokoroTTS } = await import("kokoro-js");
    // Prefer WebGPU when available; fall back to threaded WASM otherwise.
    let device: "webgpu" | "wasm" = "wasm";
    try {
      const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
      if (gpu && (await gpu.requestAdapter())) device = "webgpu";
    } catch {
      /* no WebGPU — stay on wasm */
    }
    const dtype = device === "webgpu" ? "fp32" : "q8";
    const progress_callback = (info: { status?: string; progress?: number }) => {
      if (typeof info?.progress === "number") onProgress(info.progress / 100);
    };
    try {
      return await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype,
        device,
        progress_callback,
      });
    } catch (err) {
      if (device === "webgpu") {
        // WebGPU init can fail at runtime even when an adapter exists — retry on WASM.
        return await KokoroTTS.from_pretrained(MODEL_ID, {
          dtype: "q8",
          device: "wasm",
          progress_callback,
        });
      }
      throw err;
    }
  })();
  // Reset on failure so a later attempt can retry.
  modelPromise.catch(() => {
    modelPromise = null;
  });
  return modelPromise;
}

export class KokoroNarrator implements NarratorEngine {
  readonly id = "kokoro" as const;

  private state: NarratorState = {
    playing: false,
    currentSid: null,
    currentWordRange: null,
    voices: [],
    voiceId: DEFAULT_VOICE,
    rate: 1,
    supported: typeof window !== "undefined",
    modelStatus: "idle",
    loadProgress: 0,
  };

  private subscribers = new Set<(s: NarratorState) => void>();
  private tts: KokoroTTS | null = null;

  private units: NarrationUnit[] = [];
  private cursor = 0;
  private audio: HTMLAudioElement | null =
    typeof Audio !== "undefined" ? new Audio() : null;
  private cache = new Map<number, SynthResult>();
  private inFlight = new Map<number, Promise<SynthResult | null>>();
  private epoch = 0; // bumped on stop/seek/voice change to invalidate async work
  private rafId: number | null = null;

  constructor() {
    if (this.audio) {
      this.audio.preload = "auto";
    }
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

  // ---- model + voices ----------------------------------------------------

  private async ensureModel(): Promise<KokoroTTS | null> {
    if (this.tts) return this.tts;
    this.emit({ modelStatus: "loading", loadProgress: 0 });
    try {
      this.tts = await loadModel((p) => this.emit({ loadProgress: p }));
      this.loadVoices(this.tts);
      this.emit({ modelStatus: "ready", loadProgress: 1 });
      return this.tts;
    } catch {
      this.emit({ modelStatus: "error" });
      return null;
    }
  }

  private loadVoices(tts: KokoroTTS) {
    const raw = tts.voices as Record<
      string,
      { name?: string; language?: string; gender?: string }
    >;
    const voices: NarratorVoice[] = Object.entries(raw).map(([id, v]) => ({
      id,
      label: `${v.name ?? id}${v.gender ? ` (${v.gender})` : ""}`,
      lang: v.language ?? "en",
      isPremium: true,
    }));
    const voiceId =
      this.state.voiceId && raw[this.state.voiceId]
        ? this.state.voiceId
        : raw[DEFAULT_VOICE]
          ? DEFAULT_VOICE
          : (voices[0]?.id ?? null);
    this.emit({ voices, voiceId });
  }

  // ---- synthesis + buffering --------------------------------------------

  private async synth(index: number, epoch: number): Promise<SynthResult | null> {
    const cached = this.cache.get(index);
    if (cached) return cached;
    const existing = this.inFlight.get(index);
    if (existing) return existing;

    const unit = this.units[index];
    if (!unit || !this.tts) return null;

    const p = (async (): Promise<SynthResult | null> => {
      const voice = this.state.voiceId ?? DEFAULT_VOICE;
      // kokoro-js types `voice` as a union of literal voice ids; our voiceId is a
      // plain string sourced from the same voices map, so the cast is safe.
      const raw = await this.tts!.generate(unit.text, {
        voice,
      } as GenerateOptions);
      // Stale (stop/seek/voice change happened while synthesizing)? Discard.
      if (epoch !== this.epoch) return null;
      const blob = raw.toBlob();
      const url = URL.createObjectURL(blob);
      const duration = raw.audio.length / raw.sampling_rate;
      const words = estimateWordTimings(unit.text, duration);
      const result: SynthResult = { url, duration, words };
      this.cache.set(index, result);
      return result;
    })();

    this.inFlight.set(index, p);
    try {
      return await p;
    } finally {
      this.inFlight.delete(index);
    }
  }

  private prefetch(fromIndex: number) {
    const epoch = this.epoch;
    for (let i = fromIndex + 1; i <= fromIndex + PREFETCH_AHEAD; i++) {
      if (i < this.units.length && !this.cache.has(i) && !this.inFlight.has(i)) {
        void this.synth(i, epoch);
      }
    }
  }

  private evict(index: number) {
    const r = this.cache.get(index);
    if (r) {
      URL.revokeObjectURL(r.url);
      this.cache.delete(index);
    }
  }

  private clearCache() {
    for (const r of this.cache.values()) URL.revokeObjectURL(r.url);
    this.cache.clear();
    this.inFlight.clear();
  }

  // ---- playback ----------------------------------------------------------

  play(units: NarrationUnit[], fromSid?: string) {
    if (!this.audio) return;
    this.epoch += 1;
    this.clearCache();
    this.units = units;
    this.cursor = fromSid
      ? Math.max(0, units.findIndex((u) => u.sid === fromSid))
      : 0;
    if (!units.length || this.cursor >= units.length) {
      this.stop();
      return;
    }
    this.emit({ playing: true });
    void this.playCurrent();
  }

  private async playCurrent() {
    if (!this.audio) return;
    const tts = await this.ensureModel();
    if (!tts) {
      this.emit({ playing: false });
      return;
    }
    const epoch = this.epoch;
    const idx = this.cursor;
    const unit = this.units[idx];
    if (!unit) {
      this.stop();
      return;
    }
    this.emit({ currentSid: unit.sid, currentWordRange: null });

    const result = await this.synth(idx, epoch);
    // Bail if stopped/seeked while synthesizing, or playback was paused.
    if (epoch !== this.epoch || !this.state.playing || !result) return;

    const audio = this.audio;
    audio.src = result.url;
    audio.playbackRate = this.state.rate;
    audio.onended = () => {
      if (epoch !== this.epoch) return;
      this.stopScheduler();
      this.evict(idx);
      this.cursor += 1;
      if (this.state.playing && this.cursor < this.units.length) {
        void this.playCurrent();
      } else {
        this.stop();
      }
    };
    audio.onerror = () => {
      if (epoch !== this.epoch) return;
      // Skip a bad clip rather than wedging playback.
      this.stopScheduler();
      this.evict(idx);
      this.cursor += 1;
      if (this.state.playing && this.cursor < this.units.length) {
        void this.playCurrent();
      } else {
        this.stop();
      }
    };

    try {
      await audio.play();
    } catch {
      // Autoplay policy or interrupted load — treat as a pause.
      this.emit({ playing: false });
      return;
    }
    this.startScheduler(unit.sid, result.words);
    this.prefetch(idx);
  }

  // Drive word-level highlight off the audio clock (rate-correct: currentTime
  // already advances at playbackRate).
  private startScheduler(sid: string, words: WordTiming[]) {
    this.stopScheduler();
    if (!this.audio || !words.length) return;
    let lastStart = -1;
    const tick = () => {
      if (!this.audio) return;
      const t = this.audio.currentTime;
      const w = words.find((w) => t >= w.tStart && t < w.tEnd);
      if (w && w.start !== lastStart) {
        lastStart = w.start;
        this.emit({ currentWordRange: { sid, start: w.start, end: w.end } });
      }
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopScheduler() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  pause() {
    if (!this.audio || !this.state.playing) return;
    this.audio.pause();
    this.stopScheduler();
    this.emit({ playing: false });
  }

  resume() {
    if (!this.audio) return;
    void this.audio.play().catch(() => {});
    this.emit({ playing: true });
    // Re-arm the scheduler for the current sentence if we have its timings.
    const r = this.cache.get(this.cursor);
    const unit = this.units[this.cursor];
    if (r && unit) this.startScheduler(unit.sid, r.words);
  }

  stop() {
    this.epoch += 1;
    this.stopScheduler();
    if (this.audio) {
      this.audio.pause();
      this.audio.onended = null;
      this.audio.onerror = null;
      this.audio.removeAttribute("src");
      this.audio.load();
    }
    this.clearCache();
    this.cursor = 0;
    this.emit({ playing: false, currentSid: null, currentWordRange: null });
  }

  setRate(mult: number) {
    this.emit({ rate: mult });
    // Cheap: retune the in-flight clip, no re-synth.
    if (this.audio) this.audio.playbackRate = mult;
  }

  setVoice(id: string) {
    this.emit({ voiceId: id });
    // Voice change requires re-synth: invalidate buffer and restart the current
    // sentence in the new voice if we're playing.
    this.epoch += 1;
    this.clearCache();
    if (this.state.playing) void this.playCurrent();
  }

  dispose() {
    this.stop();
    this.audio = null;
    this.subscribers.clear();
    // Leave the module-level model resident for the next mount.
  }
}

// Distribute a clip's duration across the sentence's words proportional to word
// length (longer words ≈ longer to say). Char offsets index into `text` so the
// reader can build a Range over the sentence span's single text node.
function estimateWordTimings(text: string, duration: number): WordTiming[] {
  const words: { start: number; end: number }[] = [];
  if (wordSeg) {
    let offset = 0;
    for (const seg of wordSeg.segment(text)) {
      const len = seg.segment.length;
      if (seg.isWordLike) words.push({ start: offset, end: offset + len });
      offset += len;
    }
  }
  if (!words.length) return [];
  const totalChars = words.reduce((n, w) => n + (w.end - w.start), 0) || 1;
  let acc = 0;
  return words.map((w) => {
    const share = (w.end - w.start) / totalChars;
    const tStart = acc * duration;
    acc += share;
    const tEnd = acc * duration;
    return { ...w, tStart, tEnd };
  });
}
