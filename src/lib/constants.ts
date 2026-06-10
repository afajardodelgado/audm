// Cross-cutting limits and tunables shared across server routes and client UI.
// Single-use, domain-local constants (e.g. PDF/OCR render scales) deliberately
// stay next to their code — only values used in more than one place, or that
// must agree across the server/client boundary, live here.

/** Max upload size for PDF/EPUB files (bytes). Mirrored by
 *  `proxyClientMaxBodySize` in next.config.ts — keep the two in sync. */
export const MAX_UPLOAD_BYTES = 80 * 1024 * 1024; // 80 MB

/** Max length of pasted text accepted by the import route (characters). */
export const MAX_TEXT_CHARS = 2_000_000; // ~2 MB of text

/** Max pages a PDF may have before extraction refuses it. Bounds the per-page
 *  work (text walk, image pass, OCR, page renders) a single upload can trigger
 *  — a few KB of zip-compressed PDF can otherwise encode thousands of pages.
 *  Generous: legitimate scanned books run 300–600 pages. */
export const MAX_PDF_PAGES = 1200;

/** Time to complete a multi-key reader chord before the buffer resets (ms). */
export const CHORD_TIMEOUT_MS = 1100;

/** 1x baseline auto-scroll reading pace, in words per minute. The published
 *  API is the speed multiplier; this anchors what "1x" feels like. */
export const BASE_WPM = 260;

/** Minimum gap between reading-progress PATCHes while reading (ms). The final
 *  position is always flushed on pagehide regardless of this throttle. */
export const PROGRESS_SAVE_THROTTLE_MS = 5000;
