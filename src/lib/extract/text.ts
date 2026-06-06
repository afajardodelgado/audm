import type { ExtractResult, ExtractedBlock } from "./types";
import { countBlocksWords, normalizeWhitespace } from "./segment";

/**
 * Split raw plain text into paragraph blocks. Blank lines separate paragraphs;
 * a single newline inside a paragraph is treated as a soft wrap (joined with a
 * space). Used by the paste-text import path and as the OCR text assembler.
 */
export function textToBlocks(text: string): ExtractedBlock[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((para) => normalizeWhitespace(para))
    .filter((para) => para.length > 0)
    .map((para): ExtractedBlock => ({ type: "paragraph", text: para }));
}

/** Build an ExtractResult from pasted plain text. */
export function textToResult(text: string, title: string): ExtractResult {
  const blocks = textToBlocks(text);
  const wordCount = countBlocksWords(blocks);
  return {
    title: title.trim(),
    blocks,
    wordCount,
    meta: { kind: "text" },
    needsOcr: false,
  };
}
