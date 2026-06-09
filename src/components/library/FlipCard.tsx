"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import type { DocumentSummary } from "@/lib/types";
import { bindingFor } from "./bindings";
import styles from "./Shelf.module.css";

// A library item as a flip card: the front is a clean cover thumbnail; hovering
// or focusing flips it to reveal the details and the read action (progressive
// disclosure — Hick). The whole card is one link target (Fitts); remove / OCR
// sit on top as separate controls. Works for every source type — there's no
// shelf/drawer split any more, just one gallery.

const STATUS_LABEL: Record<DocumentSummary["status"], string> = {
  pending: "Preparing…",
  extracting: "Reflowing…",
  ready: "",
  failed: "Couldn’t be read",
  ocr_needed: "Scanned — no text layer",
  ocr_running: "Reading the page…",
};

export default function FlipCard({
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
  const percent = progress > 0 ? Math.max(1, Math.round(progress * 100)) : 0;
  const started = isReady && percent > 0;

  const [cloth, , ink] = bindingFor(doc.id);
  const coverVars = {
    "--clothColor": cloth,
    "--inkColor": ink,
    "--coverImg": doc.hasCover ? `url(/api/files/${doc.id}/cover)` : "none",
  } as CSSProperties;

  // Imprint line (EPUB book metadata) — quiet identity detail on the back.
  const imprint = [doc.publisher, doc.year].filter(Boolean).join(" · ");

  const front = (
    <span className={styles.fcFront}>
      <span
        className={`${styles.fcCover} ${doc.hasCover ? styles.fcCoverImg : ""}`}
        style={coverVars}
      >
        {!doc.hasCover && (
          <>
            <span className={styles.fcCoverType}>
              {doc.sourceType.toUpperCase()}
            </span>
            <span className={styles.fcCoverTitle}>{doc.title}</span>
            {doc.author && (
              <span className={styles.fcCoverAuthor}>{doc.author}</span>
            )}
          </>
        )}
      </span>
    </span>
  );

  const back = (
    <span className={styles.fcBack}>
      <span className={styles.fcType}>{doc.sourceType.toUpperCase()}</span>
      <span className={styles.fcTitle}>{doc.title}</span>
      {doc.author && <span className={styles.fcAuthor}>{doc.author}</span>}
      {imprint && <span className={styles.fcMeta}>{imprint}</span>}
      <span className={styles.fcSpacer} />
      {isReady ? (
        <>
          {started ? (
            <span className={styles.fcProgress}>
              <span className={styles.fcBar}>
                <span style={{ width: `${percent}%` }} />
              </span>
              {percent}%
            </span>
          ) : minutes > 0 ? (
            <span className={styles.fcMeta}>{minutes} min read</span>
          ) : null}
          <span className={styles.fcCta}>{started ? "Resume →" : "Read →"}</span>
        </>
      ) : (
        <span className={styles.fcStatus}>{STATUS_LABEL[doc.status]}</span>
      )}
    </span>
  );

  const inner = (
    <span className={styles.fcInner}>
      {front}
      {back}
    </span>
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
      className={styles.removeBtn}
      aria-label="Remove from library"
      onClick={() => setConfirming(true)}
    >
      ×
    </button>
  );

  return (
    <div className={styles.fcWrap} role="listitem">
      {isReady ? (
        <Link
          href={`/read/${doc.id}`}
          className={`${styles.fc} ${started ? styles.fcStarted : ""}`}
          aria-label={`${started ? "Resume" : "Read"} ${doc.title}${
            doc.author ? ` by ${doc.author}` : ""
          }`}
        >
          {inner}
        </Link>
      ) : (
        <div
          className={`${styles.fc} ${styles.fcBusy}`}
          aria-label={`${doc.title} — ${STATUS_LABEL[doc.status]}`}
        >
          {inner}
        </div>
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
