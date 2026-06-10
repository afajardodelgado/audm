"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type {
  BlockData,
  ChapterRef,
  HighlightData,
  DocStatus,
} from "@/lib/types";
import { BlockRenderer } from "./BlockRenderer";
import ContentsMenu from "./ContentsMenu";
import {
  useScrollEngine,
  snap,
  stepSpeedValue,
  prefersReducedMotion,
} from "./useScrollEngine";
import { useCurrentLine } from "./useCurrentLine";
import { useHighlights } from "./useHighlights";
import { useNarrator } from "./useNarrator";
import type { NarrationUnit } from "@/lib/narrator/types";
import { rangeForTarget, parseSid, type HighlightTarget, HL_COLORS } from "@/lib/anchor";
import {
  rectsForCharRange,
  sentenceCharRange,
  type PageRect,
} from "@/lib/pageOverlay";
import { BASE_WPM, CHORD_TIMEOUT_MS, PROGRESS_SAVE_THROTTLE_MS } from "@/lib/constants";
import ProgressRail from "./ProgressRail";
import VoiceMenu from "./VoiceMenu";
import CommentPopover from "./CommentPopover";
import CommentOverlay from "./CommentOverlay";
import PdfOriginal from "./PdfOriginal";
import { useBookPaging } from "./useBookPaging";
import styles from "./Reader.module.css";

// Alternate presentations of the same block stream. "audm" is the reflowed
// scroll; "original" overlays the experience on the source PDF's pages;
// "book" paginates the typeset text into a two-page spread (EPUB).
type ReaderView = "audm" | "original" | "book";

// The ::highlight() rules are injected here at runtime (the build-time CSS
// parser doesn't recognise the pseudo-element).
const HIGHLIGHT_STYLE = `
::highlight(hl-yellow){background-color:var(--hl-yellow);color:var(--hl-yellow-ink);}
::highlight(hl-rose){background-color:var(--hl-rose);color:var(--hl-rose-ink);}
::highlight(hl-blue){background-color:var(--hl-blue);color:var(--hl-blue-ink);}
::highlight(hl-green){background-color:var(--hl-green);color:var(--hl-green-ink);}
::highlight(tts-word){background-color:var(--gold);color:var(--paper);}
`;

// "1.5x", "1x" — trims a trailing ".0" so whole multipliers read cleanly.
function formatSpeed(mult: number): string {
  return `${Number.isInteger(mult) ? mult : mult.toFixed(2).replace(/0$/, "")}x`;
}

export default function Reader({
  docId,
  title,
  author,
  status,
  blocks,
  initialHighlights,
  lastReadSid,
  toc,
  sourceType,
  pageDims,
}: {
  docId: string;
  title: string;
  author: string | null;
  status: DocStatus;
  blocks: BlockData[];
  initialHighlights: HighlightData[];
  lastReadSid: string | null;
  toc?: ChapterRef[];
  sourceType: "pdf" | "epub" | "text" | "web";
  pageDims?: [number, number][];
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [color, setColor] = useState<string>(HL_COLORS[0]);
  const [chord, setChord] = useState<string>(""); // visible chord buffer
  const [pendingComment, setPendingComment] = useState<HighlightData | null>(
    null
  );

  const wordCount = blocks.reduce(
    // Image blocks carry alt text, not prose — they don't count as words.
    (n, b) =>
      n + (b.type === "image" ? 0 : b.text.split(/\s+/).filter(Boolean).length),
    0
  );

  const engine = useScrollEngine(scrollerRef, wordCount);
  const current = useCurrentLine(scrollerRef, contentRef, ready);
  const hl = useHighlights(docId, contentRef, initialHighlights, ready);
  const narrator = useNarrator();

  // Alternate view: "original" for PDFs with stored page geometry, "book"
  // (two-page spread) for EPUBs. The Audm article stays mounted in every view
  // — narration units and chord anchors are built from its spans.
  const altView: ReaderView | null =
    sourceType === "pdf" && pageDims && blocks.some((b) => b.layout?.length)
      ? "original"
      : sourceType === "epub"
        ? "book"
        : null;
  const [view, setView] = useState<ReaderView>("audm");
  // Silent auto-advance for the Book view (toggled by Play when narration is
  // unsupported); declared here so pickView below can clear it.
  const [bookAuto, setBookAuto] = useState(false);
  useEffect(() => {
    if (!altView) return;
    const saved = window.localStorage.getItem(`audm:view:${docId}`);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a saved client preference once on mount
    if (saved === altView) setView(saved);
  }, [docId, altView]);
  const pickView = useCallback(
    (v: ReaderView) => {
      setView(v);
      setBookAuto(false); // the silent page-turner never outlives its view
      window.localStorage.setItem(`audm:view:${docId}`, v);
    },
    [docId]
  );

  // Book view opens on the resume point (or the document start).
  const book = useBookPaging(scrollerRef, contentRef, view === "book", lastReadSid);

  // The focus-line sentence per view: PdfOriginal reports it for "original"
  // (no observable spans there), the current spread's first sentence for
  // "book", and useCurrentLine's scroll observer otherwise.
  const [originalSid, setOriginalSid] = useState<string | null>(null);
  const [bookSid, setBookSid] = useState<string | null>(null);
  useEffect(() => {
    // Sync the focus sentence FROM the laid-out spread (an external/DOM read)
    // whenever the spread changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (view === "book") setBookSid(book.currentSid());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-read on spread change only
  }, [view, book.spread, book.spreadCount]);
  const focusSid =
    view === "original" ? originalSid : view === "book" ? bookSid : current.sid;

  // Map a sid ("blockIndex:sentenceIndex") to a 0..1 reading fraction using the
  // per-block sentence counts. Precompute the cumulative offset per block so a
  // sid resolves in O(1). Total sentences is the denominator.
  const sidToFraction = useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (const b of blocks) {
      offsets.push(acc);
      // Image blocks contribute no sentences (narration skips them); counting
      // them would keep a document that ends in figures from reaching 100%.
      acc += b.type === "image" ? 0 : Math.max(1, b.sentenceCount);
    }
    const total = acc || 1;
    return (sid: string): number => {
      const { block, sentence } = parseSid(sid);
      if (!Number.isFinite(block) || !Number.isFinite(sentence)) return 0;
      const base = offsets[block] ?? 0;
      // +1 so reaching the last sentence reads as 100%, not (n-1)/n.
      return Math.min(1, (base + sentence + 1) / total);
    };
  }, [blocks]);

  // Shared playback rate (multiplier) across narration and the fallback scroll.
  const [rate, setRate] = useState(1);

  // Restore the persisted narration preferences once on mount — the chosen
  // voice and playback rate survive sessions (keys are global, not per-doc:
  // they're listener preferences, not document state). The engine applies the
  // voice when the model loads; an unknown saved id falls back to the default.
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  useEffect(() => {
    const savedVoice = window.localStorage.getItem("audm:voice");
    if (savedVoice) narrator.setVoice(savedVoice);
    const savedRate = Number(window.localStorage.getItem("audm:rate"));
    if (Number.isFinite(savedRate) && savedRate > 0) {
      const mult = snap(savedRate);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a saved client preference once on mount
      setRate(mult);
      narrator.setRate(mult);
      engine.setSpeed(mult);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restore once on mount
  }, []);

  // Pick a narration voice: applied immediately (mid-play re-speaks the
  // current sentence in the new voice) and remembered across sessions.
  const pickVoice = useCallback(
    (id: string) => {
      narrator.setVoice(id);
      window.localStorage.setItem("audm:voice", id);
      setVoiceMenuOpen(false);
    },
    [narrator]
  );

  // Build the sentence units to speak from the rendered spans, in order. The
  // span text includes a trailing render space between sentences — trim it for
  // speech; the sid mapping is unaffected.
  const buildUnits = useCallback((): NarrationUnit[] => {
    const content = contentRef.current;
    if (!content) return [];
    return Array.from(
      content.querySelectorAll<HTMLElement>("[data-sid]")
    ).map((el) => ({ sid: el.dataset.sid!, text: (el.textContent ?? "").trimEnd() }));
  }, []);

  // A just-clicked sentence. Clicking jumps the highlight + recenter there
  // *immediately*, before the narrator has synthesized audio for it (that can
  // take a beat, longer on the first cold click). Cleared once the narrator's
  // own currentSid catches up, after which the narrator is the clock again.
  const [clickedSid, setClickedSid] = useState<string | null>(null);

  // Whether the narration follow-crawl is engaged. A manual wheel/touch while
  // narrating suspends it (set false) so the page doesn't fight the reader;
  // jumping or "Re-center" re-engages it. Declared here so the jump/click
  // callbacks below can re-engage it.
  const [followScroll, setFollowScroll] = useState(true);

  // While narrating, the narrator is the clock: it drives the gold sentence
  // highlight and the page scrolls to follow it. Otherwise the scroll observer
  // (current.sid) drives the highlight. A fresh click overrides both until the
  // narrator reaches it. Exactly one driver at a time.
  const narrating = narrator.playing || narrator.currentSid !== null;
  const activeSid = clickedSid ?? (narrating ? narrator.currentSid : focusSid);

  // Contents menu (EPUBs with a table of contents). The current chapter is the
  // last entry at-or-before the active sentence's block; -1 before the first.
  const hasToc = !!toc && toc.length >= 2;
  const [tocOpen, setTocOpen] = useState(false);
  const currentChapter = useMemo(() => {
    if (!toc || !activeSid) return -1;
    const { block } = parseSid(activeSid);
    if (!Number.isFinite(block)) return -1;
    let idx = -1;
    for (let i = 0; i < toc.length; i++) {
      if (toc[i].block <= block) idx = i;
      else break;
    }
    return idx;
  }, [toc, activeSid]);

  // Hand control back to the narrator once it has reached the clicked sentence
  // (syncing to an external system — the narrator's own currentSid catching up).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (clickedSid && narrator.currentSid === clickedSid) setClickedSid(null);
  }, [clickedSid, narrator.currentSid]);

  // Silent auto-advance for the Book view (no vertical scroller to pace):
  // turn spreads on a words-per-spread estimate at the shared WPM rate.
  useEffect(() => {
    if (!bookAuto || view !== "book") return;
    if (prefersReducedMotion()) return;
    const secondsPerSpread =
      ((wordCount / Math.max(1, book.spreadCount) / (BASE_WPM * rate)) * 60) || 8;
    const id = window.setInterval(() => {
      book.nextSpread();
    }, Math.max(2, secondsPerSpread) * 1000);
    return () => window.clearInterval(id);
  }, [bookAuto, view, wordCount, book, rate]);

  // Play/pause: narration when speech is supported; otherwise the silent
  // fallback — auto-scroll in scrolling views, timed page-turns in Book view.
  const togglePlay = useCallback(() => {
    if (narrator.supported) {
      narrator.toggle(buildUnits, focusSid ?? undefined);
    } else if (view === "book") {
      setBookAuto((a) => !a);
    } else {
      engine.toggle();
    }
  }, [narrator, buildUnits, focusSid, engine, view]);

  // Jump to (and narrate from) the sentence span `sid`: highlight + recenter
  // right away so the jump feels instant; the narrator synthesizes and catches up.
  const jumpToSid = useCallback(
    (sid: string) => {
      if (!narrator.supported) return;
      const span = contentRef.current?.querySelector<HTMLElement>(
        `[data-sid="${sid}"]`
      );
      if (!span) return;
      setClickedSid(sid);
      setFollowScroll(true); // jumping re-engages the follow-crawl
      if (view === "audm") {
        span.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "center",
        });
      } else if (view === "book") {
        book.goToSid(sid);
      }
      // Original view: PdfOriginal's follow effect re-centres on the new sid.
      narrator.play(buildUnits(), sid);
    },
    [narrator, buildUnits, view, book]
  );

  // Click a sentence to (re)start narration from the top of that sentence —
  // Speechify-style. A click on a left-margin block number jumps to that block's
  // first sentence. Ignore clicks that are part of a text selection (the reader
  // may be selecting to highlight) and clicks outside any sentence span.
  const onContentClick = useCallback(
    (e: React.MouseEvent) => {
      if (!narrator.supported) return;
      const target = e.target as HTMLElement;
      const num = target.closest<HTMLElement>("[data-block-idx]");
      if (num) {
        jumpToSid(`${num.dataset.blockIdx}:0`);
        return;
      }
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return; // a selection, not a plain click
      const sid = target.closest<HTMLElement>("[data-sid]")?.dataset.sid;
      if (sid) jumpToSid(sid);
    },
    [narrator, jumpToSid]
  );

  // Re-center: snap back to the line being narrated and resume the follow-crawl
  // after the reader has scrolled away. Smoothly returns, then the loop holds it.
  const recenter = useCallback(() => {
    setFollowScroll(true);
    const sid = narrator.currentSid;
    if (!sid) return;
    if (view === "book") {
      book.goToSid(sid);
      return;
    }
    if (view === "original") return; // PdfOriginal's follow effect re-centres
    contentRef.current
      ?.querySelector<HTMLElement>(`[data-sid="${sid}"]`)
      ?.scrollIntoView({
        behavior: prefersReducedMotion() ? "auto" : "smooth",
        block: "center",
      });
  }, [narrator.currentSid, view, book]);

  // Margin-comment geometry for the current view. CommentOverlay owns the
  // stacking; these resolve where a highlight IS — its article span in the
  // Audm/Book views (Book drops anchors that aren't on the visible spread),
  // or its projected page rect in the Original view.
  const blockTextMap = useMemo(
    () => new Map(blocks.map((b) => [b.index, b.text])),
    [blocks]
  );
  const blockLayoutMap = useMemo(
    () => new Map(blocks.map((b) => [b.index, b.layout ?? null])),
    [blocks]
  );
  const firstRectForSid = useCallback(
    (sid: string): PageRect | null => {
      if (!pageDims) return null;
      const { block, sentence } = parseSid(sid);
      const text = blockTextMap.get(block);
      const layout = blockLayoutMap.get(block);
      if (!text || !layout?.length) return null;
      const range = sentenceCharRange(text, sentence);
      if (!range) return null;
      const rects = rectsForCharRange(layout, pageDims, text.length, range[0], range[1]);
      return rects[0] ?? null;
    },
    [pageDims, blockTextMap, blockLayoutMap]
  );
  const noteTopFor = useCallback(
    (startSid: string): number | null => {
      const scroller = scrollerRef.current;
      if (!scroller) return null;
      const scrollerTop = scroller.getBoundingClientRect().top;
      if (view === "original") {
        const rect = firstRectForSid(startSid);
        if (!rect) return null;
        const el = scroller.querySelector<HTMLElement>(`[data-page="${rect.page}"]`);
        if (!el) return null;
        const box = el.getBoundingClientRect();
        return box.top + rect.top * box.height - scrollerTop;
      }
      const span = contentRef.current?.querySelector<HTMLElement>(
        `[data-sid="${CSS.escape(startSid)}"]`
      );
      if (!span) return null;
      const r = span.getBoundingClientRect();
      // Book view: a span on another spread sits in an off-screen column —
      // its comment belongs to that spread, not this one.
      if (view === "book" && (r.width === 0 || r.right < 0 || r.left > window.innerWidth)) {
        return null;
      }
      return r.top - scrollerTop;
    },
    [view, firstRectForSid]
  );
  const noteGutters = useCallback((): { left: number; right: number } | null => {
    if (view === "original") {
      const page = scrollerRef.current?.querySelector<HTMLElement>("[data-page]");
      if (!page) return null;
      const r = page.getBoundingClientRect();
      return { left: r.left / 2, right: (r.right + window.innerWidth) / 2 };
    }
    if (view === "book") {
      // The spread fills the scroller and the article element is translated
      // per spread — anchor to the stable scroller box instead. (Book view
      // renders compact markers, which only consume the vertical position.)
      const r = scrollerRef.current?.getBoundingClientRect();
      return r ? { left: r.left / 2, right: (r.right + window.innerWidth) / 2 } : null;
    }
    // Measure the real text-column edges (the centred article box minus its
    // side padding — the column width is font-relative, so it can't be assumed
    // in CSS). Each card centres in its margin gutter: the left gutter spans
    // viewport-left → text start, the right one text end → viewport-right.
    const content = contentRef.current;
    if (!content) return null;
    const rect = content.getBoundingClientRect();
    const style = getComputedStyle(content);
    return {
      left: (rect.left + parseFloat(style.paddingLeft)) / 2,
      right: (rect.right - parseFloat(style.paddingRight) + window.innerWidth) / 2,
    };
  }, [view]);
  const jumpToNote = useCallback(
    (sid: string) => {
      if (view === "book") {
        book.goToSid(sid);
        return;
      }
      if (view === "original") {
        const rect = firstRectForSid(sid);
        const scroller = scrollerRef.current;
        if (!rect || !scroller) return;
        const el = scroller.querySelector<HTMLElement>(`[data-page="${rect.page}"]`);
        if (!el) return;
        scroller.scrollTo({
          top: Math.max(0, el.offsetTop + rect.top * el.offsetHeight - scroller.clientHeight / 2),
          behavior: prefersReducedMotion() ? "auto" : "smooth",
        });
        return;
      }
      contentRef.current
        ?.querySelector<HTMLElement>(`[data-sid="${CSS.escape(sid)}"]`)
        ?.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "center",
        });
    },
    [view, book, firstRectForSid]
  );

  // Jump to a chapter from the contents menu. Scans forward to the chapter's
  // first narratable sentence (image blocks render no sids). If narration is
  // live it's redirected there; otherwise this only scrolls — opening the
  // contents must never *start* audio.
  const jumpToChapter = useCallback(
    (entry: ChapterRef) => {
      setTocOpen(false);
      let sid: string | null = null;
      for (let i = entry.block; i < blocks.length; i++) {
        if (blocks[i].sentenceCount > 0) {
          sid = `${blocks[i].index}:0`;
          break;
        }
      }
      if (!sid) return;
      if (narrator.playing) {
        jumpToSid(sid);
        return;
      }
      if (view === "book") {
        book.goToSid(sid);
        return;
      }
      if (view === "original") {
        // Scroll to the chapter's source page (outline targets are pages).
        const page = blocks[entry.block]?.layout?.[0]?.[0];
        scrollerRef.current
          ?.querySelector<HTMLElement>(`[data-page="${page}"]`)
          ?.scrollIntoView({
            behavior: prefersReducedMotion() ? "auto" : "smooth",
            block: "start",
          });
        return;
      }
      contentRef.current
        ?.querySelector<HTMLElement>(`[data-sid="${sid}"]`)
        ?.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "center",
        });
    },
    [blocks, narrator.playing, jumpToSid, view, book]
  );

  // One shared rate control feeds both the narrator and the scroll fallback.
  const changeRate = useCallback(
    (dir: 1 | -1) => {
      setRate((prev) => {
        const next = stepSpeedValue(prev, dir);
        narrator.setRate(next);
        engine.setSpeed(next);
        window.localStorage.setItem("audm:rate", String(next));
        return next;
      });
    },
    [narrator, engine]
  );

  // Mark ready after first paint so observers/anchoring attach to real spans.
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Track scroll progress for the rail.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const max = el.scrollHeight - el.clientHeight;
      setProgress(max > 0 ? el.scrollTop / max : 0);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Restore the saved reading position once, after the spans exist. Scroll the
  // last-read sentence to the focus line so reopening resumes where you left off.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (!ready || restoredRef.current || !lastReadSid) return;
    restoredRef.current = true;
    const el = contentRef.current?.querySelector<HTMLElement>(
      `[data-sid="${lastReadSid}"]`
    );
    el?.scrollIntoView({ block: "center" });
  }, [ready, lastReadSid]);

  // Persist reading progress (the furthest sentence reached). Track the max
  // fraction seen this session, throttle PATCHes to ~5s, and flush on leave so
  // a closed tab still records where you got to. The server keeps it monotonic.
  const furthestRef = useRef({ frac: 0, sid: "" });
  const lastSaveRef = useRef(0);
  const saveProgress = useCallback(
    (immediate: boolean) => {
      const { frac, sid } = furthestRef.current;
      if (!sid) return;
      const now = Date.now();
      if (!immediate && now - lastSaveRef.current < PROGRESS_SAVE_THROTTLE_MS) return;
      lastSaveRef.current = now;
      const body = JSON.stringify({ lastReadSid: sid, readingProgress: frac });
      if (immediate && navigator.sendBeacon) {
        // sendBeacon survives pagehide where fetch may be cancelled.
        navigator.sendBeacon(
          `/api/documents/${docId}`,
          new Blob([body], { type: "application/json" })
        );
      } else {
        void fetch(`/api/documents/${docId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body,
          keepalive: true,
        });
      }
    },
    [docId]
  );

  useEffect(() => {
    if (!activeSid) return;
    const frac = sidToFraction(activeSid);
    if (frac > furthestRef.current.frac) {
      furthestRef.current = { frac, sid: activeSid };
      saveProgress(false);
    }
  }, [activeSid, sidToFraction, saveProgress]);

  useEffect(() => {
    const flush = () => saveProgress(true);
    window.addEventListener("pagehide", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      flush(); // also flush on unmount (client-side nav away)
    };
  }, [saveProgress]);

  // Speechify-style read-along: paint a soft background on the active sentence.
  // The driver is the narrator while it's speaking, else the scroll observer.
  const prevSentenceRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const content = contentRef.current;
    if (prevSentenceRef.current) {
      prevSentenceRef.current.classList.remove(styles.currentSentence);
      prevSentenceRef.current = null;
    }
    if (!content || !activeSid) return;
    const el = content.querySelector<HTMLElement>(`[data-sid="${activeSid}"]`);
    if (el) {
      el.classList.add(styles.currentSentence);
      prevSentenceRef.current = el;
    }
  }, [activeSid]);

  // Bold the left-margin number of the block we're currently in (mirrors the
  // active-sentence highlight; O(1) DOM toggle, no block re-render).
  const prevNumRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (prevNumRef.current) {
      prevNumRef.current.classList.remove(styles.blockNumActive);
      prevNumRef.current = null;
    }
    if (!activeSid) return;
    const { block } = parseSid(activeSid);
    if (!Number.isFinite(block)) return;
    const el = contentRef.current?.querySelector<HTMLElement>(
      `[data-block-idx="${block}"]`
    );
    if (el) {
      el.classList.add(styles.blockNumActive);
      prevNumRef.current = el;
    }
  }, [activeSid]);

  // While narrating, the page crawls continuously to keep the spoken text glued
  // to the centre focus line (Speechify-style). Rather than a per-sentence jump,
  // a rAF loop eases scrollTop toward the live target every frame — the target
  // is the currently-spoken word when we have one, else the active sentence, so
  // motion is smooth within a sentence and across boundaries. Word/sentence
  // positions are read from refs so the loop never restarts as they advance.
  // (useScrollEngine only pauses on wheel/touch, not programmatic scroll, so
  // there's no fight.)
  // Mirror the live narration position + follow state into refs so the rAF loop
  // below reads fresh values without restarting every time they change. (A
  // just-clicked sentence takes priority until the narrator reaches it, so the
  // crawl heads straight to the click instead of drifting back to the sentence
  // still finishing synthesis.)
  const wordRangeRef = useRef(narrator.currentWordRange);
  const currentSidRef = useRef(narrator.currentSid);
  const clickedSidRef = useRef(clickedSid);
  const followScrollRef = useRef(followScroll);
  useEffect(() => {
    wordRangeRef.current = narrator.currentWordRange;
    currentSidRef.current = narrator.currentSid;
    clickedSidRef.current = clickedSid;
    followScrollRef.current = followScroll;
  }, [narrator.currentWordRange, narrator.currentSid, clickedSid, followScroll]);

  // Resolve a sid to its sentence span, caching the last lookup. The rAF crawl
  // and the word-highlight effect run up to ~60×/sec but the target sid changes
  // only at sentence boundaries — so this turns a per-frame querySelector over
  // ~1500 spans into one lookup per sentence. Invalidated automatically when the
  // sid differs from the cached one (a re-extraction remounts the reader anyway).
  const spanCacheRef = useRef<{ sid: string; el: HTMLElement | null }>({
    sid: "",
    el: null,
  });
  const resolveSpan = useCallback((sid: string): HTMLElement | null => {
    const cache = spanCacheRef.current;
    if (cache.sid === sid && cache.el?.isConnected) return cache.el;
    const el =
      contentRef.current?.querySelector<HTMLElement>(`[data-sid="${sid}"]`) ??
      null;
    spanCacheRef.current = { sid, el };
    return el;
  }, []);

  // The reader can scroll away to read ahead/back: a manual wheel/touch while
  // narrating suspends the crawl so the page doesn't fight them. Re-engaged by
  // the "Re-center" control or by jumping. When suspended the loop keeps running
  // but stops moving the page.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const release = () => setFollowScroll(false);
    scroller.addEventListener("wheel", release, { passive: true });
    scroller.addEventListener("touchmove", release, { passive: true });
    return () => {
      scroller.removeEventListener("wheel", release);
      scroller.removeEventListener("touchmove", release);
    };
  }, []);

  useEffect(() => {
    if (!narrator.playing || view !== "audm") return;
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;

    // Under reduced motion the continuous easing crawl is replaced by an
    // instant re-centre, taken only once the spoken line has drifted well away
    // from the focus line — the text stays followable without constant motion.
    const reduceMotion = prefersReducedMotion();
    let raf = 0;
    const tick = () => {
      if (!followScrollRef.current) {
        raf = requestAnimationFrame(tick);
        return;
      }
      // Target rect: the just-clicked sentence if pending, else the live word
      // when it resolves to its text node, else the whole active sentence span.
      let rect: DOMRect | null = null;
      const wr = clickedSidRef.current ? null : wordRangeRef.current;
      const sid = clickedSidRef.current ?? wr?.sid ?? currentSidRef.current;
      const span = sid ? resolveSpan(sid) : null;
      if (span) {
        const node = span.firstChild;
        if (wr && node && node.nodeType === Node.TEXT_NODE) {
          const len = (node as Text).length;
          const r = document.createRange();
          r.setStart(node, Math.min(wr.start, len));
          r.setEnd(node, Math.min(wr.end, len));
          rect = r.getBoundingClientRect();
        }
        if (!rect || rect.height === 0) rect = span.getBoundingClientRect();
      }
      if (rect) {
        // How far to scroll so the target's midpoint sits at the focus line
        // (viewport centre), then ease a fraction of the way there.
        const delta = (rect.top + rect.bottom) / 2 - window.innerHeight / 2;
        if (reduceMotion) {
          if (Math.abs(delta) > window.innerHeight * 0.3) {
            scroller.scrollTop += delta;
          }
        } else if (Math.abs(delta) > 0.5) {
          scroller.scrollTop += delta * 0.18;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [narrator.playing, resolveSpan, view]);

  // Book view: narration follow turns the page only when the SPOKEN WORD
  // moves onto a spread that isn't currently shown — a sentence on the visible
  // spread's right page stays put (it's already in view), but a sentence that
  // continues onto the next spread turns the page the moment the voice
  // crosses, not when the next sentence starts. Without a word position yet
  // (the beat before a sentence's timings arrive) fall back to the sentence.
  useEffect(() => {
    if (view !== "book" || !narrator.playing || !followScroll) return;
    const sid = narrator.currentSid;
    if (!sid) return;
    const wr = narrator.currentWordRange;
    const span = wr && wr.sid === sid ? resolveSpan(sid) : null;
    if (wr && span) book.ensureWordVisible(span, wr.start, wr.end);
    else book.ensureVisible(sid);
  }, [view, narrator.playing, narrator.currentSid, narrator.currentWordRange, followScroll, book, resolveSpan]);

  // Manual page turns suspend narration follow (like wheel/touch in the
  // scrolling views); Re-center re-engages it.
  const turnNext = useCallback(() => {
    setFollowScroll(false);
    book.nextSpread();
  }, [book]);
  const turnPrev = useCallback(() => {
    setFollowScroll(false);
    book.prevSpread();
  }, [book]);

  // Switching views keeps the reading position: land the new view on the
  // last active sentence.
  const lastActiveSidRef = useRef<string | null>(lastReadSid);
  useEffect(() => {
    if (activeSid) lastActiveSidRef.current = activeSid;
  }, [activeSid]);
  const prevViewRef = useRef(view);
  useEffect(() => {
    if (prevViewRef.current === view) return;
    prevViewRef.current = view;
    const sid = lastActiveSidRef.current;
    if (!sid) return;
    if (view === "book") {
      book.goToSid(sid);
    } else if (view === "audm") {
      contentRef.current
        ?.querySelector<HTMLElement>(`[data-sid="${sid}"]`)
        ?.scrollIntoView({ block: "center" });
    }
    // "original": PdfOriginal mounts fresh and restores via initialSid.
  }, [view, book]);

  // Word-level highlight via the CSS Custom Highlight API — a Range over the
  // sentence span's single text node, never a DOM split (preserves the
  // single-text-node invariant that anchor.ts relies on).
  useEffect(() => {
    if (typeof CSS === "undefined" || !("highlights" in CSS)) return;
    const wr = narrator.currentWordRange;
    if (!wr) {
      CSS.highlights.delete("tts-word");
      return;
    }
    const span = resolveSpan(wr.sid);
    const node = span?.firstChild;
    if (!node || node.nodeType !== Node.TEXT_NODE) {
      CSS.highlights.delete("tts-word");
      return;
    }
    const len = (node as Text).length;
    const r = document.createRange();
    r.setStart(node, Math.min(wr.start, len));
    r.setEnd(node, Math.min(wr.end, len));
    CSS.highlights.set("tts-word", new Highlight(r));
  }, [narrator.currentWordRange, resolveSpan]);

  const doHighlight = useCallback(
    async (target: HighlightTarget) => {
      const content = contentRef.current;
      if (!content || !focusSid) return;
      const r = rangeForTarget(content, focusSid, target);
      if (!r) return;
      const created = await hl.create(
        r.startSid,
        r.startOffset,
        r.endSid,
        r.endOffset,
        color
      );
      // Offer (but don't force) a comment.
      if (created) setPendingComment(created);
    },
    [focusSid, hl, color]
  );

  const removeCurrent = useCallback(() => {
    if (!focusSid) return;
    const cur = parseSid(focusSid);
    // Find a highlight whose sentence range contains the current sentence.
    const containing = hl.highlights.find((h) => {
      const start = parseSid(h.startSid);
      const end = parseSid(h.endSid);
      if (cur.block < start.block || cur.block > end.block) return false;
      if (cur.block === start.block && cur.sentence < start.sentence) return false;
      if (cur.block === end.block && cur.sentence > end.sentence) return false;
      return true;
    });
    if (containing) void hl.remove(containing.id);
  }, [focusSid, hl]);

  // Keyboard model: chord leader "c" then s/p, with d to extend back.
  const chordRef = useRef<{ buf: string; timer: number | null }>({
    buf: "",
    timer: null,
  });

  useEffect(() => {
    // Snapshot the chord-state object (it's a stable container whose fields
    // mutate) so the cleanup below doesn't read the ref at cleanup time.
    const chordState = chordRef.current;

    const resetChord = () => {
      chordState.buf = "";
      if (chordState.timer) {
        window.clearTimeout(chordState.timer);
        chordState.timer = null;
      }
      setChord("");
    };

    const armReset = () => {
      if (chordState.timer) window.clearTimeout(chordState.timer);
      chordState.timer = window.setTimeout(resetChord, CHORD_TIMEOUT_MS);
    };

    const onKey = (e: KeyboardEvent) => {
      // Ignore while typing in inputs/textareas.
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
        return;

      // Global single-key controls (only when no chord in progress).
      if (!chordState.buf) {
        if (e.code === "Space") {
          e.preventDefault();
          togglePlay();
          return;
        }
        if (e.key === "ArrowUp" || e.key === "+" || e.key === "=") {
          e.preventDefault();
          changeRate(1);
          return;
        }
        if (e.key === "ArrowDown" || e.key === "-") {
          e.preventDefault();
          changeRate(-1);
          return;
        }
        if (e.key === "Escape") {
          // An open menu eats Escape — it must not also stop narration.
          if (voiceMenuOpen) {
            setVoiceMenuOpen(false);
            return;
          }
          if (tocOpen) {
            setTocOpen(false);
            return;
          }
          if (narrator.supported) narrator.stop();
          else engine.pause();
          return;
        }
        if (e.key === "t" && hasToc) {
          setTocOpen((o) => !o);
          return;
        }
        if (e.key === "v" && altView) {
          pickView(view === "audm" ? altView : "audm");
          return;
        }
        if (view === "book" && (e.key === "ArrowRight" || e.key === "PageDown")) {
          e.preventDefault();
          turnNext();
          return;
        }
        if (view === "book" && (e.key === "ArrowLeft" || e.key === "PageUp")) {
          e.preventDefault();
          turnPrev();
          return;
        }
        if (e.key >= "1" && e.key <= "4") {
          setColor(HL_COLORS[Number(e.key) - 1]);
          return;
        }
        if (e.key === "x" || e.key === "Backspace") {
          e.preventDefault();
          removeCurrent();
          return;
        }
      }

      // Chord machine.
      const k = e.key.toLowerCase();
      const buf = chordState.buf;

      if (!buf && k === "c") {
        chordState.buf = "c";
        setChord("c");
        armReset();
        e.preventDefault();
        return;
      }
      if (buf === "c") {
        if (k === "s") {
          void doHighlight("sentence");
          resetChord();
          e.preventDefault();
          return;
        }
        if (k === "p") {
          void doHighlight("paragraph");
          resetChord();
          e.preventDefault();
          return;
        }
        if (k === "d") {
          chordState.buf = "cd";
          setChord("c d");
          armReset();
          e.preventDefault();
          return;
        }
        resetChord();
        return;
      }
      if (buf === "cd") {
        if (k === "s") {
          void doHighlight("sentence-back");
          resetChord();
          e.preventDefault();
          return;
        }
        if (k === "p") {
          void doHighlight("paragraph-back");
          resetChord();
          e.preventDefault();
          return;
        }
        resetChord();
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (chordState.timer) window.clearTimeout(chordState.timer);
    };
  }, [engine, narrator, togglePlay, changeRate, doHighlight, removeCurrent, tocOpen, voiceMenuOpen, hasToc, altView, view, pickView, turnNext, turnPrev]);

  if (status !== "ready") {
    return (
      <main className={`theme-paper ${styles.notReady}`}>
        <div>
          <Link href="/" className={styles.backLink}>
            ← Shelf
          </Link>
          <h1 className={styles.notReadyTitle}>{title}</h1>
          <p className={styles.notReadyMsg}>
            {status === "ocr_needed"
              ? "This PDF has no text layer — it looks scanned, so there’s nothing to reflow yet. (OCR is coming.)"
              : status === "failed"
                ? "This document couldn’t be read."
                : "Still reflowing this document…"}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className={`theme-paper ${styles.reader}`}>
      <style>{HIGHLIGHT_STYLE}</style>

      <header className={styles.bar}>
        <div className={styles.barLeft}>
          <Link href="/" className={styles.backLink}>
            ← Shelf
          </Link>
          {toc && hasToc && (
            <ContentsMenu
              toc={toc}
              open={tocOpen}
              currentIndex={currentChapter}
              onToggle={() => setTocOpen((o) => !o)}
              onClose={() => setTocOpen(false)}
              onSelect={jumpToChapter}
            />
          )}
        </div>
        <div className={styles.barTitle}>
          <span>{title}</span>
          {author && <span className={styles.barAuthor}> · {author}</span>}
        </div>
        <div className={styles.barRight}>
          {altView && (
            <div
              className={styles.viewToggle}
              role="group"
              aria-label="Reading view"
            >
              <button
                type="button"
                className={`${styles.viewBtn} ${view === "audm" ? styles.viewBtnActive : ""}`}
                aria-pressed={view === "audm"}
                onClick={() => pickView("audm")}
              >
                Audm
              </button>
              <button
                type="button"
                className={`${styles.viewBtn} ${view === altView ? styles.viewBtnActive : ""}`}
                aria-pressed={view === altView}
                onClick={() => pickView(altView)}
              >
                {altView === "original" ? "Original" : "Book"}
              </button>
            </div>
          )}
          <Link href="/shortcuts" className={styles.barShortcuts}>
            Shortcuts
          </Link>
        </div>
      </header>

      <ProgressRail
        progress={
          view === "book"
            ? book.spreadCount > 1
              ? book.spread / (book.spreadCount - 1)
              : 1
            : progress
        }
      />

      <div
        ref={scrollerRef}
        className={`${styles.scroller} ${view === "book" ? styles.scrollerBook : ""}`}
      >
        {view === "original" && pageDims && (
          <PdfOriginal
            docId={docId}
            blocks={blocks}
            pageDims={pageDims}
            highlights={hl.highlights}
            activeSid={activeSid}
            wordRange={narrator.currentWordRange}
            follow={followScroll && narrating}
            initialSid={activeSid ?? lastReadSid}
            scrollerRef={scrollerRef}
            onSentenceClick={jumpToSid}
            onCurrentSid={setOriginalSid}
          />
        )}
        <article
          ref={contentRef}
          className={`reading ${styles.content} ${
            view === "original" ? styles.contentHidden : ""
          } ${view === "book" ? styles.contentBook : ""}`}
          onClick={onContentClick}
        >
          <h1 className={styles.docTitle}>{title}</h1>
          {author && <p className={`byline ${styles.docByline}`}>{author}</p>}
          {blocks.map((b) => (
            <BlockRenderer key={b.id} block={b} />
          ))}
          <div className={styles.endSpace} />
        </article>
      </div>

      {view === "book" && (
        <>
          <button
            type="button"
            className={`${styles.turnBtn} ${styles.turnPrev}`}
            onClick={turnPrev}
            disabled={book.spread === 0}
            aria-label="Previous pages"
          >
            ‹
          </button>
          <button
            type="button"
            className={`${styles.turnBtn} ${styles.turnNext}`}
            onClick={turnNext}
            disabled={book.spread >= book.spreadCount - 1}
            aria-label="Next pages"
          >
            ›
          </button>
        </>
      )}

      {/* Faint gold focus line at vertical centre (scroll-reading aid). */}
      {view !== "book" && <div className={`focus-line ${styles.focusLine}`} />}

      {/* Toolbar: play/pause (narration), speed, colour. */}
      <footer className={styles.toolbar}>
        <button
          className={styles.playBtn}
          onClick={togglePlay}
          aria-label={
            (narrator.supported ? narrator.playing : engine.playing)
              ? "Pause"
              : "Play"
          }
        >
          {(narrator.supported ? narrator.playing : engine.playing) ? "❚❚" : "▶"}
        </button>
        {narrating && !followScroll && (
          <button
            className={styles.recenterBtn}
            onClick={recenter}
            aria-label="Re-center on the line being read"
          >
            ↺ Re-center
          </button>
        )}
        {narrator.modelStatus === "loading" && (
          <span className={styles.engineStatus}>
            Loading voice… {Math.round(narrator.loadProgress * 100)}%
          </span>
        )}
        {narrator.modelStatus === "error" && (
          <span className={styles.engineStatus}>Voice unavailable</span>
        )}
        <div className={styles.speed}>
          <button onClick={() => changeRate(-1)} aria-label="Slower">
            −
          </button>
          <span>{formatSpeed(rate)}</span>
          <button onClick={() => changeRate(1)} aria-label="Faster">
            +
          </button>
        </div>
        {narrator.supported && (
          <VoiceMenu
            voices={narrator.voices}
            voiceId={narrator.voiceId}
            open={voiceMenuOpen}
            onToggle={() => setVoiceMenuOpen((o) => !o)}
            onClose={() => setVoiceMenuOpen(false)}
            onSelect={pickVoice}
          />
        )}
        <div className={styles.colors}>
          {HL_COLORS.map((c) => (
            <button
              key={c}
              className={`${styles.swatch} ${styles[`sw_${c}`]} ${
                color === c ? styles.swatchOn : ""
              }`}
              onClick={() => setColor(c)}
              aria-label={`Highlight colour ${c}`}
            />
          ))}
        </div>
        {chord && <div className={styles.chordHint}>{chord} …</div>}
      </footer>

      {/* Margin comment cards follow the highlight into every view: beside
          the article column, the Original page, or the visible Book spread. */}
      <CommentOverlay
        highlights={hl.highlights}
        scrollerRef={scrollerRef}
        ready={ready}
        topFor={noteTopFor}
        gutters={noteGutters}
        onJump={jumpToNote}
        recomputeKey={`${view}:${book.spread}:${book.spreadCount}`}
        compact={view === "book"}
      />

      {pendingComment && (
        <CommentPopover
          onSave={async (body) => {
            if (body.trim()) await hl.addComment(pendingComment.id, body);
            setPendingComment(null);
          }}
          onSkip={() => setPendingComment(null)}
        />
      )}
    </main>
  );
}
