import { useCallback, useEffect, useRef, useState } from "react";

// Continuous auto-scroll driven by a single rAF loop. Speed is expressed as a
// playback multiplier (0.75x, 1x, 1.25x, …) where 1x is a comfortable baseline
// reading pace. Internally the multiplier maps to px/sec via the document's
// measured word density (scrollHeight / wordCount). Delta-time based, so it runs
// identically on 60Hz and 120Hz/ProMotion displays. All live state is in refs to
// avoid stale closures; React state mirrors only what the UI needs to display.

// 1x baseline reading pace, in words per minute. The published API is the
// multiplier; this constant just anchors what "1x" feels like.
const BASE_WPM = 260;
export const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const;
const DEFAULT_SPEED = 1;
const MAX_DELTA_MS = 50; // clamp background-tab gaps so resume doesn't jump

export interface ScrollEngine {
  playing: boolean;
  speed: number; // playback multiplier, e.g. 1.5
  speeds: readonly number[];
  toggle: () => void;
  play: () => void;
  pause: () => void;
  setSpeed: (mult: number) => void;
  stepSpeed: (dir: 1 | -1) => void;
}

type Speed = (typeof SPEEDS)[number];

// Snap an arbitrary multiplier to the nearest supported step. Exported so the
// reader can own a single shared rate value across scroll + narration.
export function snap(mult: number): Speed {
  let best: Speed = SPEEDS[0];
  let bestDist = Infinity;
  for (const s of SPEEDS) {
    const d = Math.abs(s - mult);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

// Step a multiplier to the adjacent supported speed (clamped at the ends).
// Shared by the scroll engine and the narrator so ↑/↓ feel identical in both.
export function stepSpeedValue(mult: number, dir: 1 | -1): number {
  const cur = SPEEDS.indexOf(snap(mult));
  const next = Math.max(0, Math.min(SPEEDS.length - 1, cur + dir));
  return SPEEDS[next];
}

export function useScrollEngine(
  scrollerRef: React.RefObject<HTMLElement | null>,
  wordCount: number
): ScrollEngine {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<number>(DEFAULT_SPEED);

  const playingRef = useRef(false);
  const speedRef = useRef(DEFAULT_SPEED);
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
    return ((BASE_WPM * speedRef.current) / 60) * pxPerWord;
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

  const setSpeed = useCallback((mult: number) => {
    const snapped = snap(mult);
    speedRef.current = snapped;
    setSpeedState(snapped);
  }, []);

  // Step to the adjacent supported speed (clamped at the ends).
  const stepSpeed = useCallback((dir: 1 | -1) => {
    const i = SPEEDS.indexOf(speedRef.current as Speed);
    const cur = i === -1 ? SPEEDS.indexOf(snap(speedRef.current)) : i;
    const next = Math.max(0, Math.min(SPEEDS.length - 1, cur + dir));
    const snapped = SPEEDS[next];
    speedRef.current = snapped;
    setSpeedState(snapped);
  }, []);

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

  return { playing, speed, speeds: SPEEDS, toggle, play, pause, setSpeed, stepSpeed };
}
