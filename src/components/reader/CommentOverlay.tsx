"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useCallback,
} from "react";
import type { HighlightData } from "@/lib/types";
import styles from "./Reader.module.css";

interface Note {
  id: string;
  startSid: string; // anchor sentence — used to jump/scroll to the comment
  top: number; // natural px top relative to the scroller, before collision fixup
  side: "left" | "right"; // which margin this note sits in
  comments: HighlightData["comments"];
  color: string;
}

// Below this viewport width the margins can't hold a card clear of the reading
// column (66ch column + a ~15rem card + gaps each side ≈ 72rem); fall back to
// compact in-flow markers that expand on tap.
const NARROW_QUERY = "(max-width: 72rem)";
// Minimum vertical gap kept between two stacked cards on the same side.
const STACK_GAP = 10;

// Margin comments (Word/Google-Docs style). For every highlight that has
// comments we render a card in the margin beside it, vertically aligned to the
// start of the highlight and showing the comment text directly (readable as soon
// as it's posted). Cards alternate margins — first right, next left, and so on.
// Same-side cards that would overlap are stacked downward. Each card carries
// prev/next arrows that scroll to the adjacent comment. On narrow screens the
// cards collapse to tappable markers.
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
  const [notes, setNotes] = useState<Note[]>([]);
  const [narrow, setNarrow] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null); // expanded marker (narrow)
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const recompute = useCallback(() => {
    const content = contentRef.current;
    const scroller = scrollerRef.current;
    if (!content || !scroller) return;
    const scrollerTop = scroller.getBoundingClientRect().top;

    // Resolve each commented highlight to its on-screen vertical position, drop
    // any whose start sentence isn't rendered, then order top-to-bottom so the
    // left/right alternation reads naturally down the page.
    const positioned = highlights
      .filter((h) => h.comments.length > 0)
      .map((h) => {
        const span = content.querySelector<HTMLElement>(
          `[data-sid="${CSS.escape(h.startSid)}"]`
        );
        if (!span) return null;
        return {
          id: h.id,
          startSid: h.startSid,
          top: span.getBoundingClientRect().top - scrollerTop,
          comments: h.comments,
          color: h.color,
        };
      })
      .filter((n): n is Omit<Note, "side"> => n !== null)
      .sort((a, b) => a.top - b.top);

    // Assign alternating sides, then push same-side cards down so they don't
    // overlap. Heights come from the already-rendered cards (persisted by id);
    // on the very first paint they're unmeasured (0) and the next recompute —
    // which fires on the restore scroll / resize — settles them.
    const bottoms: Record<"left" | "right", number> = {
      left: -Infinity,
      right: -Infinity,
    };
    setNotes(
      positioned.map((n, i) => {
        const side: "left" | "right" = i % 2 === 0 ? "right" : "left";
        const h = cardRefs.current.get(n.id)?.offsetHeight ?? 0;
        const top = Math.max(n.top, bottoms[side] + STACK_GAP);
        bottoms[side] = top + h;
        return { ...n, side, top };
      })
    );
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

  // After the cards mount, run one more pass so the first paint's unmeasured
  // heights are replaced by real ones (stacking settles without a visible jump).
  useLayoutEffect(() => {
    if (!narrow && notes.length) recompute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes.length, narrow]);

  // Scroll the comment at `index` (in reading order) into the centre of view.
  const jumpTo = useCallback(
    (index: number) => {
      const n = notes[index];
      if (!n) return;
      const span = contentRef.current?.querySelector<HTMLElement>(
        `[data-sid="${CSS.escape(n.startSid)}"]`
      );
      span?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (narrow) setOpenId(n.id);
    },
    [notes, contentRef, narrow]
  );

  if (!notes.length) return null;

  // Prev/next arrows shared by both layouts. `i` is the note's reading-order index.
  const arrows = (i: number) => (
    <div className={styles.noteNav}>
      <button
        className={styles.noteNavBtn}
        onClick={() => jumpTo(i - 1)}
        disabled={i === 0}
        aria-label="Previous comment"
      >
        ←
      </button>
      <button
        className={styles.noteNavBtn}
        onClick={() => jumpTo(i + 1)}
        disabled={i === notes.length - 1}
        aria-label="Next comment"
      >
        →
      </button>
    </div>
  );

  if (narrow) {
    return (
      <>
        {notes.map((n, i) => (
          <div
            key={n.id}
            className={styles.noteMarkerWrap}
            style={{ top: n.top }}
          >
            <button
              className={`${styles.noteMarker} ${styles[`noteDot_${n.color}`]}`}
              onClick={() => setOpenId(openId === n.id ? null : n.id)}
              aria-label="Comment"
            />
            {openId === n.id && (
              <div className={`${styles.noteCard} ${styles.notePopover}`}>
                {n.comments.map((c) => (
                  <p key={c.id}>{c.body}</p>
                ))}
                {arrows(i)}
              </div>
            )}
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      {notes.map((n, i) => (
        <div
          key={n.id}
          ref={(el) => {
            if (el) cardRefs.current.set(n.id, el);
            else cardRefs.current.delete(n.id);
          }}
          className={`${styles.noteCard} ${
            n.side === "left" ? styles.noteLeft : styles.noteRight
          } ${styles[`noteAccent_${n.color}`]}`}
          style={{ top: n.top }}
        >
          {n.comments.map((c) => (
            <p key={c.id}>{c.body}</p>
          ))}
          {arrows(i)}
        </div>
      ))}
    </>
  );
}
