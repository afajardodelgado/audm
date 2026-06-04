import { useCallback, useEffect, useRef, useState } from "react";
import type { HighlightData } from "@/lib/types";
import {
  buildAnchor,
  resolveAnchor,
  type HighlightAnchor,
} from "@/lib/anchor";

// Owns user highlights via the CSS Custom Highlight API (no DOM mutation, so it
// never disturbs the sentence-span scaffolding the IntersectionObserver
// watches). Falls back to nothing if the API is unavailable (the data still
// persists; a future span-fallback could render it). Handles create / delete /
// recolor and re-anchoring saved highlights on load.

const supportsHighlightApi =
  typeof CSS !== "undefined" && "highlights" in CSS;

type Registry = Map<string, { color: string; ranges: Range[] }>;

export interface HighlightsApi {
  highlights: HighlightData[];
  /** Create a highlight spanning [startSid:startOffset .. endSid:endOffset]. */
  create: (
    startSid: string,
    startOffset: number,
    endSid: string,
    endOffset: number,
    color: string,
    comment?: string
  ) => Promise<HighlightData | null>;
  remove: (id: string) => Promise<void>;
  recolor: (id: string, color: string) => Promise<void>;
  addComment: (id: string, body: string) => Promise<void>;
}

export function useHighlights(
  docId: string,
  contentRef: React.RefObject<HTMLElement | null>,
  initial: HighlightData[],
  ready: boolean
): HighlightsApi {
  const [highlights, setHighlights] = useState<HighlightData[]>(initial);
  const registry = useRef<Registry>(new Map());

  // Paint all highlights into CSS.highlights, grouped by colour.
  const repaint = useCallback(() => {
    if (!supportsHighlightApi) return;
    const byColor = new Map<string, Range[]>();
    for (const { color, ranges } of registry.current.values()) {
      const arr = byColor.get(color) ?? [];
      arr.push(...ranges);
      byColor.set(color, arr);
    }
    for (const color of ["yellow", "rose", "blue", "green"]) {
      const ranges = byColor.get(color) ?? [];
      const name = `hl-${color}`;
      if (ranges.length) {
        CSS.highlights.set(name, new Highlight(...ranges));
      } else {
        CSS.highlights.delete(name);
      }
    }
  }, []);

  const anchorOf = useCallback(
    (h: HighlightData): HighlightAnchor => ({
      startSid: h.startSid,
      endSid: h.endSid,
      startOffset: h.startOffset,
      endOffset: h.endOffset,
      exactText: h.exactText,
      prefix: h.prefix,
      suffix: h.suffix,
      color: h.color,
    }),
    []
  );

  // Re-anchor every saved highlight once the content is rendered.
  useEffect(() => {
    const content = contentRef.current;
    if (!content || !ready) return;
    registry.current.clear();
    for (const h of highlights) {
      const ranges = resolveAnchor(content, anchorOf(h));
      if (ranges.length) registry.current.set(h.id, { color: h.color, ranges });
    }
    repaint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, contentRef, repaint, anchorOf]);

  const register = useCallback(
    (h: HighlightData) => {
      const content = contentRef.current;
      if (!content) return;
      const ranges = resolveAnchor(content, anchorOf(h));
      if (ranges.length) registry.current.set(h.id, { color: h.color, ranges });
      repaint();
    },
    [contentRef, anchorOf, repaint]
  );

  const create = useCallback<HighlightsApi["create"]>(
    async (startSid, startOffset, endSid, endOffset, color, comment) => {
      const content = contentRef.current;
      if (!content) return null;
      const anchor = buildAnchor(
        content,
        startSid,
        startOffset,
        endSid,
        endOffset,
        color
      );
      if (!anchor) return null;

      const res = await fetch("/api/highlights", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: docId, ...anchor, comment }),
      });
      if (!res.ok) return null;
      const { highlight } = (await res.json()) as { highlight: HighlightData };
      setHighlights((prev) => [...prev, highlight]);
      register(highlight);
      return highlight;
    },
    [docId, contentRef, register]
  );

  const remove = useCallback<HighlightsApi["remove"]>(
    async (id) => {
      await fetch(`/api/highlights/${id}`, { method: "DELETE" });
      registry.current.delete(id);
      setHighlights((prev) => prev.filter((h) => h.id !== id));
      repaint();
    },
    [repaint]
  );

  const recolor = useCallback<HighlightsApi["recolor"]>(
    async (id, color) => {
      await fetch(`/api/highlights/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ color }),
      });
      const entry = registry.current.get(id);
      if (entry) registry.current.set(id, { ...entry, color });
      setHighlights((prev) =>
        prev.map((h) => (h.id === id ? { ...h, color } : h))
      );
      repaint();
    },
    [repaint]
  );

  const addComment = useCallback<HighlightsApi["addComment"]>(
    async (id, body) => {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ highlightId: id, body }),
      });
      if (!res.ok) return;
      const { comment } = await res.json();
      setHighlights((prev) =>
        prev.map((h) =>
          h.id === id ? { ...h, comments: [...h.comments, comment] } : h
        )
      );
    },
    []
  );

  return { highlights, create, remove, recolor, addComment };
}
