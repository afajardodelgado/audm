// Sentence/word segmentation via the built-in Intl.Segmenter (Node + browser).
// Used server-side to count sentences/words per block, and client-side to wrap
// each sentence in a span with a stable data-sid. Running the SAME segmenter on
// both sides guarantees identical boundaries, so anchors stay valid.

const sentenceSeg = new Intl.Segmenter("en", { granularity: "sentence" });
const wordSeg = new Intl.Segmenter("en", { granularity: "word" });

/** Split a block of plain text into sentence strings (trimmed, non-empty). */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  for (const { segment } of sentenceSeg.segment(text)) {
    const s = segment.trim();
    if (s) out.push(s);
  }
  // A block with no sentence boundary (e.g. a short heading) is one sentence.
  return out.length ? out : text.trim() ? [text.trim()] : [];
}

/** Count word-like segments (Intl marks them isWordLike). */
export function countWords(text: string): number {
  let n = 0;
  for (const seg of wordSeg.segment(text)) {
    if (seg.isWordLike) n++;
  }
  return n;
}
