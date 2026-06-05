import { useCallback, useEffect, useRef, useState } from "react";
import { WebSpeechNarrator } from "@/lib/narrator/WebSpeechNarrator";
import type {
  NarratorEngine,
  NarratorState,
  NarratorVoice,
  NarrationUnit,
  WordRange,
} from "@/lib/narrator/types";

// React wrapper around a NarratorEngine, analogous to useScrollEngine. Owns one
// engine instance for the component's lifetime and mirrors its state into React.
// Engine-agnostic: swapping in a future KokoroNarrator is a one-line change of
// which class is constructed below.

export interface NarratorApi {
  supported: boolean;
  playing: boolean;
  currentSid: string | null;
  currentWordRange: WordRange | null;
  voices: NarratorVoice[];
  voiceId: string | null;
  rate: number;
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
  const engineRef = useRef<NarratorEngine | null>(null);
  if (engineRef.current === null && typeof window !== "undefined") {
    engineRef.current = new WebSpeechNarrator();
  }

  const [state, setState] = useState<NarratorState>(
    () =>
      engineRef.current?.getState() ?? {
        playing: false,
        currentSid: null,
        currentWordRange: null,
        voices: [],
        voiceId: null,
        rate: 1,
        supported: false,
      }
  );

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setState(engine.getState());
    const unsub = engine.subscribe(setState);
    return () => {
      unsub();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Chrome auto-pauses speech in backgrounded tabs; resume when we're visible
  // again and the engine still thinks it's playing.
  useEffect(() => {
    const onVis = () => {
      if (
        !document.hidden &&
        engineRef.current?.getState().playing &&
        typeof window !== "undefined" &&
        window.speechSynthesis?.paused
      ) {
        window.speechSynthesis.resume();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
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
    voices: state.voices,
    voiceId: state.voiceId,
    rate: state.rate,
    play,
    pause,
    resume,
    toggle,
    stop,
    setRate,
    setVoice,
  };
}
