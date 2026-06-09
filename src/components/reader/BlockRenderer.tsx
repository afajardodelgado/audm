import { memo } from "react";
import type { BlockData } from "@/lib/types";
import { splitSentences } from "@/lib/extract/segment";
import styles from "./Reader.module.css";

// Render one block as a heading/quote/paragraph/list-item, with each sentence
// wrapped in a <span data-sid="blockIndex:sentenceIndex">. The same
// Intl.Segmenter used server-side guarantees identical boundaries, so anchors
// stay valid. Sentences are joined with a single space (whitespace-collapsed
// upstream), so offsets within a sentence are exact.
//
// Each block also carries a left-margin number (its 1-based index) for visual
// indexing — a quiet "line number" the reader can scan or click to jump to.
function BlockRendererImpl({ block }: { block: BlockData }) {
  // The margin number; clickable (handled by the reader via data-block-idx).
  const num = (
    <span
      className={styles.blockNum}
      data-block-idx={block.index}
      aria-hidden
    >
      {block.index + 1}
    </span>
  );

  // Inline images (EPUB figures): no data-sid spans, so narration, the
  // current-line observer, and anchoring all skip the block; its text is the
  // alt/caption. width/height reserve the aspect-ratio box so lazy loading
  // doesn't shift the restored reading position.
  if (block.type === "image") {
    return (
      <figure className={`${styles.numbered} ${styles.imageBlock}`}>
        {num}
        {block.src && (
          // eslint-disable-next-line @next/next/no-img-element -- own-volume asset; next/image's optimizer adds nothing here
          <img
            className={styles.image}
            src={block.src}
            alt={block.text}
            width={block.width ?? undefined}
            height={block.height ?? undefined}
            loading="lazy"
            decoding="async"
          />
        )}
      </figure>
    );
  }

  const sentences = splitSentences(block.text);
  const spans = sentences.map((s, si) => (
    <span key={si} data-sid={`${block.index}:${si}`}>
      {s}
      {si < sentences.length - 1 ? " " : ""}
    </span>
  ));

  switch (block.type) {
    case "heading": {
      const level = Math.min(3, Math.max(1, block.level ?? 2));
      const Tag = (`h${level}` as "h1" | "h2" | "h3");
      return (
        <Tag className={styles.numbered}>
          {num}
          {spans}
        </Tag>
      );
    }
    case "blockquote":
      return (
        <blockquote className={styles.numbered}>
          {num}
          {spans}
        </blockquote>
      );
    case "listitem":
      return (
        <p className={`${styles.listItem} ${styles.numbered}`}>
          {num}
          <span className={styles.bullet} aria-hidden>
            ·
          </span>
          {spans}
        </p>
      );
    default:
      return (
        <p className={styles.numbered}>
          {num}
          {spans}
        </p>
      );
  }
}

export const BlockRenderer = memo(BlockRendererImpl);
