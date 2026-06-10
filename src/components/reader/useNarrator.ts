import { useCallback, useEffect, useRef, useState } from "react";
import { KokoroNarrator } from "@/lib/narrator/KokoroNarrator";
import type {
  ModelStatus,
  NarratorEngine,
  NarratorState,
  NarratorVoice,
  NarrationUnit,
  WordRange,
} from "@/lib/narrator/types";

// React wrapper around the NarratorEngine, analogous to useScrollEngine. Owns one
// engine instance (the neural Kokoro voice) for the component's lifetime and
// mirrors its state into React. The rest of the reader is engine-agnostic.

const EMPTY_STATE: NarratorState = {
  playing: false,
  currentSid: null,
  currentWordRange: null,
  voices: [],
  voiceId: null,
  rate: 1,
  supported: false,
  modelStatus: "idle",
  loadProgress: 0,
};

export interface NarratorApi {
  supported: boolean;
  playing: boolean;
  currentSid: string | null;
  currentWordRange: WordRange | null;
  rate: number;
  modelStatus: ModelStatus;
  loadProgress: number;
  voices: NarratorVoice[];
  voiceId: string | null;
  play: (units: NarrationUnit[], fromSid?: string) => void;
  pause: () => void;
  resume: () => void;
  /** Play if idle, resume if paused mid-sentence, pause if playing. */
  toggle: (getUnits: () => NarrationUnit[], fromSid?: string) => void;
  stop: () => void;
  setRate: (mult: number) => void;
  setVoice: (id: string) => void;
}

export function useNarrator(): NarratorApi {
  // The engine is created in the mount effect (never during render — refs must
  // not be written while rendering), so the first client render matches the
  // server-rendered EMPTY_STATE and the API below no-ops until mount.
  const engineRef = useRef<NarratorEngine | null>(null);
  const [state, setState] = useState<NarratorState>(EMPTY_STATE);

  useEffect(() => {
    const engine = new KokoroNarrator();
    engineRef.current = engine;
    // Initial sync from an external system (the engine constructed just
    // above) — same justified exception as in Reader.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(engine.getState());
    const unsub = engine.subscribe(setState);
    // Warm the model when the browser is idle so the first Play is instant. The
    // model is a module singleton and ensureModel is idempotent, so this is
    // wasted at most once per device (the download is browser-cached).
    const ric =
      typeof requestIdleCallback === "function"
        ? requestIdleCallback(() => engine.warmup?.())
        : (setTimeout(() => engine.warmup?.(), 1200) as unknown as number);
    return () => {
      if (typeof cancelIdleCallback === "function") cancelIdleCallback(ric);
      else clearTimeout(ric);
      unsub();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const play = useCallback((units: NarrationUnit[], fromSid?: string) => {
    engineRef.current?.play(units, fromSid);
  }, []);
  const pause = useCallback(() => engineRef.current?.pause(), []);
  const resume = useCallback(() => engineRef.current?.resume(), []);
  const stop = useCallback(() => engineRef.current?.stop(), []);
  const setRate = useCallback((m: number) => engineRef.current?.setRate(m), []);
  const setVoice = useCallback((id: string) => engineRef.current?.setVoice(id), []);

  const toggle = useCallback(
    (getUnits: () => NarrationUnit[], fromSid?: string) => {
      const engine = engineRef.current;
      if (!engine) return;
      const s = engine.getState();
      if (s.playing) engine.pause();
      else if (s.currentSid) engine.resume();
      else engine.play(getUnits(), fromSid);
    },
    []
  );

  return {
    supported: state.supported,
    playing: state.playing,
    currentSid: state.currentSid,
    currentWordRange: state.currentWordRange,
    rate: state.rate,
    modelStatus: state.modelStatus,
    loadProgress: state.loadProgress,
    voices: state.voices,
    voiceId: state.voiceId,
    play,
    pause,
    resume,
    toggle,
    stop,
    setRate,
    setVoice,
  };
}
