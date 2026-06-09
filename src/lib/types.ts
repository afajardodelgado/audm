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
