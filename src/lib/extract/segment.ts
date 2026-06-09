// Sentence/word segmentation via the built-in Intl.Segmenter (Node + browser).
// Used server-side to count sentences/words per block, and client-side to wrap
// each sentence in a span with a stable data-sid. Running the SAME segmenter on
// both sides guarantees identical boundaries, so anchors stay valid.

import type { ExtractedBlock } from "./types";

const sentenceSeg = new Intl.Segmenter("en", { granularity: "sentence" });
const wordSeg = new Intl.Segmenter("en", { granularity: "word" });

// ICU's sentence breaker splits after common abbreviations ("Mr.", "Dr.",
// initials like "J."), so a single sentence gets cut at the abbreviation period.
// We re-merge those fragments below. Keys are lowercase with the trailing dot
// dropped; internal dots are kept ("i.e", "u.s"). Curated and conservative — a
// false merge (joining two real sentences) is worse than missing a rare
// abbreviation, so this stays tight.
const ABBREVIATIONS = new Set<string>([
  "mr", "mrs", "ms", "dr", "prof", "st", "sr", "jr", "mt", "rev", "hon", "gen",
  "col", "capt", "lt", "sgt", "gov", "sen", "rep", "pres", "supt", "fr",
  "vs", "etc", "e.g", "i.e", "a.m", "p.m", "u.s", "u.k", "no", "vol", "pp",
  "ed", "cf", "al",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov",
  "dec",
]);

// A lone capital initial: "J.", "R." — case-sensitive on purpose (a lowercase
// "a." is far more likely a list marker or a real sentence end).
const INITIAL_RE = /^[A-Z]\.$/;

/** True if `s` ends in a period whose final token is a known abbreviation. */
function endsWithAbbreviation(s: string): boolean {
  const t = s.trimEnd();
  if (!t.endsWith(".")) return false; // only "." can be a false sentence break
  const last = t.slice(t.lastIndexOf(" ") + 1); // last whitespace-delimited token
  if (INITIAL_RE.test(last)) return true;
  return ABBREVIATIONS.has(last.slice(0, -1).toLowerCase()); // drop final dot
}

/** Split a block of plain text into sentence strings (trimmed, non-empty). */
export function splitSentences(text: string): string[] {
  const raw: string[] = [];
  for (const { segment } of sentenceSeg.segment(text)) {
    const s = segment.trim();
    if (s) raw.push(s);
  }
  // A block with no sentence boundary (e.g. a short heading) is one sentence.
  if (raw.length === 0) return text.trim() ? [text.trim()] : [];

  // Deterministic post-merge: fold an abbreviation-ending fragment into the
  // following one, joined with the SAME single space the consumers (BlockRenderer
  // / anchor.ts) use between sentences. So splitSentences(text).join(" ") is
  // unchanged, keeping highlight anchors valid. Re-testing the grown buffer lets
  // chains ("Mr. and Mrs. Smith said.") and initial runs collapse in one pass.
  const out: string[] = [];
  let current = raw[0];
  for (let i = 1; i < raw.length; i++) {
    if (endsWithAbbreviation(current)) current += " " + raw[i];
    else {
      out.push(current);
      current = raw[i];
    }
  }
  out.push(current);
  return out;
}

/** Count word-like segments (Intl marks them isWordLike). */
export function countWords(text: string): number {
  let n = 0;
  for (const seg of wordSeg.segment(text)) {
    if (seg.isWordLike) n++;
  }
  return n;
}

/** Total word count across a set of extracted blocks. Image blocks count 0 —
 *  their `text` is alt/caption metadata, not prose. */
export function countBlocksWords(blocks: ExtractedBlock[]): number {
  return blocks.reduce(
    (n, b) => n + (b.type === "image" ? 0 : countWords(b.text)),
    0
  );
}

/** Collapse runs of whitespace to single spaces and trim the ends. The single
 *  canonical normalizer used by every extractor so block text is consistent. */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
