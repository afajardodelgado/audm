"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { BlockData, HighlightData, DocStatus } from "@/lib/types";
import { BlockRenderer } from "./BlockRenderer";
import { useScrollEngine, stepSpeedValue } from "./useScrollEngine";
import { useCurrentLine } from "./useCurrentLine";
import { useHighlights } from "./useHighlights";
import { useNarrator } from "./useNarrator";
import type { NarrationUnit } from "@/lib/narrator/types";
import { rangeForTarget, parseSid, type HighlightTarget, HL_COLORS } from "@/lib/anchor";
import { CHORD_TIMEOUT_MS, PROGRESS_SAVE_THROTTLE_MS } from "@/lib/constants";
import ProgressRail from "./ProgressRail";
import CommentPopover from "./CommentPopover";
import CommentOverlay from "./CommentOverlay";
import styles from "./Reader.module.css";

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
}: {
  docId: string;
  title: string;
  author: string | null;
  status: DocStatus;
  blocks: BlockData[];
  initialHighlights: HighlightData[];
  lastReadSid: string | null;
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
    (n, b) => n + b.text.split(/\s+/).filter(Boolean).length,
    0
  );

  const engine = useScrollEngine(scrollerRef, wordCount);
  const current = useCurrentLine(scrollerRef, contentRef, ready);
  const hl = useHighlights(docId, contentRef, initialHighlights, ready);
  const narrator = useNarrator();

  // Map a sid ("blockIndex:sentenceIndex") to a 0..1 reading fraction using the
  // per-block sentence counts. Precompute the cumulative offset per block so a
  // sid resolves in O(1). Total sentences is the denominator.
  const sidToFraction = useMemo(() => {
    const offsets: number[] = [];
    let acc = 0;
    for (const b of blocks) {
      offsets.push(acc);
      acc += Math.max(1, b.sentenceCount);
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
  const activeSid = clickedSid ?? (narrating ? narrator.currentSid : current.sid);

  // Hand control back to the narrator once it has reached the clicked sentence
  // (syncing to an external system — the narrator's own currentSid catching up).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (clickedSid && narrator.currentSid === clickedSid) setClickedSid(null);
  }, [clickedSid, narrator.currentSid]);

  // Play/pause: narration when speech is supported, else silent auto-scroll.
  const togglePlay = useCallback(() => {
    if (narrator.supported) narrator.toggle(buildUnits, current.sid ?? undefined);
    else engine.toggle();
  }, [narrator, buildUnits, current.sid, engine]);

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
      span.scrollIntoView({ behavior: "smooth", block: "center" });
      narrator.play(buildUnits(), sid);
    },
    [narrator, buildUnits]
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
    contentRef.current
      ?.querySelector<HTMLElement>(`[data-sid="${sid}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [narrator.currentSid]);

  // One shared rate control feeds both the narrator and the scroll fallback.
  const changeRate = useCallback(
    (dir: 1 | -1) => {
      setRate((prev) => {
        const next = stepSpeedValue(prev, dir);
        narrator.setRate(next);
        engine.setSpeed(next);
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
    if (!narrator.playing) return;
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;

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
      const span = sid
        ? content.querySelector<HTMLElement>(`[data-sid="${sid}"]`)
        : null;
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
        if (Math.abs(delta) > 0.5) scroller.scrollTop += delta * 0.18;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [narrator.playing]);

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
    const span = contentRef.current?.querySelector<HTMLElement>(
      `[data-sid="${wr.sid}"]`
    );
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
  }, [narrator.currentWordRange]);

  const doHighlight = useCallback(
    async (target: HighlightTarget) => {
      const content = contentRef.current;
      if (!content || !current.sid) return;
      const r = rangeForTarget(content, current.sid, target);
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
    [current.sid, hl, color]
  );

  const removeCurrent = useCallback(() => {
    if (!current.sid) return;
    const cur = parseSid(current.sid);
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
  }, [current.sid, hl]);

  // Keyboard model: chord leader "c" then s/p, with d to extend back.
  const chordRef = useRef<{ buf: string; timer: number | null }>({
    buf: "",
    timer: null,
  });

  useEffect(() => {
    const resetChord = () => {
      chordRef.current.buf = "";
      if (chordRef.current.timer) {
        window.clearTimeout(chordRef.current.timer);
        chordRef.current.timer = null;
      }
      setChord("");
    };

    const armReset = () => {
      if (chordRef.current.timer) window.clearTimeout(chordRef.current.timer);
      chordRef.current.timer = window.setTimeout(resetChord, CHORD_TIMEOUT_MS);
    };

    const onKey = (e: KeyboardEvent) => {
      // Ignore while typing in inputs/textareas.
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable))
        return;

      // Global single-key controls (only when no chord in progress).
      if (!chordRef.current.buf) {
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
          if (narrator.supported) narrator.stop();
          else engine.pause();
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
      const buf = chordRef.current.buf;

      if (!buf && k === "c") {
        chordRef.current.buf = "c";
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
          chordRef.current.buf = "cd";
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
      if (chordRef.current.timer) window.clearTimeout(chordRef.current.timer);
    };
  }, [engine, narrator, togglePlay, changeRate, doHighlight, removeCurrent]);

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
        <Link href="/" className={styles.backLink}>
          ← Shelf
        </Link>
        <div className={styles.barTitle}>
          <span>{title}</span>
          {author && <span className={styles.barAuthor}> · {author}</span>}
        </div>
        <Link href="/shortcuts" className={styles.barShortcuts}>
          Shortcuts
        </Link>
      </header>

      <ProgressRail progress={progress} />

      <div ref={scrollerRef} className={styles.scroller}>
        <article
          ref={contentRef}
          className={`reading ${styles.content}`}
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

      {/* Faint gold focus line at vertical centre. */}
      <div className={`focus-line ${styles.focusLine}`} />

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

      <CommentOverlay
        highlights={hl.highlights}
        contentRef={contentRef}
        scrollerRef={scrollerRef}
        ready={ready}
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
