"use client";

import { useEffect, useRef } from "react";
import type { ChapterRef } from "@/lib/types";
import styles from "./Reader.module.css";

// The reader's table of contents — a quiet dropdown in the top bar (Jakob's
// Law: readers keep "Contents" in the top-left navigation cluster). The list
// scrolls for long books and opens with the chapter being read in view; that
// entry carries the gold seam plus a check glyph (Von Restorff — state is
// never signalled by colour alone). Outside-pointerdown closes it, mirroring
// the library toolbar's menus; Escape and the `t` toggle live in the reader's
// keyboard handler so they can take priority over narration keys.
export default function ContentsMenu({
  toc,
  open,
  currentIndex,
  onToggle,
  onClose,
  onSelect,
}: {
  toc: ChapterRef[];
  open: boolean;
  currentIndex: number; // -1 before the first chapter
  onToggle: () => void;
  onClose: () => void;
  onSelect: (entry: ChapterRef) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open, onClose]);

  // Long books: surface the chapter being read, not the top of the list.
  useEffect(() => {
    if (open) activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  return (
    <div className={styles.contentsWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.contentsBtn}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span aria-hidden>☰</span> Contents
      </button>
      {open && (
        <ul className={styles.contentsMenu} role="listbox" aria-label="Contents">
          {toc.map((entry, i) => (
            <li key={`${entry.block}-${i}`}>
              <button
                type="button"
                role="option"
                aria-selected={i === currentIndex}
                ref={i === currentIndex ? activeRef : undefined}
                className={`${styles.contentsItem} ${
                  i === currentIndex ? styles.contentsItemActive : ""
                } ${entry.depth === 1 ? styles.contentsItemDeep : ""}`}
                onClick={() => onSelect(entry)}
              >
                <span className={styles.contentsCheck} aria-hidden>
                  {i === currentIndex ? "✓" : ""}
                </span>
                {entry.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
