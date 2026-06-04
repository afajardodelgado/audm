import { memo } from "react";
import type { BlockData } from "@/lib/types";
import { splitSentences } from "@/lib/extract/segment";
import styles from "./Reader.module.css";

// Render one block as a heading/quote/paragraph/list-item, with each sentence
// wrapped in a <span data-sid="blockIndex:sentenceIndex">. The same
// Intl.Segmenter used server-side guarantees identical boundaries, so anchors
// stay valid. Sentences are joined with a single space (whitespace-collapsed
// upstream), so offsets within a sentence are exact.
function BlockRendererImpl({ block }: { block: BlockData }) {
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
      return <Tag>{spans}</Tag>;
    }
    case "blockquote":
      return <blockquote>{spans}</blockquote>;
    case "listitem":
      return (
        <p className={styles.listItem}>
          <span className={styles.bullet} aria-hidden>
            ·
          </span>
          {spans}
        </p>
      );
    default:
      return <p>{spans}</p>;
  }
}

export const BlockRenderer = memo(BlockRendererImpl);
