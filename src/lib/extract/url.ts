import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { ExtractResult } from "./types";
import { htmlToBlocks } from "./epub";
import { textToResult } from "./text";
import { countBlocksWords } from "./segment";

// Guard rails for fetching user-supplied URLs. Single-use here, so they stay
// domain-local (see the policy note in src/lib/constants.ts).
const FETCH_TIMEOUT_MS = 15_000; // total budget across redirects
const MAX_HTML_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 3;

// SSRF guard: the import route fetches arbitrary user URLs, so no hop may
// reach a private/internal address (localhost, RFC1918, link-local/cloud
// metadata, CGNAT, IPv6 equivalents). Hostnames are resolved up front and every
// resolved address checked. (A hostile DNS server could still re-answer
// differently for the actual connection — full rebinding protection would need
// a pinned-IP dispatcher, deliberately out of scope for now.)
function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  const v6 = ip.toLowerCase();
  if (v6 === "::" || v6 === "::1") return true;
  if (/^fe[89ab]/.test(v6)) return true; // fe80::/10 link-local
  if (v6.startsWith("fc") || v6.startsWith("fd")) return true; // fc00::/7
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  return false;
}

async function assertPublicHost(u: URL): Promise<void> {
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs can be imported.");
  }
  const host = u.hostname.replace(/^\[|\]$/g, ""); // URL brackets IPv6 literals
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    throw new Error("That address isn't reachable from here.");
  }
  const addrs = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true }).catch(() => {
        throw new Error("Could not resolve that host.");
      });
  if (addrs.some((a) => isPrivateIp(a.address))) {
    throw new Error("That address isn't reachable from here.");
  }
}

// Stream the body with a byte cap so a huge (or endless) response can't exhaust
// memory. Assumes UTF-8 — near-universal on the modern web, and Readability is
// tolerant of the rare mojibake from legacy encodings.
async function readBodyCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return res.text();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      void reader.cancel();
      throw new Error("Page too large to import.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Fetch a web page and extract its readable article as paragraph blocks.
 * Uses linkedom (pure-JS DOM, standalone-friendly) + Mozilla Readability, then
 * reuses the EPUB html->blocks walker on the cleaned article HTML so headings
 * and paragraphs survive. The cleaned text is returned too so the caller can
 * store it as the document's source.
 *
 * Redirects are followed manually (up to MAX_REDIRECTS) so every hop passes the
 * SSRF host check, under one overall timeout.
 */
export async function urlToResult(
  url: string
): Promise<{ result: ExtractResult; sourceText: string }> {
  let target = new URL(url);
  let res: Response;
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  for (let hop = 0; ; hop++) {
    await assertPublicHost(target);
    res = await fetch(target, {
      headers: {
        // Some sites gate on a UA; present a normal browser-ish one.
        "user-agent":
          "Mozilla/5.0 (compatible; AudmReader/1.0; +https://github.com/)",
        accept: "text/html,application/xhtml+xml",
      },
      redirect: "manual",
      signal,
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      if (hop >= MAX_REDIRECTS) throw new Error("Too many redirects.");
      void res.body?.cancel();
      target = new URL(loc, target);
      continue;
    }
    break;
  }
  if (!res.ok) {
    throw new Error(`Could not fetch the page (HTTP ${res.status}).`);
  }
  const declaredLength = res.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_HTML_BYTES) {
    throw new Error("Page too large to import.");
  }
  const html = await readBodyCapped(res, MAX_HTML_BYTES);

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
      const wordCount = countBlocksWords(blocks);
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
