"use client";

import { useCallback, useRef, useState } from "react";
import type { DocumentSummary } from "@/lib/types";
import { postForDocument } from "@/lib/api";
import styles from "./Shelf.module.css";

export default function UploadDropzone({
  onUploaded,
  variant,
}: {
  onUploaded: (doc: DocumentSummary) => void;
  variant: "empty" | "row";
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const form = new FormData();
        form.append("file", file);
        onUploaded(await postForDocument("/api/upload", form));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setBusy(false);
      }
    },
    [onUploaded]
  );

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (file) void upload(file);
    },
    [upload]
  );

  return (
    <div
      className={`${variant === "empty" ? styles.dropEmpty : styles.dropRow} ${
        dragging ? styles.dropActive : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles(e.dataTransfer.files);
      }}
      onClick={() => !busy && inputRef.current?.click()}
      role="button"
      tabIndex={0}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.epub,application/pdf,application/epub+zip"
        hidden
        onChange={(e) => onFiles(e.target.files)}
      />
      <span className={styles.dropLabel}>
        {busy
          ? "Reading…"
          : variant === "empty"
            ? "Drop a PDF or EPUB, or click to choose"
            : "Add another book"}
      </span>
      {error && <span className={styles.dropError}>{error}</span>}
    </div>
  );
}
