"use client";

import styles from "./Reader.module.css";

// A thin left-margin scrubber echoing the Stripe Press film-strip rail.
// Renders a column of ticks; the fill reflects reading progress (0..1).
export default function ProgressRail({ progress }: { progress: number }) {
  const ticks = 28;
  const filled = Math.round(progress * ticks);
  return (
    <div className={styles.rail} aria-hidden>
      {Array.from({ length: ticks }, (_, i) => (
        <span
          key={i}
          className={`${styles.tick} ${i < filled ? styles.tickOn : ""}`}
        />
      ))}
    </div>
  );
}
