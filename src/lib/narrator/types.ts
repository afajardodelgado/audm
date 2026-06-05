// The narrator abstraction. The reader talks ONLY to NarratorEngine, so the
// concrete speech backend is swappable. The implementation is KokoroNarrator —
// a neural text-to-speech engine running 100% in-browser via WebGPU/WASM
// (kokoro-js, Apache-2.0) — which emits currentWordRange from per-word
// timestamps. Any future engine implements this same interface unchanged.

/** A word sub-range within the currently-spoken sentence span's text node. */
export interface WordRange {
  sid: string; // "blockIndex:sentenceIndex" — which sentence span
  start: number; // char offset into that sentence's text
  end: number;
}

/** A selectable voice for the engine. */
export interface NarratorVoice {
  id: string; // stable key
  label: string;
  lang: string;
  isPremium: boolean;
}

/** One sentence the narrator can speak, in reading order. */
export interface NarrationUnit {
  sid: string;
  text: string;
}

/** Lifecycle of the engine's model. The neural engine downloads/initialises its
 * model on first use, so it passes through "loading" (with loadProgress 0..1)
 * before "ready", or "error" on failure. */
export type ModelStatus = "idle" | "loading" | "ready" | "error";

export interface NarratorState {
  playing: boolean;
  currentSid: string | null; // sentence currently being spoken
  currentWordRange: WordRange | null; // null when word boundaries are unavailable
  voices: NarratorVoice[];
  voiceId: string | null;
  rate: number; // playback multiplier, mirrors useScrollEngine SPEEDS
  supported: boolean; // engine usable in this browser
  modelStatus: ModelStatus; // drives the neural-voice loading UI
  loadProgress: number; // 0..1 model download progress while loading
}

export interface NarratorEngine {
  readonly id: "kokoro";
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
  dispose(): void; // tear down audio + abort pending model/synthesis work
}
