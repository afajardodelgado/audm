// Small client-side helpers for talking to the JSON API. Centralizes the
// fetch -> parse -> error-normalize dance the upload and import forms share, so
// each component owns only its own busy/error UI state, not the wire handling.

import type { DocumentSummary } from "./types";

/** A document as it arrives over the wire (createdAt is a JSON string already,
 *  but may be typed loosely by callers). */
type RawDocument = { createdAt: string | Date } & Omit<
  DocumentSummary,
  "createdAt"
>;

/** Coerce a wire document into a DocumentSummary (createdAt as an ISO string). */
export function normalizeDoc(raw: RawDocument): DocumentSummary {
  return { ...raw, createdAt: String(raw.createdAt) };
}

/**
 * POST to an endpoint that returns `{ document }` and yield the normalized
 * document. Accepts any BodyInit (JSON string or FormData). Throws an Error
 * carrying the server's `error` message on a non-2xx response, so callers can
 * surface it directly; network failures throw the underlying error.
 */
export async function postForDocument(
  url: string,
  body: BodyInit,
  headers?: HeadersInit
): Promise<DocumentSummary> {
  const res = await fetch(url, { method: "POST", body, headers });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json?.error ?? "Request failed.");
  }
  return normalizeDoc(json.document as RawDocument);
}
