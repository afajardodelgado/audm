"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { BlockData, HighlightData } from "@/lib/types";
import {
  buildPageLineIndex,
  rectsForCharRange,
  sentenceCharRange,
  sidAtPagePosition,
  type PageRect,
} from "@/lib/pageOverlay";
import { parseSid } from "@/lib/anchor";
import { prefersReducedMotion } from "./useScrollEngine";
import styles from "./Reader.module.css";

// The Original view for PDFs: the source pages rendered as images, with the
// reading experience projected on top — the active sentence band, the moving
// narration word mark, and saved highlights, all positioned from the per-line
// geometry recorded at extraction (approximate by design; see lib/pageOverlay).
// Pages lazy-load; aspect-ratio boxes reserve layout so positions are stable.
//
// The component also REPORTS the sentence at the viewport's focus line via
// onCurrentSid, so chords/progress keep working, and turns clicks on a page
// into click-to-narrate jumps.

const WORD_MARK = "wordMark";
const SENTENCE_BAND = "sentenceBand";

export default function PdfOriginal({
  docId,
  blocks,
  pageDims,
  highlights,
  activeSid,
  wordRange,
  follow,
  initialSid,
  scrollerRef,
  onSentenceClick,
  onCurrentSid,
}: {
  docId: string;
  blocks: BlockData[];
  pageDims: [number, number][];
  highlights: HighlightData[];
  activeSid: string | null;
  wordRange: { sid: string; start: number; end: number } | null;
  follow: boolean; // keep the active sentence near the focus line
  initialSid: string | null; // restore position on mount
  scrollerRef: React.RefObject<HTMLElement | null>;
  onSentenceClick: (sid: string) => void;
  onCurrentSid: (sid: string | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);

  const blockText = useMemo(
    () => new Map(blocks.map((b) => [b.index, b.text])),
    [blocks]
  );
  const blockLayout = useMemo(
    () => new Map(blocks.map((b) => [b.index, b.layout ?? null])),
    [blocks]
  );
  const lineIndex = useMemo(
    () => buildPageLineIndex(blocks, pageDims),
    [blocks, pageDims]
  );

  // Rects for a sid range with char offsets inside the start/end sentences —
  // shared by saved highlights and the active-sentence band.
  const rectsForAnchor = useCallback(
    (
      startSid: string,
      startOffset: number,
      endSid: string,
      endOffset: number
    ): PageRect[] => {
      const start = parseSid(startSid);
      const end = parseSid(endSid);
      if (!Number.isFinite(start.block) || !Number.isFinite(end.block)) {
        return [];
      }
      const rects: PageRect[] = [];
      for (let b = start.block; b <= end.block; b++) {
        const layout = blockLayout.get(b);
        const text = blockText.get(b);
        if (!layout?.length || !text) continue;
        const first =
          b === start.block ? sentenceCharRange(text, start.sentence) : null;
        const last =
          b === end.block ? sentenceCharRange(text, end.sentence) : null;
        const from = first ? first[0] + startOffset : 0;
        const to = last ? last[0] + endOffset : text.length;
        rects.push(...rectsForCharRange(layout, pageDims, text.length, from, to));
      }
      return rects;
    },
    [blockLayout, blockText, pageDims]
  );

  // Saved highlights, grouped by page (recomputed only when they change).
  const highlightRects = useMemo(() => {
    const byPage = new Map<number, { rect: PageRect; color: string }[]>();
    for (const h of highlights) {
      for (const rect of rectsForAnchor(
        h.startSid,
        h.startOffset,
        h.endSid,
        h.endOffset
      )) {
        let list = byPage.get(rect.page);
        if (!list) {
          list = [];
          byPage.set(rect.page, list);
        }
        list.push({ rect, color: h.color });
      }
    }
    return byPage;
  }, [highlights, rectsForAnchor]);

  // Active sentence band + word mark (cheap; recomputed per sid/word change).
  const activeRects = useMemo(() => {
    if (!activeSid) return [];
    const { block, sentence } = parseSid(activeSid);
    const text = blockText.get(block);
    const layout = blockLayout.get(block);
    if (!text || !layout?.length) return [];
    const range = sentenceCharRange(text, sentence);
    if (!range) return [];
    return rectsForCharRange(layout, pageDims, text.length, range[0], range[1]);
  }, [activeSid, blockText, blockLayout, pageDims]);

  const wordRects = useMemo(() => {
    if (!wordRange) return [];
    const { block, sentence } = parseSid(wordRange.sid);
    const text = blockText.get(block);
    const layout = blockLayout.get(block);
    if (!text || !layout?.length) return [];
    const range = sentenceCharRange(text, sentence);
    if (!range) return [];
    return rectsForCharRange(
      layout,
      pageDims,
      text.length,
      range[0] + wordRange.start,
      range[0] + wordRange.end
    );
  }, [wordRange, blockText, blockLayout, pageDims]);

  const pageEl = useCallback(
    (page: number) =>
      wrapRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`) ??
      null,
    []
  );

  // Scroll so a page-fraction position sits at the viewport's focus line.
  const scrollToRect = useCallback(
    (rect: PageRect, smooth: boolean) => {
      const scroller = scrollerRef.current;
      const el = pageEl(rect.page);
      if (!scroller || !el) return;
      const target =
        el.offsetTop + rect.top * el.offsetHeight - scroller.clientHeight / 2;
      scroller.scrollTo({
        top: Math.max(0, target),
        behavior: smooth && !prefersReducedMotion() ? "smooth" : "auto",
      });
    },
    [scrollerRef, pageEl]
  );

  // Restore position once on mount.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (!initialSid) return;
    const { block, sentence } = parseSid(initialSid);
    const text = blockText.get(block);
    const layout = blockLayout.get(block);
    if (!text || !layout?.length) return;
    const range = sentenceCharRange(text, sentence);
    if (!range) return;
    const rects = rectsForCharRange(layout, pageDims, text.length, range[0], range[1]);
    if (rects.length) scrollToRect(rects[0], false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow narration: keep the SPOKEN WORD near the focus line, falling back
  // to the sentence's first line before word timings arrive. Stepwise (only
  // when the target drifts past the threshold) rather than a per-frame crawl —
  // honest for page images, and automatically calm under reduced motion.
  // A PAGE CROSSING recenters immediately, threshold ignored: a sentence that
  // began at the foot of one page pulls the view to the next page the moment
  // the voice crosses (on screen the next page's first line is barely below
  // the previous foot, so drift alone would never trip the threshold).
  const followPageRef = useRef<number | null>(null);
  useEffect(() => {
    if (!follow) return;
    const target = wordRects[0] ?? activeRects[0];
    if (!target) return;
    const scroller = scrollerRef.current;
    const el = pageEl(target.page);
    if (!scroller || !el) return;
    const pageChanged =
      followPageRef.current !== null && followPageRef.current !== target.page;
    followPageRef.current = target.page;
    const y = el.offsetTop + target.top * el.offsetHeight - scroller.scrollTop;
    const center = scroller.clientHeight / 2;
    if (pageChanged || Math.abs(y - center) > scroller.clientHeight * 0.18) {
      scrollToRect(target, true);
    }
  }, [activeRects, wordRects, follow, scrollerRef, pageEl, scrollToRect]);

  // Report the sentence at the viewport focus line (drives chords/progress).
  useEffect(() => {
    const scroller = scrollerRef.current;
    const wrap = wrapRef.current;
    if (!scroller || !wrap) return;
    let raf = 0;
    const report = () => {
      raf = 0;
      const centerY = scroller.scrollTop + scroller.clientHeight / 2;
      const pages = wrap.querySelectorAll<HTMLElement>("[data-page]");
      let sid: string | null = null;
      for (const el of pages) {
        if (
          centerY >= el.offsetTop &&
          centerY <= el.offsetTop + el.offsetHeight
        ) {
          const page = Number(el.dataset.page);
          const yFrac = (centerY - el.offsetTop) / el.offsetHeight;
          sid = sidAtPagePosition(lineIndex, blockText, page, yFrac);
          break;
        }
      }
      onCurrentSid(sid);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(report);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    report();
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      onCurrentSid(null);
    };
  }, [scrollerRef, lineIndex, blockText, onCurrentSid]);

  // Click a line on a page to narrate from its sentence.
  const onPageClick = useCallback(
    (e: React.MouseEvent<HTMLElement>) => {
      const el = e.currentTarget;
      const page = Number(el.dataset.page);
      const box = el.getBoundingClientRect();
      const yFrac = (e.clientY - box.top) / box.height;
      const sid = sidAtPagePosition(lineIndex, blockText, page, yFrac);
      if (sid) onSentenceClick(sid);
    },
    [lineIndex, blockText, onSentenceClick]
  );

  const pct = (n: number) => `${n * 100}%`;
  const rectStyle = (r: PageRect) => ({
    left: pct(r.left),
    top: pct(r.top),
    width: pct(r.width),
    height: pct(r.height),
  });

  return (
    <div ref={wrapRef} className={styles.pdfPages}>
      {pageDims.map(([w, h], i) => (
        <div
          key={i}
          className={styles.pdfPage}
          style={{ aspectRatio: `${w} / ${h}` }}
          data-page={i}
          onClick={onPageClick}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- own-volume render; no optimizer needed */}
          <img
            className={styles.pdfPageImg}
            src={`/api/files/${docId}/pages/${i + 1}`}
            alt={`Page ${i + 1}`}
            loading="lazy"
            decoding="async"
          />
          {(highlightRects.get(i) ?? []).map(({ rect, color }, k) => (
            <span
              key={`h${k}`}
              className={styles.pdfOverlay}
              style={{
                ...rectStyle(rect),
                background: `var(--hl-${color})`,
              }}
            />
          ))}
          {activeRects
            .filter((r) => r.page === i)
            .map((r, k) => (
              <span
                key={`s${k}`}
                className={`${styles.pdfOverlay} ${styles.pdfSentence}`}
                data-overlay={SENTENCE_BAND}
                style={rectStyle(r)}
              />
            ))}
          {wordRects
            .filter((r) => r.page === i)
            .map((r, k) => (
              <span
                key={`w${k}`}
                className={`${styles.pdfOverlay} ${styles.pdfWord}`}
                data-overlay={WORD_MARK}
                style={rectStyle(r)}
              />
            ))}
        </div>
      ))}
    </div>
  );
}
