// Shared client-facing shapes (dates as ISO strings).

export type DocStatus =
  | "pending"
  | "extracting"
  | "ready"
  | "failed"
  | "ocr_needed";

export interface DocumentSummary {
  id: string;
  title: string;
  author: string | null;
  sourceType: "pdf" | "epub";
  status: DocStatus;
  wordCount: number;
  createdAt: string;
}

export interface BlockData {
  id: string;
  index: number;
  type: "paragraph" | "heading" | "blockquote" | "listitem";
  level: number | null;
  text: string;
  sentenceCount: number;
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
