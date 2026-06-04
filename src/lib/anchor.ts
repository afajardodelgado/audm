// Serializable highlight anchor — survives reload without storing DOM nodes.
// Follows the W3C Web Annotation TextQuote + TextPosition pattern: locate by
// stable sentence id (data-sid = "blockIndex:sentenceIndex") + char offset,
// then verify against the exact quoted text (with prefix/suffix context for
// fuzzy fallback if the document text ever changes).

export interface HighlightAnchor {
  startSid: string;
  endSid: string;
  startOffset: number;
  endOffset: number;
  exactText: string;
  prefix: string;
  suffix: string;
  color: string;
}

export const HL_COLORS = ["yellow", "rose", "blue", "green"] as const;
export type HlColor = (typeof HL_COLORS)[number];

/** All sentence span elements for a document, in reading order. */
export function sentenceSpans(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-sid]")
  );
}

/** The text node inside a sentence span (spans hold a single text node). */
function textNodeOf(span: HTMLElement): Text | null {
  const n = span.firstChild;
  return n && n.nodeType === Node.TEXT_NODE ? (n as Text) : null;
}

const CONTEXT = 32;

/**
 * Build a serializable anchor from a pair of sentence spans + offsets.
 * Offsets are character indices within each sentence's text.
 */
export function buildAnchor(
  container: HTMLElement,
  startSid: string,
  startOffset: number,
  endSid: string,
  endOffset: number,
  color: string
): HighlightAnchor | null {
  const spans = sentenceSpans(container);
  const byId = new Map(spans.map((s) => [s.dataset.sid!, s] as const));
  const startSpan = byId.get(startSid);
  const endSpan = byId.get(endSid);
  if (!startSpan || !endSpan) return null;

  // exactText spans from start to end across all sentences in between.
  const order = spans.map((s) => s.dataset.sid!);
  const i = order.indexOf(startSid);
  const j = order.indexOf(endSid);
  if (i < 0 || j < 0) return null;

  let exactText = "";
  for (let k = i; k <= j; k++) {
    const t = spans[k].textContent ?? "";
    const from = k === i ? startOffset : 0;
    const to = k === j ? endOffset : t.length;
    exactText += t.slice(from, to);
    if (k < j) exactText += " ";
  }

  const startText = startSpan.textContent ?? "";
  const endText = endSpan.textContent ?? "";
  const prefix = startText.slice(Math.max(0, startOffset - CONTEXT), startOffset);
  const suffix = endText.slice(endOffset, endOffset + CONTEXT);

  return { startSid, endSid, startOffset, endOffset, exactText, prefix, suffix, color };
}

export type HighlightTarget =
  | "sentence" // current sentence
  | "paragraph" // current paragraph (block)
  | "sentence-back" // current + previous sentence
  | "paragraph-back"; // current + previous paragraph (block)

export interface SidRange {
  startSid: string;
  startOffset: number;
  endSid: string;
  endOffset: number;
}

/**
 * Compute the sentence-span range to highlight for a chord target, given the
 * current sentence id. "previous" extends backward by one sentence or one
 * whole paragraph (block). Returns null if the current sid isn't found.
 */
export function rangeForTarget(
  container: HTMLElement,
  currentSid: string,
  target: HighlightTarget
): SidRange | null {
  const spans = sentenceSpans(container);
  const order = spans.map((s) => s.dataset.sid!);
  const idx = order.indexOf(currentSid);
  if (idx < 0) return null;

  const [curBlock] = currentSid.split(":").map(Number);

  const startOfBlock = (blockIndex: number): number => {
    // first span whose block index === blockIndex
    return order.findIndex((sid) => Number(sid.split(":")[0]) === blockIndex);
  };

  let startIdx = idx;
  let endIdx = idx;

  switch (target) {
    case "sentence":
      startIdx = idx;
      break;
    case "paragraph": {
      startIdx = startOfBlock(curBlock);
      // extend end to the last sentence of this block
      endIdx = idx;
      while (
        endIdx + 1 < order.length &&
        Number(order[endIdx + 1].split(":")[0]) === curBlock
      )
        endIdx++;
      break;
    }
    case "sentence-back":
      startIdx = Math.max(0, idx - 1);
      break;
    case "paragraph-back": {
      const prevBlock = curBlock - 1;
      const prevStart = startOfBlock(prevBlock);
      startIdx = prevStart >= 0 ? prevStart : startOfBlock(curBlock);
      // extend end to the last sentence of the CURRENT block
      endIdx = idx;
      while (
        endIdx + 1 < order.length &&
        Number(order[endIdx + 1].split(":")[0]) === curBlock
      )
        endIdx++;
      break;
    }
  }

  const startSid = order[startIdx];
  const endSid = order[endIdx];
  // Highlight whole sentences, so the end offset is always the full length of
  // the end sentence's text.
  const endOffset = (spans[endIdx].textContent ?? "").length;
  return { startSid, startOffset: 0, endSid, endOffset };
}

/**
 * Resolve an anchor back to a list of DOM Ranges (one per sentence it spans),
 * suitable for `new Highlight(...ranges)`. Returns [] if it can't be resolved.
 */
export function resolveAnchor(
  container: HTMLElement,
  a: HighlightAnchor
): Range[] {
  const spans = sentenceSpans(container);
  const order = spans.map((s) => s.dataset.sid!);
  const i = order.indexOf(a.startSid);
  const j = order.indexOf(a.endSid);
  if (i < 0 || j < 0 || j < i) return [];

  const ranges: Range[] = [];
  for (let k = i; k <= j; k++) {
    const span = spans[k];
    const node = textNodeOf(span);
    if (!node) continue;
    const len = node.length;
    const from = k === i ? Math.min(a.startOffset, len) : 0;
    const to = k === j ? Math.min(a.endOffset, len) : len;
    if (to <= from) continue;
    const r = document.createRange();
    r.setStart(node, from);
    r.setEnd(node, to);
    ranges.push(r);
  }
  return ranges;
}
