"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { DocumentSummary } from "@/lib/types";
import FlipCard from "./FlipCard";
import RegisterRow from "./RegisterRow";
import UploadDropzone from "./UploadDropzone";
import ImportPanel from "./ImportPanel";
import LibraryToolbar from "./LibraryToolbar";
import {
  filterDocs,
  sortDocs,
  DEFAULT_FILTERS,
  type StatusFilter,
  type TypeFilter,
  type SortKey,
} from "./filterShelf";
import styles from "./Shelf.module.css";

type AddKind = "upload" | "note" | "url";

const ADD_TITLE: Record<AddKind, string> = {
  upload: "Upload a file",
  note: "Create a note",
  url: "Import from a link",
};

export default function Shelf({ initial }: { initial: DocumentSummary[] }) {
  const [docs, setDocs] = useState<DocumentSummary[]>(initial);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Search / filter / sort / view (all client-side over `docs`) ----
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [sort, setSort] = useState<SortKey>("added-desc");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [addOpen, setAddOpen] = useState<AddKind | null>(null);

  const clearFilters = useCallback(() => {
    setQuery(DEFAULT_FILTERS.query);
    setStatusFilter(DEFAULT_FILTERS.statusFilter);
    setTypeFilter(DEFAULT_FILTERS.typeFilter);
  }, []);

  const openAdd = useCallback((which: AddKind) => {
    setAddOpen((cur) => (cur === which ? null : which));
  }, []);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/documents", { cache: "no-store" });
    if (res.ok) {
      const { documents } = await res.json();
      setDocs(documents);
    }
  }, []);

  // Poll while any document is still being processed.
  const pending = docs.some(
    (d) =>
      d.status === "pending" ||
      d.status === "extracting" ||
      d.status === "ocr_running"
  );
  useEffect(() => {
    if (pending && !pollRef.current) {
      pollRef.current = setInterval(refresh, 1200);
    } else if (!pending && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [pending, refresh]);

  const handleUploaded = useCallback(
    (doc: DocumentSummary) => {
      setDocs((prev) => [doc, ...prev.filter((d) => d.id !== doc.id)]);
      refresh();
    },
    [refresh]
  );

  const handleDelete = useCallback(async (id: string) => {
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }, []);

  const handleRunOcr = useCallback(
    async (id: string) => {
      // Optimistically flip to ocr_running so polling kicks in immediately.
      setDocs((prev) =>
        prev.map((d) => (d.id === id ? { ...d, status: "ocr_running" } : d))
      );
      await fetch(`/api/documents/${id}/ocr`, { method: "POST" });
      refresh();
    },
    [refresh]
  );

  // Narrowing runs over the FULL list; the polling trigger above deliberately
  // stays on `docs` so a filter can never hide a still-processing doc and stop
  // polling it.
  const visible = useMemo(
    () => sortDocs(filterDocs(docs, { query, statusFilter, typeFilter }), sort),
    [docs, query, statusFilter, typeFilter, sort]
  );
  const empty = docs.length === 0;
  const noMatches = !empty && visible.length === 0;

  return (
    <main className={`theme-paper ${styles.shelf}`}>
      <header className={styles.masthead}>
        <div>
          <p className={styles.kicker}>A place to read</p>
          <div className={`wordmark ${styles.wordmark}`}>Audm</div>
          <p className={`byline ${styles.tagline}`}>
            Your whole library, one card each. Open anything to read it in one
            quiet column.
          </p>
        </div>
        <nav className={styles.nav}>
          <Link href="/shortcuts">Shortcuts</Link>
        </nav>
      </header>

      {/* The working toolbar — only meaningful once there's something to
          search, filter or sort. The empty state has its own add affordances. */}
      {!empty && (
        <>
          <LibraryToolbar
            query={query}
            onQuery={setQuery}
            statusFilter={statusFilter}
            onStatus={setStatusFilter}
            typeFilter={typeFilter}
            onType={setTypeFilter}
            sort={sort}
            onSort={setSort}
            view={view}
            onView={setView}
            onOpenAdd={openAdd}
            addOpen={addOpen}
          />
          {addOpen && (
            <div className={styles.addDrawer}>
              <div className={styles.addDrawerHead}>
                <span className={styles.addDrawerTitle}>
                  {ADD_TITLE[addOpen]}
                </span>
                <button
                  type="button"
                  className={styles.addDrawerClose}
                  aria-label="Close"
                  onClick={() => setAddOpen(null)}
                >
                  ×
                </button>
              </div>
              {addOpen === "upload" ? (
                <UploadDropzone onUploaded={handleUploaded} variant="row" />
              ) : (
                <ImportPanel
                  onUploaded={handleUploaded}
                  initialTab={addOpen === "url" ? "url" : "text"}
                  hideTabs
                />
              )}
            </div>
          )}
        </>
      )}

      <section className={styles.stage}>
        {empty ? (
          <div className={styles.empty}>
            <p className={styles.emptyLead}>Your library is empty.</p>
            <p className={styles.emptyHint}>
              Bring something to read. A PDF or an EPUB, a pasted note, or a link
              — it will reflow into one quiet column, yours to read slowly.
            </p>
            <UploadDropzone onUploaded={handleUploaded} variant="empty" />
            <ImportPanel onUploaded={handleUploaded} />
          </div>
        ) : noMatches ? (
          <div className={styles.noMatch}>
            <p className={styles.emptyLead}>Nothing matches.</p>
            <p className={styles.emptyHint}>
              Try a different word, or widen the Status and Type filters.
            </p>
            <button
              type="button"
              className={styles.clearFilters}
              onClick={clearFilters}
            >
              Clear filters
            </button>
          </div>
        ) : view === "list" ? (
          <div className={styles.register} role="list">
            {visible.map((doc) => (
              <RegisterRow
                key={doc.id}
                doc={doc}
                onDelete={handleDelete}
                onRunOcr={handleRunOcr}
              />
            ))}
          </div>
        ) : (
          <div className={styles.cardGrid} role="list">
            {visible.map((doc) => (
              <FlipCard
                key={doc.id}
                doc={doc}
                onDelete={handleDelete}
                onRunOcr={handleRunOcr}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
