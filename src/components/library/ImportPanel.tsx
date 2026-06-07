"use client";

import { useCallback, useState } from "react";
import type { DocumentSummary } from "@/lib/types";
import { postForDocument } from "@/lib/api";
import styles from "./Shelf.module.css";

type Tab = "text" | "url";

export default function ImportPanel({
  onUploaded,
  initialTab = "text",
  hideTabs = false,
}: {
  onUploaded: (doc: DocumentSummary) => void;
  /** Open on a specific tab — used by the toolbar's Create Note / Import URL. */
  initialTab?: Tab;
  /** Hide the tab switcher to present a single focused form. */
  hideTabs?: boolean;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const body =
        tab === "text"
          ? { kind: "text" as const, title: title.trim() || undefined, text }
          : { kind: "url" as const, title: title.trim() || undefined, url: url.trim() };
      onUploaded(
        await postForDocument("/api/import", JSON.stringify(body), {
          "content-type": "application/json",
        })
      );
      setText("");
      setUrl("");
      setTitle("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }, [tab, title, text, url, onUploaded]);

  const canSubmit =
    !busy && (tab === "text" ? text.trim().length > 0 : url.trim().length > 0);

  return (
    <div className={styles.importPanel}>
      {!hideTabs && (
        <div className={styles.importTabs} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "text"}
            className={
              tab === "text" ? styles.importTabActive : styles.importTab
            }
            onClick={() => setTab("text")}
          >
            Paste text
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "url"}
            className={tab === "url" ? styles.importTabActive : styles.importTab}
            onClick={() => setTab("url")}
          >
            From URL
          </button>
        </div>
      )}

      <input
        className={styles.importInput}
        placeholder="Title (optional)"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      {tab === "text" ? (
        <textarea
          className={styles.importTextarea}
          placeholder="Paste the text you'd like to read…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
        />
      ) : (
        <input
          className={styles.importInput}
          placeholder="https://example.com/article"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) void submit();
          }}
        />
      )}

      <button
        type="button"
        className={styles.importSubmit}
        disabled={!canSubmit}
        onClick={() => void submit()}
      >
        {busy ? "Reading…" : tab === "text" ? "Add to shelf" : "Fetch & add"}
      </button>

      {error && <span className={styles.dropError}>{error}</span>}
    </div>
  );
}
