import { prisma } from "@/lib/db";
import { readStoredFile } from "@/lib/storage";
import { extractPdf } from "./pdf";
import { extractEpub } from "./epub";
import { splitSentences } from "./segment";
import type { ExtractResult } from "./types";
import type { SourceType } from "@/generated/prisma/client";

export type { ExtractResult, ExtractedBlock } from "./types";

export async function runExtraction(data: Buffer, sourceType: SourceType): Promise<ExtractResult> {
  return sourceType === "pdf" ? extractPdf(data) : extractEpub(data);
}

/**
 * Read a document's file from storage, extract it, and persist its Blocks.
 * Updates Document.status through extracting -> ready | ocr_needed | failed.
 * Designed to be fire-and-forget after upload (errors are caught + recorded).
 */
export async function extractDocument(documentId: string): Promise<void> {
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
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

    // Persist blocks in reading order with a per-block sentence count.
    await prisma.$transaction([
      prisma.block.deleteMany({ where: { documentId } }),
      prisma.block.createMany({
        data: result.blocks.map((b, index) => ({
          documentId,
          index,
          type: b.type,
          level: b.level ?? null,
          text: b.text,
          sentenceCount: splitSentences(b.text).length,
        })),
      }),
    ]);

    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: "ready",
        wordCount: result.wordCount,
        meta: result.meta,
        // Prefer embedded metadata; keep the upload-derived title otherwise.
        title: result.title?.trim() || doc.title,
        author: result.author ?? doc.author,
      },
    });
  } catch (err) {
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: "failed",
        error: err instanceof Error ? err.message : "Extraction failed.",
      },
    });
  }
}
