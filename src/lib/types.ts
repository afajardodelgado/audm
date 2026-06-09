// Shared client-facing shapes (dates as ISO strings).

export type DocStatus =
  | "pending"
  | "extracting"
  | "ready"
  | "failed"
  | "ocr_needed"
  | "ocr_running";

export interface DocumentSummary {
  id: string;
  title: string;
  author: string | null;
  sourceType: "pdf" | "epub" | "text" | "web";
  status: DocStatus;
  wordCount: number;
  readingProgress: number; // 0..1, furthest sentence reached
  hasCover: boolean;
  createdAt: string;
  /** Imprint line (EPUB book metadata), derived server-side from Document.meta.
   *  Optional: upload/import responses return raw rows without them; the
   *  shelf's next poll fills them in. */
  publisher?: string | null;
  year?: number | null;
}

/** One table-of-contents entry, anchored to the chapter's first block. */
export interface ChapterRef {
  label: string;
  block: number;
  depth: number; // 0 | 1 — indent level in the contents menu
}

/** Parse Document.meta (untyped JSON) into the reader's chapter list.
 *  Defensive by design: returns undefined when absent, malformed, or too
 *  short to be worth a menu (< 2 entries). */
export function tocFromMeta(meta: unknown): ChapterRef[] | undefined {
  if (typeof meta !== "object" || meta === null) return undefined;
  const raw = (meta as { toc?: unknown }).toc;
  if (!Array.isArray(raw)) return undefined;
  const entries: ChapterRef[] = [];
  for (const e of raw) {
    if (typeof e !== "object" || e === null) continue;
    const { label, block, depth } = e as {
      label?: unknown;
      block?: unknown;
      depth?: unknown;
    };
    if (typeof label !== "string" || !label.trim()) continue;
    if (typeof block !== "number" || !Number.isInteger(block) || block < 0)
      continue;
    entries.push({ label, block, depth: depth === 1 ? 1 : 0 });
  }
  entries.sort((a, b) => a.block - b.block);
  return entries.length >= 2 ? entries : undefined;
}

/** Publisher/year from Document.meta's book info (EPUB); nulls when absent. */
export function bookFromMeta(meta: unknown): {
  publisher: string | null;
  year: number | null;
} {
  const book =
    typeof meta === "object" && meta !== null
      ? (meta as { book?: unknown }).book
      : undefined;
  if (typeof book !== "object" || book === null) {
    return { publisher: null, year: null };
  }
  const { publisher, year } = book as { publisher?: unknown; year?: unknown };
  return {
    publisher:
      typeof publisher === "string" && publisher.trim() ? publisher : null,
    year: typeof year === "number" && Number.isFinite(year) ? year : null,
  };
}

export interface BlockData {
  id: string;
  index: number;
  type: "paragraph" | "heading" | "blockquote" | "listitem" | "image";
  level: number | null;
  text: string; // image blocks: the alt/caption text
  sentenceCount: number; // image blocks: always 0 (narration skips them)
  /** Image blocks: full servable URL (/api/files/{docId}/images/{asset}). */
  src?: string | null;
  /** Image blocks: intrinsic px, for layout reservation (null if unprobed). */
  width?: number | null;
  height?: number | null;
}

export interface CommentData {
  id: string;
  body: string;
  createdAt: string;
}

export interface HighlightData {
  id: string;
  startSid: string;
  endSid: string;
  startOffset: number;
  endOffset: number;
  exactText: string;
  prefix: string;
  suffix: string;
  color: string;
  comments: CommentData[];
}
