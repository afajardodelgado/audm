import { useCallback, useEffect, useRef, useState } from "react";

// Continuous auto-scroll driven by a single rAF loop. Speed is expressed in
// words-per-minute and converted to px/sec using the document's measured word
// density (scrollHeight / wordCount). Delta-time based, so it runs identically
// on 60Hz and 120Hz/ProMotion displays. All live state is in refs to avoid
// stale closures; React state mirrors only what the UI needs to display.

const MIN_WPM = 80;
const MAX_WPM = 900;
const DEFAULT_WPM = 260;
const MAX_DELTA_MS = 50; // clamp background-tab gaps so resume doesn't jump

export interface ScrollEngine {
  playing: boolean;
  wpm: number;
  toggle: () => void;
  play: () => void;
  pause: () => void;
  setWpm: (n: number) => void;
  nudgeWpm: (delta: number) => void;
}

export function useScrollEngine(
  scrollerRef: React.RefObject<HTMLElement | null>,
  wordCount: number
): ScrollEngine {
  const [playing, setPlaying] = useState(false);
  const [wpm, setWpmState] = useState(DEFAULT_WPM);

  const playingRef = useRef(false);
  const wpmRef = useRef(DEFAULT_WPM);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const accumRef = useRef(0); // sub-pixel carry
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const pxPerSec = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || wordCount <= 0) return 0;
    const pxPerWord = el.scrollHeight / wordCount;
    return (wpmRef.current / 60) * pxPerWord;
  }, [scrollerRef, wordCount]);

  const tick = useCallback(
    (ts: number) => {
      const el = scrollerRef.current;
      if (!el || !playingRef.current) {
        rafRef.current = null;
        return;
      }
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = Math.min(ts - lastTsRef.current, MAX_DELTA_MS);
      lastTsRef.current = ts;

      accumRef.current += (pxPerSec() * dt) / 1000;
      const whole = Math.floor(accumRef.current);
      if (whole >= 1) {
        accumRef.current -= whole;
        const before = el.scrollTop;
        el.scrollTop = before + whole;
        // Reached the bottom — stop gracefully.
        if (el.scrollTop === before && el.scrollTop > 0) {
          playingRef.current = false;
          setPlaying(false);
          rafRef.current = null;
          return;
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    },
    [scrollerRef, pxPerSec]
  );

  const play = useCallback(() => {
    if (reducedMotion.current) return; // respect the user's OS setting
    if (playingRef.current) return;
    playingRef.current = true;
    setPlaying(true);
    lastTsRef.current = null;
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(tick);
    }
  }, [tick]);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const toggle = useCallback(() => {
    if (playingRef.current) pause();
    else play();
  }, [play, pause]);

  const setWpm = useCallback((n: number) => {
    const clamped = Math.max(MIN_WPM, Math.min(MAX_WPM, Math.round(n)));
    wpmRef.current = clamped;
    setWpmState(clamped);
  }, []);

  const nudgeWpm = useCallback(
    (delta: number) => setWpm(wpmRef.current + delta),
    [setWpm]
  );

  // Pause when the reader manually scrolls (wheel / touch / scroll keys), so the
  // engine never fights the user. Reconciliation is automatic — the next play()
  // reads the live scrollTop.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onUserScroll = () => {
      if (playingRef.current) pause();
    };
    el.addEventListener("wheel", onUserScroll, { passive: true });
    el.addEventListener("touchmove", onUserScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onUserScroll);
      el.removeEventListener("touchmove", onUserScroll);
    };
  }, [scrollerRef, pause]);

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return { playing, wpm, toggle, play, pause, setWpm, nudgeWpm };
}
