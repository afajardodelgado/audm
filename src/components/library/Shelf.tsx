"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { DocumentSummary } from "@/lib/types";
import BookObject from "./BookObject";
import UploadDropzone from "./UploadDropzone";
import ImportPanel from "./ImportPanel";
import styles from "./Shelf.module.css";

export default function Shelf({ initial }: { initial: DocumentSummary[] }) {
  const [docs, setDocs] = useState<DocumentSummary[]>(initial);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  return (
    <main className={`theme-shelf ${styles.shelf}`}>
      <header className={styles.masthead}>
        <div>
          <div className={`wordmark ${styles.wordmark}`}>Audm</div>
          <div className={`byline ${styles.tagline}`}>A place to read</div>
        </div>
        <nav className={styles.nav}>
          <Link href="/shortcuts">Shortcuts</Link>
          <Link href="/login">Sign in</Link>
        </nav>
      </header>

      <section className={styles.stage}>
        {docs.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyLead}>The shelf is empty.</p>
            <p className={styles.emptyHint}>
              Bring a book. A PDF or an EPUB — it will reflow into one quiet
              column, yours to read slowly.
            </p>
            <UploadDropzone onUploaded={handleUploaded} variant="empty" />
            <ImportPanel onUploaded={handleUploaded} />
          </div>
        ) : (
          <>
            <div className={styles.books}>
              {docs.map((doc) => (
                <BookObject
                  key={doc.id}
                  doc={doc}
                  onDelete={handleDelete}
                  onRunOcr={handleRunOcr}
                />
              ))}
            </div>
            <div className={styles.addMore}>
              <UploadDropzone onUploaded={handleUploaded} variant="row" />
              <ImportPanel onUploaded={handleUploaded} />
            </div>
          </>
        )}
      </section>
    </main>
  );
}
