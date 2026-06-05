import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { ExtractResult } from "./types";
import { htmlToBlocks } from "./epub";
import { textToResult } from "./text";
import { countWords } from "./segment";

/**
 * Fetch a web page and extract its readable article as paragraph blocks.
 * Uses linkedom (pure-JS DOM, standalone-friendly) + Mozilla Readability, then
 * reuses the EPUB html->blocks walker on the cleaned article HTML so headings
 * and paragraphs survive. The cleaned text is returned too so the caller can
 * store it as the document's source.
 */
export async function urlToResult(
  url: string
): Promise<{ result: ExtractResult; sourceText: string }> {
  const res = await fetch(url, {
    headers: {
      // Some sites gate on a UA; present a normal browser-ish one.
      "user-agent":
        "Mozilla/5.0 (compatible; AudmReader/1.0; +https://github.com/)",
      accept: "text/html,application/xhtml+xml",
    },
    redirect: "follow",
  });
  if (!res.ok) {
    throw new Error(`Could not fetch the page (HTTP ${res.status}).`);
  }
  const html = await res.text();

  const { document } = parseHTML(html);
  // Readability mutates the document, so it gets its own parse-derived DOM.
  const article = new Readability(
    document as unknown as Document
  ).parse();

  const fallbackTitle =
    article?.title?.trim() ||
    document.querySelector("title")?.textContent?.trim() ||
    new URL(url).hostname;

  if (article?.content) {
    const blocks = htmlToBlocks(article.content);
    if (blocks.length) {
      const wordCount = blocks.reduce((n, b) => n + countWords(b.text), 0);
      const sourceText = blocks.map((b) => b.text).join("\n\n");
      return {
        result: {
          title: fallbackTitle,
          author: article.byline?.trim() || undefined,
          blocks,
          wordCount,
          meta: { kind: "web", url },
          needsOcr: false,
        },
        sourceText,
      };
    }
  }

  // Fall back to plain text content if Readability couldn't structure it.
  const text = (article?.textContent ?? document.body?.textContent ?? "").trim();
  if (!text) throw new Error("No readable content found at that URL.");
  const result = textToResult(text, fallbackTitle);
  result.meta = { kind: "web", url };
  return { result, sourceText: text };
}
