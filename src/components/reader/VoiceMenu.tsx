"use client";

import { useEffect, useMemo, useRef } from "react";
import type { NarratorVoice } from "@/lib/narrator/types";
import styles from "./Reader.module.css";

// Narration voice picker — the contents-menu dropdown idiom, opening upward
// from the bottom toolbar. Voices are chunked by accent (Miller's Law) so ~28
// choices scan as a few groups (Hick), and the active voice carries the gold
// seam plus a check glyph (Von Restorff — never colour alone). The voice list
// only exists once the model has loaded, so until then the trigger renders
// disabled with a plain label rather than an empty menu (Doherty — the control
// is honest about why it can't respond yet).

// "Heart (Female)" → "Heart" for the compact trigger label.
function shortName(label: string): string {
  const cut = label.indexOf(" (");
  return cut === -1 ? label : label.slice(0, cut);
}

const ACCENT_LABEL: Record<string, string> = {
  "en-us": "American",
  "en-gb": "British",
};

export default function VoiceMenu({
  voices,
  voiceId,
  open,
  onToggle,
  onClose,
  onSelect,
}: {
  voices: NarratorVoice[];
  voiceId: string | null;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  onSelect: (id: string) => void;
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

  // Surface the chosen voice, not the top of the list.
  useEffect(() => {
    if (open) activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  // Group by accent, preserving the engine's voice order within each group.
  const groups = useMemo(() => {
    const byLang = new Map<string, NarratorVoice[]>();
    for (const v of voices) {
      const list = byLang.get(v.lang) ?? [];
      list.push(v);
      byLang.set(v.lang, list);
    }
    return Array.from(byLang, ([lang, list]) => ({
      label: ACCENT_LABEL[lang] ?? lang,
      list,
    }));
  }, [voices]);

  const current = voices.find((v) => v.id === voiceId);

  return (
    <div className={styles.voiceWrap} ref={wrapRef}>
      <button
        type="button"
        className={styles.voiceBtn}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={!voices.length}
        title={voices.length ? "Narration voice" : "Voices arrive with the voice model"}
        onClick={onToggle}
      >
        <span aria-hidden>♪</span> {current ? shortName(current.label) : "Voice"}
      </button>
      {open && voices.length > 0 && (
        <ul className={styles.voiceMenu} role="listbox" aria-label="Narration voice">
          {groups.map((g) => (
            <li key={g.label}>
              <div className={styles.voiceGroup}>{g.label}</div>
              <ul className={styles.voiceGroupList}>
                {g.list.map((v) => (
                  <li key={v.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={v.id === voiceId}
                      ref={v.id === voiceId ? activeRef : undefined}
                      className={`${styles.contentsItem} ${
                        v.id === voiceId ? styles.contentsItemActive : ""
                      }`}
                      onClick={() => onSelect(v.id)}
                    >
                      <span className={styles.contentsCheck} aria-hidden>
                        {v.id === voiceId ? "✓" : ""}
                      </span>
                      {v.label}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
