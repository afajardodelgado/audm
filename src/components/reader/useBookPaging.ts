"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Paging for the Book view: the article flows into fixed-height columns that
// overflow horizontally, and we translate it one viewport ("spread") at a
// time — the CSS-multicolumn pagination technique EPUB renderers (epub.js,
// Readium) use, applied to our own typeset blocks.
//
// The geometry is computed HERE in whole pixels and written as inline styles,
// exactly like epub.js's layout.js — pure-CSS column math (column-count +
// clamp() padding/gap) makes the column stride disagree with the translation
// stride by a few px per spread, which accumulates into mid-column page
// boundaries deep into a book. The invariant: with outer margin M, gutter
// G = 2M, k columns per spread of width C/k − 2M, and content width
// k·colW + (k−1)·G, every column period is exactly C/k — so translating by
// n·C stays flush forever and the visible spread sits symmetric (edges at M,
// centre gutter 2M).
export function useBookPaging(
  scrollerRef: React.RefObject<HTMLElement | null>,
  contentRef: React.RefObject<HTMLElement | null>,
  enabled: boolean,
  initialSid: string | null
) {
  const [spread, setSpread] = useState(0);
  const [spreadCount, setSpreadCount] = useState(1);
  const spreadRef = useRef(0);
  const strideRef = useRef(1); // one spread's exact px width (= k·period)
  // The sentence anchoring the current spread, kept current so a resize
  // (which changes the stride, invalidating the spread index) re-lands on the
  // same reading position rather than a now-meaningless page number.
  const anchorSidRef = useRef<string | null>(null);

  const applyGeometry = useCallback(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const C = Math.floor(scroller.getBoundingClientRect().width);
    if (C <= 0) return;
    const k = C < 896 ? 1 : 2; // single page under ~56rem
    // Each column is capped at the house reading measure (≈ 66ch) so text
    // doesn't stretch across a wide window; the leftover viewport becomes
    // symmetric outer margins (a book looks like a book — Jakob). The
    // alignment invariant: a column's period must be an integer that divides
    // the spread evenly, so columnGap = period − colW and the translation
    // stride is k·period.
    const MAX_COL = 680; // ~the 66ch reading measure
    const MIN_OUTER = 40; // columns never kiss the viewport edge
    const period = Math.floor(C / k);
    const colW = Math.max(160, Math.min(MAX_COL, period - MIN_OUTER));
    const columnGap = period - colW; // ≥ MIN_OUTER, keeps overflow on-grid
    const W = k * colW + (k - 1) * columnGap; // tight box around k columns
    const marginLeft = Math.round((C - W) / 2); // centre the spread
    strideRef.current = k * period;
    content.style.width = `${W}px`;
    content.style.marginLeft = `${marginLeft}px`;
    content.style.columnWidth = `${colW}px`;
    content.style.columnGap = `${columnGap}px`;
    content.style.columnCount = "auto";
  }, [scrollerRef, contentRef]);

  const go = useCallback(
    (n: number) => {
      const scroller = scrollerRef.current;
      const content = contentRef.current;
      if (!scroller || !content) return;
      const stride = strideRef.current;
      const max = Math.max(0, Math.ceil(content.scrollWidth / stride) - 1);
      const next = Math.max(0, Math.min(max, n));
      spreadRef.current = next;
      setSpread(next);
      // Paging owns the horizontal axis — undo any scroll a stray
      // scrollIntoView may have applied to the overflow-hidden scroller.
      scroller.scrollLeft = 0;
      content.style.transform = `translateX(${-next * stride}px)`;
    },
    [scrollerRef, contentRef]
  );

  // A span's X within the content's own coordinate space (its column position),
  // summed from the offsetLeft chain up to the article. Layout offsets are
  // PRE-transform coordinates, so — unlike getBoundingClientRect — they're
  // immune to the article's translateX and to the overflow clip, which make
  // far-off-screen columns report unstable rects. Blocks are position:relative
  // (margin numbers) and the article is transformed (so it's the offsetParent
  // terminator): the chain is span → block → article, two hops.
  const columnXof = useCallback(
    (content: HTMLElement, span: HTMLElement): number => {
      let x = 0;
      let node: HTMLElement | null = span;
      while (node && node !== content) {
        x += node.offsetLeft;
        node = node.offsetParent as HTMLElement | null;
      }
      return x;
    },
    []
  );

  /** The spread index a sentence lives on (its column ÷ the spread stride). */
  const spreadOfSid = useCallback(
    (sid: string): number | null => {
      const content = contentRef.current;
      const span = content?.querySelector<HTMLElement>(`[data-sid="${sid}"]`);
      if (!content || !span) return null;
      return Math.floor(columnXof(content, span) / strideRef.current);
    },
    [contentRef, columnXof]
  );

  /** The first sentence on the current spread (leftmost span in [left, right)),
   *  or null when none is laid out yet. */
  const firstSidOnSpread = useCallback((): string | null => {
    const content = contentRef.current;
    if (!content) return null;
    const left = spreadRef.current * strideRef.current;
    const right = left + strideRef.current;
    let best: string | null = null;
    let bestX = Infinity;
    for (const span of content.querySelectorAll<HTMLElement>("[data-sid]")) {
      const x = columnXof(content, span);
      if (x >= left - 1 && x < right && x < bestX) {
        bestX = x;
        best = span.dataset.sid ?? null;
      }
    }
    return best;
  }, [contentRef, columnXof]);

  /** Turn to the spread containing a sentence span (chapter jumps / clicks). */
  const goToSid = useCallback(
    (sid: string) => {
      const spread = spreadOfSid(sid);
      if (spread === null) return;
      anchorSidRef.current = sid;
      go(spread);
    },
    [spreadOfSid, go]
  );

  /** Narration follow: turn ONLY when the spoken sentence is on a different
   *  spread than the one shown. A sentence on the current spread's RIGHT page
   *  must NOT trigger a turn — it's already visible. */
  const ensureVisible = useCallback(
    (sid: string) => {
      const spread = spreadOfSid(sid);
      if (spread === null || spread === spreadRef.current) return;
      anchorSidRef.current = sid;
      go(spread);
    },
    [spreadOfSid, go]
  );

  /** Narration follow at WORD granularity: a sentence that starts on this
   *  spread can continue onto the next one, and the turn must happen the
   *  moment the voice crosses the boundary — not when the next sentence
   *  starts. The word's column X is the span's own column position (the
   *  hook's offsetLeft coordinate) plus the word's client-space offset from
   *  the span's first fragment — client deltas are translation-invariant, so
   *  this stays in the same space spreadOfSid uses. */
  const ensureWordVisible = useCallback(
    (span: HTMLElement, start: number, end: number) => {
      const content = contentRef.current;
      const node = span.firstChild;
      if (!content || !node || node.nodeType !== Node.TEXT_NODE) return;
      const len = (node as Text).length;
      const r = document.createRange();
      r.setStart(node, Math.min(start, len));
      r.setEnd(node, Math.min(end, len));
      const wordRect = r.getClientRects()[0];
      const spanRect = span.getClientRects()[0];
      if (!wordRect || !spanRect) return;
      const columnX =
        columnXof(content, span) + (wordRect.left - spanRect.left);
      const target = Math.floor(columnX / strideRef.current);
      if (target === spreadRef.current) return;
      anchorSidRef.current = span.dataset.sid ?? anchorSidRef.current;
      go(target);
    },
    [contentRef, columnXof, go]
  );

  // Apply geometry, then measure how many spreads the flow occupies;
  // re-run on resize (the column layout reflows with the viewport).
  useEffect(() => {
    if (!enabled) return;
    // On entry, open on the reading position (resume/active sentence) rather
    // than a stale spread index — without this the first layout clamps to a
    // meaningless page.
    if (anchorSidRef.current === null) anchorSidRef.current = initialSid;
    const layout = () => {
      const content = contentRef.current;
      if (!content) return;
      const anchor = anchorSidRef.current;
      applyGeometry();
      const count = Math.max(
        1,
        Math.ceil(content.scrollWidth / strideRef.current)
      );
      setSpreadCount(count);
      // Re-land on the anchoring sentence (the stride just changed, so the
      // old spread index is stale); fall back to clamping the index.
      if (anchor) goToSid(anchor);
      else go(Math.min(spreadRef.current, count - 1));
    };
    layout();
    window.addEventListener("resize", layout);
    return () => window.removeEventListener("resize", layout);
  }, [enabled, contentRef, applyGeometry, go, goToSid, initialSid]);

  // Manual turns: move, then re-anchor on the new spread's first sentence so a
  // later resize re-lands here.
  const turnTo = useCallback(
    (n: number) => {
      go(n);
      const sid = firstSidOnSpread();
      if (sid) anchorSidRef.current = sid;
    },
    [go, firstSidOnSpread]
  );
  const nextSpread = useCallback(() => turnTo(spreadRef.current + 1), [turnTo]);
  const prevSpread = useCallback(() => turnTo(spreadRef.current - 1), [turnTo]);

  /** The current spread's first sentence — the reader's focus-line sid in
   *  Book view; falls back to the last jump/turn anchor. */
  const currentSid = useCallback(
    (): string | null => firstSidOnSpread() ?? anchorSidRef.current,
    [firstSidOnSpread]
  );

  // Leaving book view: undo every inline style this hook owns so the scroll
  // view lays out untouched. DOM/ref cleanup only — spread state is re-derived
  // on the next enable (layout() + the reader's goToSid landing).
  useEffect(() => {
    if (enabled) return;
    const content = contentRef.current;
    if (content) {
      content.style.transform = "";
      content.style.width = "";
      content.style.marginLeft = "";
      content.style.columnWidth = "";
      content.style.columnGap = "";
      content.style.columnCount = "";
    }
    spreadRef.current = 0;
    anchorSidRef.current = null; // re-seed from initialSid on the next enable
  }, [enabled, contentRef]);

  return {
    spread,
    spreadCount,
    nextSpread,
    prevSpread,
    goToSid,
    ensureVisible,
    ensureWordVisible,
    currentSid,
  };
}
