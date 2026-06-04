"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./Reader.module.css";

// Quiet prompt shown right after a highlight: type a comment (Enter to save)
// or dismiss (Esc / "Skip"). The highlight persists either way.
export default function CommentPopover({
  onSave,
  onSkip,
}: {
  onSave: (body: string) => void | Promise<void>;
  onSkip: () => void;
}) {
  const [body, setBody] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div className={styles.popoverBackdrop} onClick={onSkip}>
      <div className={styles.popover} onClick={(e) => e.stopPropagation()}>
        <div className={styles.popoverLabel}>Add a note?</div>
        <textarea
          ref={ref}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSave(body);
            }
            if (e.key === "Escape") {
              e.preventDefault();
              onSkip();
            }
          }}
          placeholder="Leave it blank to just highlight…"
          rows={3}
        />
        <div className={styles.popoverActions}>
          <button className={styles.popoverSkip} onClick={onSkip}>
            Skip
          </button>
          <button className={styles.popoverSave} onClick={() => void onSave(body)}>
            Save note
          </button>
        </div>
      </div>
    </div>
  );
}
