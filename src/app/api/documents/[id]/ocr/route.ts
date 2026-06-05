import { NextRequest, NextResponse } from "next/server";
import { prisma, LOCAL_USER_ID } from "@/lib/db";
import { extractDocumentOcr } from "@/lib/extract";

export const runtime = "nodejs";
// OCR is slow; give the worker room even though we don't await it on the request.
export const maxDuration = 300;

/**
 * Kick off OCR for a scanned PDF. Responds 202 immediately and runs OCR
 * fire-and-forget; the shelf polls /api/documents for the status transition
 * (ocr_needed -> ocr_running -> ready | failed).
 *
 * Caveat: a server restart mid-OCR strands the doc in ocr_running. A
 * stale-status sweep is a post-MVP hardening step.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const doc = await prisma.document.findFirst({
    where: { id, userId: LOCAL_USER_ID },
  });
  if (!doc) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  if (doc.sourceType !== "pdf") {
    return NextResponse.json({ error: "OCR only applies to PDFs." }, { status: 400 });
  }
  if (doc.status !== "ocr_needed") {
    return NextResponse.json(
      { error: "Document is not awaiting OCR." },
      { status: 409 }
    );
  }

  // Fire-and-forget: don't await, so the request returns before the long run.
  void extractDocumentOcr(id);

  return NextResponse.json({ status: "ocr_running" }, { status: 202 });
}
