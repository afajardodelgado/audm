// Project sentence/word character ranges of a PDF text block onto the source
// page, using the per-line geometry recorded at extraction (Block.layout:
// [[page, x, yBaseline, width, fontHeight, charCount], ...]).
//
// The mapping is deliberately PROPORTIONAL: a char position in the block's
// normalized text is converted to a fraction, then placed across the lines
// weighted by their char counts, and within a line by linear interpolation.
// Exact glyph metrics aren't stored — this is the approximate, Speechify-like
// fidelity chosen for the Original view. All output is in fractions of the
// page (0..1 from the page's top-left), so callers can position overlays with
// CSS percentages at any rendered size.

import { splitSentences } from "@/lib/extract/segment";

export interface PageRect {
  page: number; // 0-based
  left: number; // fractions of page width/height, origin top-left
  top: number;
  width: number;
  height: number;
}

// Vertical band around a text baseline, in font-height units.
const ASCENT = 0.85;
const DESCENT = 0.25;

/** Rects (one per touched line) covering the char range [start, end) of a
 *  block whose normalized text has `totalChars` characters. */
export function rectsForCharRange(
  layout: number[][],
  pageDims: [number, number][],
  totalChars: number,
  start: number,
  end: number
): PageRect[] {
  if (!layout.length || totalChars <= 0 || end <= start) return [];
  const sumChars = layout.reduce((n, l) => n + (l[5] || 0), 0);
  if (sumChars <= 0) return [];
  // Block-text char positions → the layout's own char space.
  const s = (Math.max(0, start) / totalChars) * sumChars;
  const e = (Math.min(totalChars, end) / totalChars) * sumChars;

  const rects: PageRect[] = [];
  let cum = 0;
  for (const line of layout) {
    const [page, x, yBase, w, fontH, chars] = line;
    const lineStart = cum;
    const lineEnd = cum + (chars || 0);
    cum = lineEnd;
    if (lineEnd <= s || lineStart >= e || chars <= 0) continue;
    const dims = pageDims[page];
    if (!dims) continue;
    const [pw, ph] = dims;
    const fromFrac = Math.max(0, (s - lineStart) / chars);
    const toFrac = Math.min(1, (e - lineStart) / chars);
    const top = ph - (yBase + fontH * ASCENT);
    rects.push({
      page,
      left: (x + w * fromFrac) / pw,
      top: top / ph,
      width: (w * (toFrac - fromFrac)) / pw,
      height: (fontH * (ASCENT + DESCENT)) / ph,
    });
  }
  return rects;
}

/** Char range [start, end) of sentence `index` within a block's text, under
 *  the same sentences-joined-by-one-space convention the reader renders. */
export function sentenceCharRange(
  blockText: string,
  index: number
): [number, number] | null {
  const sentences = splitSentences(blockText);
  if (index < 0 || index >= sentences.length) return null;
  let start = 0;
  for (let i = 0; i < index; i++) start += sentences[i].length + 1;
  return [start, start + sentences[index].length];
}

/** One line of the per-page hit index: where a block's line sits vertically
 *  and which slice of the block's chars it carries. */
export interface IndexedLine {
  block: number; // block index
  page: number;
  top: number; // fraction of page height
  bottom: number;
  charStart: number; // in the block's layout char space
  charEnd: number;
  layoutChars: number; // the block's total layout chars
  textChars: number; // the block's text length
}

/** Build a per-page index of every laid-out line, for click → sentence and
 *  viewport-centre → sentence resolution. */
export function buildPageLineIndex(
  blocks: { index: number; text: string; layout?: number[][] | null }[],
  pageDims: [number, number][]
): Map<number, IndexedLine[]> {
  const byPage = new Map<number, IndexedLine[]>();
  for (const b of blocks) {
    if (!b.layout?.length) continue;
    const layoutChars = b.layout.reduce((n, l) => n + (l[5] || 0), 0);
    if (layoutChars <= 0) continue;
    let cum = 0;
    for (const line of b.layout) {
      const [page, , yBase, , fontH, chars] = line;
      const charStart = cum;
      cum += chars || 0;
      const dims = pageDims[page];
      if (!dims || chars <= 0) continue;
      const ph = dims[1];
      let list = byPage.get(page);
      if (!list) {
        list = [];
        byPage.set(page, list);
      }
      list.push({
        block: b.index,
        page,
        top: (ph - (yBase + fontH * ASCENT)) / ph,
        bottom: (ph - (yBase - fontH * DESCENT)) / ph,
        charStart,
        charEnd: cum,
        layoutChars,
        textChars: b.text.length,
      });
    }
  }
  for (const list of byPage.values()) list.sort((a, b) => a.top - b.top);
  return byPage;
}

/** The sid ("block:sentence") nearest a vertical position on a page, or null
 *  when the page has no laid-out lines. `yFrac` is 0..1 from the page top. */
export function sidAtPagePosition(
  index: Map<number, IndexedLine[]>,
  blockTexts: Map<number, string>,
  page: number,
  yFrac: number
): string | null {
  const lines = index.get(page);
  if (!lines?.length) return null;
  let best: IndexedLine = lines[0];
  let bestDist = Infinity;
  for (const l of lines) {
    const d =
      yFrac < l.top ? l.top - yFrac : yFrac > l.bottom ? yFrac - l.bottom : 0;
    if (d < bestDist) {
      best = l;
      bestDist = d;
      if (d === 0) break;
    }
  }
  const text = blockTexts.get(best.block);
  if (!text) return null;
  // Line midpoint in layout-char space → block-text char → sentence index.
  const mid = (best.charStart + best.charEnd) / 2 / best.layoutChars;
  const charPos = Math.min(text.length - 1, Math.floor(mid * text.length));
  const sentences = splitSentences(text);
  let start = 0;
  for (let i = 0; i < sentences.length; i++) {
    const end = start + sentences[i].length;
    if (charPos <= end) return `${best.block}:${i}`;
    start = end + 1;
  }
  return `${best.block}:${sentences.length - 1}`;
}
