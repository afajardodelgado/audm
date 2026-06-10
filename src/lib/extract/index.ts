import { prisma } from "@/lib/db";
import {
  readStoredFile,
  saveFile,
  coverPathFor,
  imageDirFor,
  imagePathFor,
  deleteStoredDir,
} from "@/lib/storage";
import { extractPdf } from "./pdf";
import { extractEpub } from "./epub";
import { runOcr } from "./ocr";
import { splitSentences } from "./segment";
import type { ExtractResult } from "./types";
import type { Document, SourceType } from "@/generated/prisma/client";

export type { ExtractResult, ExtractedBlock } from "./types";

export async function runExtraction(data: Buffer, sourceType: SourceType): Promise<ExtractResult> {
  return sourceType === "pdf" ? extractPdf(data) : extractEpub(data);
}

// Background extraction operates on a known document id (not a user request), so
// it looks up by primary key without the ownership scoping the API routes use.
function loadDocument(documentId: string) {
  return prisma.document.findUnique({ where: { id: documentId } });
}

/**
 * Persist a successful extraction: replace the document's Blocks (in reading
 * order, each with a sentence count) and flip its status to ready, carrying
 * over freshly extracted metadata. Shared by the normal extraction path, OCR,
 * and the text/URL import path.
 */
export async function persistResult(
  documentId: string,
  doc: Pick<Document, "title" | "author" | "userId">,
  result: ExtractResult
): Promise<void> {
  // Replace the document's image assets before its blocks: clear the previous
  // extraction's directory, then write the new bytes (best-effort, like the
  // cover — a missing asset just 404s and the block shows its alt text).
  await deleteStoredDir(imageDirFor(doc.userId, documentId));
  for (const b of result.blocks) {
    if (b.type !== "image" || !b.src || !b.data) continue;
    try {
      await saveFile(imagePathFor(doc.userId, documentId, b.src), b.data);
    } catch {
      /* asset is best-effort — the block falls back to its alt text */
    }
  }

  await prisma.$transaction([
    prisma.block.deleteMany({ where: { documentId } }),
    prisma.block.createMany({
      data: result.blocks.map((b, index) => ({
        documentId,
        index,
        type: b.type,
        level: b.level ?? null,
        text: b.text,
        // Image alt text must never produce narration sids.
        sentenceCount: b.type === "image" ? 0 : splitSentences(b.text).length,
        src: b.src ?? null,
        width: b.width ?? null,
        height: b.height ?? null,
        layout: b.layout ?? undefined,
      })),
    }),
  ]);

  // Save the cover thumbnail (best-effort) before flipping to ready.
  let hasCover = false;
  if (result.coverImage) {
    try {
      await saveFile(coverPathFor(doc.userId, documentId), result.coverImage);
      hasCover = true;
    } catch {
      /* cover is optional — proceed without it */
    }
  }

  await prisma.document.update({
    where: { id: documentId },
    data: {
      status: "ready",
      wordCount: result.wordCount,
      meta: result.meta,
      hasCover,
      // Prefer embedded metadata; keep the upload-derived title otherwise.
      title: result.title?.trim() || doc.title,
      author: result.author ?? doc.author,
    },
  });
}

/**
 * Read a document's file from storage, extract it, and persist its Blocks.
 * Updates Document.status through extracting -> ready | ocr_needed | failed.
 * Designed to be fire-and-forget after upload (errors are caught + recorded).
 */
export async function extractDocument(documentId: string): Promise<void> {
  const doc = await loadDocument(documentId);
  if (!doc) return;

  await prisma.document.update({
    where: { id: documentId },
    data: { status: "extracting" },
  });

  try {
    const data = await readStoredFile(doc.filePath);
    const result = await runExtraction(data, doc.sourceType);

    if (result.needsOcr) {
      await prisma.document.update({
        where: { id: documentId },
        data: { status: "ocr_needed", meta: result.meta },
      });
      return;
    }

    if (!result.blocks.length) {
      await prisma.document.update({
        where: { id: documentId },
        data: { status: "failed", error: "No readable text found." },
      });
      return;
    }

    await persistResult(documentId, doc, result);
  } catch (err) {
    // Surface in server logs too — the DB error field only reaches the shelf UI.
    console.error(`[extract] Document ${documentId} failed:`, err);
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: "failed",
        error: err instanceof Error ? err.message : "Extraction failed.",
      },
    });
  }
}

/**
 * OCR a scanned PDF (status ocr_needed) and persist its recognized text.
 * Status flow: ocr_needed -> ocr_running -> ready | failed.
 * User-initiated and slow (~seconds/page) — run fire-and-forget; the shelf
 * polls for completion.
 */
export async function extractDocumentOcr(documentId: string): Promise<void> {
  const doc = await loadDocument(documentId);
  if (!doc) return;

  await prisma.document.update({
    where: { id: documentId },
    data: { status: "ocr_running", error: null },
  });

  try {
    const data = await readStoredFile(doc.filePath);
    const result = await runOcr(data);

    if (!result.blocks.length) {
      await prisma.document.update({
        where: { id: documentId },
        data: { status: "failed", error: "OCR found no readable text." },
      });
      return;
    }

    await persistResult(documentId, doc, result);
  } catch (err) {
    console.error(`[ocr] Document ${documentId} failed:`, err);
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: "failed",
        error: err instanceof Error ? err.message : "OCR failed.",
      },
    });
  }
}
