import { useEffect, useRef, useState } from "react";

// Detects the sentence span intersecting a thin horizontal band at the centre
// of the scroller — the "current" reading line. Uses IntersectionObserver with
// negative top/bottom rootMargin (shrinking the root to a ~1% strip at centre),
// which runs off the main thread. When several spans sit in the band, the one
// whose centre is nearest the viewport centre wins.

export interface CurrentLine {
  sid: string | null; // "blockIndex:sentenceIndex"
  blockIndex: number | null;
  sentenceIndex: number | null;
}

export function useCurrentLine(
  scrollerRef: React.RefObject<HTMLElement | null>,
  contentRef: React.RefObject<HTMLElement | null>,
  ready: boolean
): CurrentLine {
  const [current, setCurrent] = useState<CurrentLine>({
    sid: null,
    blockIndex: null,
    sentenceIndex: null,
  });
  const inBand = useRef<Set<HTMLElement>>(new Set());

  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content || !ready) return;

    const pickBest = () => {
      const mid = scroller.clientHeight / 2 + scroller.getBoundingClientRect().top;
      let best: HTMLElement | null = null;
      let bestDist = Infinity;
      for (const el of inBand.current) {
        const r = el.getBoundingClientRect();
        const dist = Math.abs((r.top + r.bottom) / 2 - mid);
        if (dist < bestDist) {
          bestDist = dist;
          best = el;
        }
      }
      if (!best) return;
      const sid = best.dataset.sid ?? null;
      if (!sid) return;
      const [bi, si] = sid.split(":").map(Number);
      setCurrent((prev) =>
        prev.sid === sid ? prev : { sid, blockIndex: bi, sentenceIndex: si }
      );
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (e.isIntersecting) inBand.current.add(el);
          else inBand.current.delete(el);
        }
        pickBest();
      },
      {
        root: scroller,
        // Shrink the root to a ~1%-tall band at vertical centre.
        rootMargin: "-50% 0px -49% 0px",
        threshold: 0,
      }
    );

    const spans = content.querySelectorAll<HTMLElement>("[data-sid]");
    spans.forEach((s) => observer.observe(s));

    return () => observer.disconnect();
  }, [scrollerRef, contentRef, ready]);

  return current;
}
