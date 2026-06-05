"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { BlockData, HighlightData, DocStatus } from "@/lib/types";
import { BlockRenderer } from "./BlockRenderer";
import { useScrollEngine, stepSpeedValue } from "./useScrollEngine";
import { useCurrentLine } from "./useCurrentLine";
import { useHighlights } from "./useHighlights";
import { useNarrator } from "./useNarrator";
import type { NarrationUnit } from "@/lib/narrator/types";
import { rangeForTarget, type HighlightTarget, HL_COLORS } from "@/lib/anchor";
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

const CHORD_TIMEOUT = 1100; // ms to complete a chord before it resets

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
}: {
  docId: string;
  title: string;
  author: string | null;
  status: DocStatus;
  blocks: BlockData[];
  initialHighlights: HighlightData[];
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

  // While narrating, the narrator is the clock: it drives the gold sentence
  // highlight and the page scrolls to follow it. Otherwise the scroll observer
  // (current.sid) drives the highlight. Exactly one driver at a time.
  const narrating = narrator.playing || narrator.currentSid !== null;
  const activeSid = narrating ? narrator.currentSid : current.sid;

  // Play/pause: narration when speech is supported, else silent auto-scroll.
  const togglePlay = useCallback(() => {
    if (narrator.supported) narrator.toggle(buildUnits, current.sid ?? undefined);
    else engine.toggle();
  }, [narrator, buildUnits, current.sid, engine]);

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

  // While narrating, keep the spoken sentence centered in view. (useScrollEngine
  // only pauses on wheel/touch, not programmatic scroll, so there's no fight.)
  useEffect(() => {
    if (!narrator.playing || !narrator.currentSid) return;
    const el = contentRef.current?.querySelector<HTMLElement>(
      `[data-sid="${narrator.currentSid}"]`
    );
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [narrator.currentSid, narrator.playing]);

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
    // Find a highlight that contains the current sentence and remove it.
    const containing = hl.highlights.find((h) => {
      const [hs] = h.startSid.split(":").map(Number);
      const [he] = h.endSid.split(":").map(Number);
      const [cs, css] = current.sid!.split(":").map(Number);
      const startN = Number(h.startSid.split(":")[1]);
      const endN = Number(h.endSid.split(":")[1]);
      if (cs < hs || cs > he) return false;
      if (cs === hs && css < startN) return false;
      if (cs === he && css > endN) return false;
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
      chordRef.current.timer = window.setTimeout(resetChord, CHORD_TIMEOUT);
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
        <article ref={contentRef} className={`reading ${styles.content}`}>
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

      {/* Toolbar: play/pause (narration), voice, speed, colour. */}
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
        {narrator.supported && narrator.voices.length > 1 && (
          <select
            className={styles.voiceSelect}
            value={narrator.voiceId ?? ""}
            onChange={(e) => narrator.setVoice(e.target.value)}
            aria-label="Narration voice"
          >
            {narrator.voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
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
