"use client";

import { useEffect, useState, useCallback } from "react";
import type { HighlightData } from "@/lib/types";
import styles from "./Reader.module.css";

interface Marker {
  id: string;
  top: number; // px relative to scroller content
  comments: HighlightData["comments"];
  color: string;
}

// Word-style margin notes: for each highlighted range that has comments, place
// a marker in the right margin aligned to the start of the highlight. Positions
// are recomputed on scroll/resize from the start sentence span's rect.
export default function CommentOverlay({
  highlights,
  contentRef,
  scrollerRef,
  ready,
}: {
  highlights: HighlightData[];
  contentRef: React.RefObject<HTMLElement | null>;
  scrollerRef: React.RefObject<HTMLElement | null>;
  ready: boolean;
}) {
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const recompute = useCallback(() => {
    const content = contentRef.current;
    const scroller = scrollerRef.current;
    if (!content || !scroller) return;
    const withComments = highlights.filter((h) => h.comments.length > 0);
    const scrollerTop = scroller.getBoundingClientRect().top;

    const next: Marker[] = [];
    for (const h of withComments) {
      const span = content.querySelector<HTMLElement>(
        `[data-sid="${CSS.escape(h.startSid)}"]`
      );
      if (!span) continue;
      const r = span.getBoundingClientRect();
      // Viewport-relative top within the margin column (which is anchored under
      // the top bar). recompute() reruns on scroll, so this stays aligned.
      next.push({
        id: h.id,
        top: r.top - scrollerTop,
        comments: h.comments,
        color: h.color,
      });
    }
    setMarkers(next);
  }, [highlights, contentRef, scrollerRef]);

  useEffect(() => {
    if (!ready) return;
    recompute();
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.addEventListener("scroll", recompute, { passive: true });
    window.addEventListener("resize", recompute);
    return () => {
      scroller.removeEventListener("scroll", recompute);
      window.removeEventListener("resize", recompute);
    };
  }, [ready, recompute, scrollerRef]);

  return (
    <div className={styles.marginNotes}>
      {markers.map((m) => (
        <div
          key={m.id}
          className={styles.noteMarker}
          style={{ top: m.top }}
          onMouseEnter={() => setOpen(m.id)}
          onMouseLeave={() => setOpen(null)}
        >
          <span
            className={`${styles.noteDot} ${styles[`sw_${m.color}`]}`}
            aria-label="Note"
          />
          {open === m.id && (
            <div className={styles.noteCard}>
              {m.comments.map((c) => (
                <p key={c.id}>{c.body}</p>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
