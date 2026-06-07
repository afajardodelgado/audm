"use client";

import Link from "next/link";
import { useState } from "react";
import type { CSSProperties } from "react";
import type { DocumentSummary } from "@/lib/types";
import { bindingFor } from "./bindings";
import styles from "./Shelf.module.css";

// The "register" (list) view of a single item — a card-catalog row. A slim
// spine-strip carries the book's cloth colour so a volume keeps its identity
// out of the 3D shelf. The whole row is the tap target (Fitts).

const STATUS_LABEL: Record<DocumentSummary["status"], string> = {
  pending: "Preparing…",
  extracting: "Reflowing…",
  ready: "",
  failed: "Couldn’t be read",
  ocr_needed: "Scanned — no text layer",
  ocr_running: "Reading the page…",
};

export default function RegisterRow({
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
  const canOcr = doc.status === "ocr_needed";
  const minutes = doc.wordCount
    ? Math.max(1, Math.round(doc.wordCount / 220))
    : 0;
  const progress = doc.readingProgress ?? 0;
  // Floor a started book to "1% read" so any in-progress item reads as such
  // (a book the Reading filter keeps must never display as "min read").
  const percent = progress > 0 ? Math.max(1, Math.round(progress * 100)) : 0;

  const [cloth] = bindingFor(doc.id);
  const spineVar = { "--clothColor": cloth } as CSSProperties;

  const meta =
    isReady && percent > 0 ? (
      <span className={styles.regProgress}>{percent}% read</span>
    ) : isReady && minutes > 0 ? (
      <span>{minutes} min read</span>
    ) : (
      <span className={styles.regStatus}>{STATUS_LABEL[doc.status]}</span>
    );

  const inner = (
    <>
      <span className={styles.regSpine} style={spineVar} aria-hidden />
      <span className={styles.regType}>{doc.sourceType.toUpperCase()}</span>
      <span className={styles.regTitle}>{doc.title}</span>
      {doc.author && <span className={styles.regAuthor}>{doc.author}</span>}
      <span className={styles.regMeta}>{meta}</span>
    </>
  );

  const removeUi = confirming ? (
    <div className={styles.actions}>
      <button className={styles.confirmDelete} onClick={() => onDelete(doc.id)}>
        Remove
      </button>
      <button onClick={() => setConfirming(false)}>Keep</button>
    </div>
  ) : (
    <button
      className={styles.regRemove}
      aria-label="Remove from library"
      onClick={() => setConfirming(true)}
    >
      ×
    </button>
  );

  return (
    <div className={styles.regRow} role="listitem">
      {isReady ? (
        <Link
          href={`/read/${doc.id}`}
          className={styles.regLink}
          aria-label={`Read ${doc.title}`}
        >
          {inner}
        </Link>
      ) : (
        <div className={styles.regLink}>{inner}</div>
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
      {removeUi}
    </div>
  );
}
