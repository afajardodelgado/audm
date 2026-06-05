"use client";

import Link from "next/link";
import { useState } from "react";
import type { DocumentSummary } from "@/lib/types";
import styles from "./Shelf.module.css";

const STATUS_LABEL: Record<DocumentSummary["status"], string> = {
  pending: "Preparing…",
  extracting: "Reflowing…",
  ready: "",
  failed: "Couldn’t be read",
  ocr_needed: "Scanned — no text layer",
  ocr_running: "Reading the page…",
};

export default function BookObject({
  doc,
  onDelete,
  onRunOcr,
}: {
  doc: DocumentSummary;
  onDelete: (id: string) => void;
  onRunOcr: (id: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const isReady = doc.status === "ready";
  const isBusy =
    doc.status === "pending" ||
    doc.status === "extracting" ||
    doc.status === "ocr_running";
  const canOcr = doc.status === "ocr_needed";
  const minutes = doc.wordCount ? Math.max(1, Math.round(doc.wordCount / 220)) : 0;
  const percent = Math.round((doc.readingProgress ?? 0) * 100);

  const inner = (
    <article
      className={`${styles.book} ${isReady ? styles.bookReady : ""} ${
        isBusy ? styles.bookBusy : ""
      } ${doc.hasCover ? styles.bookHasCover : ""}`}
      data-type={doc.sourceType}
    >
      <div className={styles.bookSpine} aria-hidden />
      <div className={styles.bookFace}>
        {doc.hasCover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/files/${doc.id}/cover`}
            alt=""
            className={styles.bookCover}
            loading="lazy"
          />
        )}
        <span className={styles.bookType}>{doc.sourceType.toUpperCase()}</span>
        <h2 className={styles.bookTitle}>{doc.title}</h2>
        {doc.author && <p className={styles.bookAuthor}>{doc.author}</p>}
        <div className={styles.bookMeta}>
          {isReady && percent > 0 && (
            <span className={styles.bookProgress}>{percent}% read</span>
          )}
          {isReady && percent === 0 && minutes > 0 && (
            <span>{minutes} min read</span>
          )}
          {!isReady && (
            <span className={styles.bookStatus}>{STATUS_LABEL[doc.status]}</span>
          )}
          {canOcr && (
            <button
              type="button"
              className={styles.ocrBtn}
              onClick={() => onRunOcr(doc.id)}
            >
              Run OCR
            </button>
          )}
        </div>
      </div>
    </article>
  );

  return (
    <div className={styles.bookWrap}>
      {isReady ? (
        <Link href={`/read/${doc.id}`} className={styles.bookLink}>
          {inner}
        </Link>
      ) : (
        <div className={styles.bookLink}>{inner}</div>
      )}

      {confirming ? (
        <div className={styles.bookActions}>
          <button
            className={styles.confirmDelete}
            onClick={() => onDelete(doc.id)}
          >
            Remove
          </button>
          <button onClick={() => setConfirming(false)}>Keep</button>
        </div>
      ) : (
        <button
          className={styles.removeBtn}
          aria-label="Remove from shelf"
          onClick={() => setConfirming(true)}
        >
          ×
        </button>
      )}
    </div>
  );
}
