import type { BlockType, Prisma } from "@/generated/prisma/client";

/** A reconstructed reading block, pre-DB. */
export interface ExtractedBlock {
  type: BlockType;
  level?: number; // heading level 1-6
  text: string;
}

export interface ExtractResult {
  title: string;
  author?: string;
  blocks: ExtractedBlock[];
  wordCount: number;
  meta: Prisma.InputJsonValue;
  /** True when the source had no extractable text layer (likely scanned). */
  needsOcr: boolean;
}
