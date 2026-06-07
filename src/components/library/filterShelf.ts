// Client-side search / filter / sort over the already-loaded library.
// Pure functions over DocumentSummary[] — no React, no fetch. The whole doc
// list is already in memory (page.tsx hands it to the Shelf), so narrowing is
// instant (Doherty: feedback well under 400ms, no spinner needed).

import type { DocumentSummary } from "@/lib/types";

export type StatusFilter =
  | "all"
  | "reading"
  | "unread"
  | "finished"
  | "processing";

export type TypeFilter = "all" | "pdf" | "epub" | "text" | "web";

export type SortKey = "added-desc" | "added-asc" | "title" | "recent";

export interface Filters {
  query: string;
  statusFilter: StatusFilter;
  typeFilter: TypeFilter;
}

export const DEFAULT_FILTERS: Filters = {
  query: "",
  statusFilter: "all",
  typeFilter: "all",
};

// Liberal in what it accepts (Postel): trims, case-insensitive, substring,
// matches title OR author. Empty query matches everything.
export function matchesQuery(d: DocumentSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${d.title} ${d.author ?? ""}`.toLowerCase();
  return hay.includes(q);
}

// "reading" = a ready doc that's been started but not effectively finished.
export function matchesStatus(d: DocumentSummary, f: StatusFilter): boolean {
  if (f === "all") return true;
  const p = d.readingProgress ?? 0;
  switch (f) {
    case "reading":
      return d.status === "ready" && p > 0 && p < 0.98;
    case "unread":
      return d.status === "ready" && p <= 0;
    case "finished":
      return d.status === "ready" && p >= 0.98;
    case "processing":
      return d.status !== "ready";
  }
}

export function matchesType(d: DocumentSummary, f: TypeFilter): boolean {
  return f === "all" || d.sourceType === f;
}

export function filterDocs(
  docs: DocumentSummary[],
  { query, statusFilter, typeFilter }: Filters
): DocumentSummary[] {
  return docs.filter(
    (d) =>
      matchesQuery(d, query) &&
      matchesStatus(d, statusFilter) &&
      matchesType(d, typeFilter)
  );
}

// Returns a new array (never mutates the input). "added-desc" reproduces the
// server's default order. "recent" is a progress-based approximation: there's
// no lastReadAt column, so started-but-unfinished books float to the top by
// progress, then everything falls back to newest-first.
export function sortDocs(
  docs: DocumentSummary[],
  sort: SortKey
): DocumentSummary[] {
  const out = [...docs];
  switch (sort) {
    case "added-desc":
      out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      break;
    case "added-asc":
      out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      break;
    case "title":
      out.sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" })
      );
      break;
    case "recent":
      out.sort((a, b) => {
        const pa = a.readingProgress ?? 0;
        const pb = b.readingProgress ?? 0;
        const aActive = a.status === "ready" && pa > 0 ? 1 : 0;
        const bActive = b.status === "ready" && pb > 0 ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        if (aActive && pb !== pa) return pb - pa;
        return b.createdAt.localeCompare(a.createdAt);
      });
      break;
  }
  return out;
}

// Labels for the filter/sort menus, kept beside the logic so options and
// predicates stay in lock-step.
export const STATUS_OPTIONS: ReadonlyArray<[StatusFilter, string]> = [
  ["all", "All"],
  ["reading", "Reading"],
  ["unread", "Unread"],
  ["finished", "Finished"],
  ["processing", "Processing"],
];

export const TYPE_OPTIONS: ReadonlyArray<[TypeFilter, string]> = [
  ["all", "All types"],
  ["pdf", "PDF"],
  ["epub", "EPUB"],
  ["text", "Text"],
  ["web", "Web"],
];

export const SORT_OPTIONS: ReadonlyArray<[SortKey, string]> = [
  ["added-desc", "Newest first"],
  ["added-asc", "Oldest first"],
  ["title", "Title A–Z"],
  ["recent", "Recently read"],
];
