"use client";

import Link from "next/link";
import type { DocumentSummary } from "@/lib/types";
import styles from "./Shelf.module.css";

/**
 * Pick the book to resume: the furthest-along document that's started but not
 * finished. Highest progress wins (the one you're most actively in). Returns
 * null when nothing qualifies (fresh library, or everything is finished/unread).
 */
export function pickContinue(docs: DocumentSummary[]): DocumentSummary | null {
  let best: DocumentSummary | null = null;
  for (const d of docs) {
    if (d.status !== "ready") continue;
    const p = d.readingProgress ?? 0;
    if (p <= 0 || p >= 0.98) continue; // not started, or effectively done
    if (!best || p > (best.readingProgress ?? 0)) best = d;
  }
  return best;
}

export default function ContinueReading({ doc }: { doc: DocumentSummary }) {
  const percent = Math.round((doc.readingProgress ?? 0) * 100);

  return (
    <Link href={`/read/${doc.id}`} className={styles.continue} aria-label={`Resume ${doc.title}`}>
      <div className={styles.continueCover} aria-hidden>
        {doc.hasCover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/files/${doc.id}/cover`} alt="" loading="lazy" />
        ) : (
          <span className={styles.continueCoverText}>{doc.title}</span>
        )}
      </div>
      <div className={styles.continueBody}>
        <p className={styles.continueKicker}>Continue reading</p>
        <h2 className={styles.continueTitle}>{doc.title}</h2>
        {doc.author && <p className={styles.continueAuthor}>{doc.author}</p>}
        <div className={styles.continueProgress}>
          <div className={styles.continueBar}>
            <span style={{ width: `${percent}%` }} />
          </div>
          <span className={styles.continuePct}>{percent}% read</span>
        </div>
        <span className={styles.continueResume}>Resume →</span>
      </div>
    </Link>
  );
}
