// The narrator abstraction. The reader talks ONLY to NarratorEngine, so the
// concrete speech backend is swappable. Today the only implementation is
// WebSpeechNarrator (window.speechSynthesis). A future KokoroNarrator (neural,
// in-browser via WebGPU/WASM — see the README in WebSpeechNarrator.ts) would
// implement this same interface unchanged: same NarrationUnit input, same state
// shape, emitting currentWordRange from per-word timestamps instead of the Web
// Speech `onboundary` event.

/** A word sub-range within the currently-spoken sentence span's text node. */
export interface WordRange {
  sid: string; // "blockIndex:sentenceIndex" — which sentence span
  start: number; // char offset into that sentence's text
  end: number;
}

/** A selectable voice for the active engine. */
export interface NarratorVoice {
  id: string; // stable key (voiceURI for Web Speech)
  label: string; // e.g. "Samantha (en-US)"
  lang: string;
  isPremium: boolean; // false for Web Speech; true for future neural voices
}

/** One sentence the narrator can speak, in reading order. */
export interface NarrationUnit {
  sid: string;
  text: string;
}

export interface NarratorState {
  playing: boolean;
  currentSid: string | null; // sentence currently being spoken
  currentWordRange: WordRange | null; // null when word boundaries are unavailable
  voices: NarratorVoice[];
  voiceId: string | null;
  rate: number; // playback multiplier, mirrors useScrollEngine SPEEDS
  supported: boolean; // engine usable in this browser
}

export interface NarratorEngine {
  readonly id: "web-speech" | "kokoro";
  /** Start speaking. `units` is the full list; cursor starts at fromSid (or 0). */
  play(units: NarrationUnit[], fromSid?: string): void;
  pause(): void;
  resume(): void;
  stop(): void; // full teardown; clears current sid/word
  setRate(mult: number): void;
  setVoice(id: string): void;
  getState(): NarratorState;
  /** Subscribe to state changes; returns an unsubscribe fn. */
  subscribe(cb: (s: NarratorState) => void): () => void;
  dispose(): void; // remove listeners (voiceschanged etc.)
}
