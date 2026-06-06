"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
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

// Muted cloth bindings, on-palette. Chosen per book by a stable hash of its id
// so the shelf has variety but a given book always looks the same. Each entry:
// [spine/cloth color, cover color, ink color for text on that cloth].
const BINDINGS: ReadonlyArray<readonly [string, string, string]> = [
  ["#1f3a34", "#16302b", "#f0e9d8"], // deep green
  ["#6f241a", "#561a12", "#f3e2cf"], // oxblood
  ["#2b2b30", "#1f1f24", "#ead9c2"], // charcoal
  ["#34503f", "#264031", "#eef0e2"], // forest
  ["#3a2f28", "#2a211c", "#ece7da"], // espresso (house)
  ["#21384d", "#182a3a", "#eaf0f6"], // slate blue
  ["#e6dcc4", "#d8ccae", "#2a3340"], // bone (dark ink)
];

function bindingFor(id: string): readonly [string, string, string] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return BINDINGS[h % BINDINGS.length];
}

export default function BookObject({
  doc,
  variant,
  onDelete,
  onRunOcr,
  onClickCapture,
}: {
  doc: DocumentSummary;
  variant: "book" | "doc";
  onDelete: (id: string) => void;
  onRunOcr: (id: string) => void;
  /** From the shelf scroller — swallows a click that was really a drag. */
  onClickCapture?: (e: React.MouseEvent) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const isReady = doc.status === "ready";
  const isBusy =
    doc.status === "pending" ||
    doc.status === "extracting" ||
    doc.status === "ocr_running";
  const isFailed = doc.status === "failed";
  const canOcr = doc.status === "ocr_needed";
  const minutes = doc.wordCount ? Math.max(1, Math.round(doc.wordCount / 220)) : 0;
  const percent = Math.round((doc.readingProgress ?? 0) * 100);

  const removeUi = confirming ? (
    <div className={styles.actions}>
      <button className={styles.confirmDelete} onClick={() => onDelete(doc.id)}>
        Remove
      </button>
      <button onClick={() => setConfirming(false)}>Keep</button>
    </div>
  ) : (
    <button
      className={styles.removeBtn}
      aria-label="Remove from library"
      onClick={() => setConfirming(true)}
    >
      ×
    </button>
  );

  // ---- Bound volume (pdf / epub) → 3D book on the shelf ----
  if (variant === "book") {
    const [cloth, cover, ink] = bindingFor(doc.id);
    const faceVars = {
      "--clothColor": cloth,
      "--coverColor": doc.hasCover
        ? `url(/api/files/${doc.id}/cover)`
        : cover,
      "--inkColor": ink,
    } as CSSProperties;

    const book = (
      <button
        type="button"
        className={`${styles.book} ${isBusy ? styles.bookBusy : ""} ${
          isFailed ? styles.bookFailed : ""
        }`}
        style={faceVars}
        aria-label={`${doc.title}${doc.author ? ` — ${doc.author}` : ""}`}
        // Non-ready books shouldn't navigate; the Link wrapper handles ready.
        tabIndex={isReady ? -1 : 0}
      >
        <span className={`${styles.face} ${styles.fPages}`} />
        <span className={`${styles.face} ${styles.fBack} ${styles.cloth}`} />
        <span className={`${styles.face} ${styles.fBottom}`} />
        <span className={`${styles.face} ${styles.fTop}`} />
        <span className={`${styles.face} ${styles.fCover} ${styles.cloth}`}>
          {!doc.hasCover && (
            <>
              <span className={styles.cvType}>{doc.sourceType.toUpperCase()}</span>
              <span className={styles.cvTitle}>{doc.title}</span>
              {doc.author && <span className={styles.cvAuthor}>{doc.author}</span>}
            </>
          )}
        </span>
        <span className={`${styles.face} ${styles.fSpine} ${styles.cloth}`}>
          <span className={styles.spineRow}>
            {doc.author && <em className={styles.spineAuthor}>{doc.author}</em>}
            <b className={styles.spineTitle}>{doc.title}</b>
            {isReady ? (
              <i className={styles.spineMark} aria-hidden />
            ) : (
              <span className={styles.spineStatus}>{STATUS_LABEL[doc.status]}</span>
            )}
          </span>
        </span>
      </button>
    );

    return (
      <div className={styles.bookWrap} onClickCapture={onClickCapture}>
        {isReady ? (
          <Link
            href={`/read/${doc.id}`}
            aria-label={`Read ${doc.title}`}
            style={{ display: "contents" }}
          >
            {book}
          </Link>
        ) : (
          book
        )}
        {canOcr && (
          <button
            type="button"
            className={styles.ocrBtn}
            style={{ position: "absolute", bottom: "-2.4rem", left: "50%", transform: "translateX(-50%)" }}
            onClick={() => onRunOcr(doc.id)}
          >
            Run OCR
          </button>
        )}
        {removeUi}
      </div>
    );
  }

  // ---- Loose document (text / web) → flat card in the drawer ----
  const card = (
    <article
      className={`${styles.doc} ${isReady ? styles.docReady : ""} ${
        isBusy ? styles.docBusy : ""
      }`}
      data-type={doc.sourceType}
    >
      <span className={styles.docType}>{doc.sourceType.toUpperCase()}</span>
      <div className={styles.docPrev} aria-hidden>
        <span />
        <span />
        <span />
        <span />
        <span />
      </div>
      <h2 className={styles.docTitle}>{doc.title}</h2>
      <div className={styles.docMeta}>
        {isReady && percent > 0 ? (
          <span className={styles.docProgress}>{percent}% read</span>
        ) : isReady && minutes > 0 ? (
          <span>{minutes} min read</span>
        ) : (
          <span className={styles.docStatus}>{STATUS_LABEL[doc.status]}</span>
        )}
        {doc.author && <span>{doc.author}</span>}
      </div>
      {canOcr && (
        <button type="button" className={styles.ocrBtn} onClick={() => onRunOcr(doc.id)}>
          Run OCR
        </button>
      )}
    </article>
  );

  return (
    <div className={styles.docWrap}>
      {isReady ? (
        <Link href={`/read/${doc.id}`} className={styles.docLink}>
          {card}
        </Link>
      ) : (
        <div className={styles.docLink}>{card}</div>
      )}
      {removeUi}
    </div>
  );
}
