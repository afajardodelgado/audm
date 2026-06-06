"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DocumentSummary } from "@/lib/types";
import BookObject from "./BookObject";
import UploadDropzone from "./UploadDropzone";
import ImportPanel from "./ImportPanel";
import ContinueReading, { pickContinue } from "./ContinueReading";
import { useShelfScroll } from "./useShelfScroll";
import styles from "./Shelf.module.css";

// Bound formats stand on the shelf; loose text/web go in the drawer.
const isBound = (d: DocumentSummary) =>
  d.sourceType === "pdf" || d.sourceType === "epub";

export default function Shelf({ initial }: { initial: DocumentSummary[] }) {
  const [docs, setDocs] = useState<DocumentSummary[]>(initial);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const {
    ref: scrollerRef,
    dragging,
    canPrev,
    canNext,
    scrollPrev,
    scrollNext,
    onClickCapture,
  } = useShelfScroll();

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

  const books = docs.filter(isBound);
  const drawer = docs.filter((d) => !isBound(d));
  const empty = docs.length === 0;
  const continueDoc = pickContinue(docs);

  return (
    <main className={`theme-shelf ${styles.shelf}`}>
      <header className={styles.masthead}>
        <div>
          <p className={styles.kicker}>A place to read</p>
          <div className={`wordmark ${styles.wordmark}`}>Audm</div>
          <p className={`byline ${styles.tagline}`}>
            Bound work stands on the shelf. Loose documents lie in the drawer.
            Open anything to read it in one quiet column.
          </p>
        </div>
        <nav className={styles.nav}>
          <Link href="/shortcuts">Shortcuts</Link>
          <Link href="/login">Sign in</Link>
        </nav>
      </header>

      <section className={styles.stage}>
        {empty ? (
          <div className={styles.empty}>
            <p className={styles.emptyLead}>The shelf is empty.</p>
            <p className={styles.emptyHint}>
              Bring a book. A PDF or an EPUB — it will reflow into one quiet
              column, yours to read slowly. Or paste text or a link to file it
              in the drawer.
            </p>
            <UploadDropzone onUploaded={handleUploaded} variant="empty" />
            <ImportPanel onUploaded={handleUploaded} />
          </div>
        ) : (
          <>
            {/* ---- Continue reading ---- */}
            {continueDoc && <ContinueReading doc={continueDoc} />}

            {/* ---- On the Shelf ---- */}
            <div className={styles.secHead}>
              <h2>On the Shelf</h2>
              <span className={styles.secMeta}>
                {books.length === 0
                  ? "empty"
                  : `${books.length} ${
                      books.length === 1 ? "volume" : "volumes"
                    } — scroll →`}
              </span>
            </div>
            {books.length === 0 ? (
              <p className={styles.sectionEmpty}>
                No bound volumes yet — upload a PDF or EPUB.
              </p>
            ) : (
              <div className={styles.shelfFrame}>
                <button
                  className={`${styles.navBtn} ${styles.navPrev}`}
                  aria-label="Scroll left"
                  onClick={scrollPrev}
                  disabled={!canPrev}
                >
                  ‹
                </button>
                <div
                  ref={scrollerRef}
                  className={`${styles.scroller} ${
                    dragging ? styles.dragging : ""
                  }`}
                  role="list"
                >
                  {books.map((doc) => (
                    <BookObject
                      key={doc.id}
                      doc={doc}
                      variant="book"
                      onDelete={handleDelete}
                      onRunOcr={handleRunOcr}
                      onClickCapture={onClickCapture}
                    />
                  ))}
                </div>
                <button
                  className={`${styles.navBtn} ${styles.navNext}`}
                  aria-label="Scroll right"
                  onClick={scrollNext}
                  disabled={!canNext}
                >
                  ›
                </button>
              </div>
            )}

            {/* ---- In the Drawer ---- */}
            <div className={styles.secHead}>
              <h2>In the Drawer</h2>
              <span className={styles.secMeta}>
                {drawer.length === 0
                  ? "empty"
                  : `${drawer.length} ${
                      drawer.length === 1 ? "file" : "files"
                    }`}
              </span>
            </div>
            {drawer.length === 0 ? (
              <p className={styles.sectionEmpty}>
                No loose documents — paste text or import a link below.
              </p>
            ) : (
              <div className={styles.grid} role="list">
                {drawer.map((doc) => (
                  <BookObject
                    key={doc.id}
                    doc={doc}
                    variant="doc"
                    onDelete={handleDelete}
                    onRunOcr={handleRunOcr}
                  />
                ))}
              </div>
            )}

            {/* ---- Add more ---- */}
            <div className={styles.addMore}>
              <div>
                <p className={styles.addLabel}>Add a book</p>
                <UploadDropzone onUploaded={handleUploaded} variant="row" />
              </div>
              <div>
                <p className={styles.addLabel}>File a document</p>
                <ImportPanel onUploaded={handleUploaded} />
              </div>
            </div>
          </>
        )}
      </section>
    </main>
  );
}
