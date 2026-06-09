import type { BlockType, Prisma } from "@/generated/prisma/client";

/** A reconstructed reading block, pre-DB. */
export interface ExtractedBlock {
  type: BlockType;
  level?: number; // heading level 1-6
  text: string; // for image blocks: the alt/caption text (may be "")
  // Image blocks only. During the EPUB chapter walk `src` is the parser's
  // temp-file path; after materialization it's the final asset filename
  // ("{index}-{sha8}.{ext}") and `data` carries the bytes to persistResult
  // (which knows the document identity — mirrors ExtractResult.coverImage).
  src?: string;
  width?: number;
  height?: number;
  data?: Buffer;
}

export interface ExtractResult {
  title: string;
  author?: string;
  blocks: ExtractedBlock[];
  wordCount: number;
  meta: Prisma.InputJsonValue;
  /** True when the source had no extractable text layer (likely scanned). */
  needsOcr: boolean;
  /** Cover image bytes (PDF page 1 / EPUB cover), when one could be produced. */
  coverImage?: Buffer;
}
