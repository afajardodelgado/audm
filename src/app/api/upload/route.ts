import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma, ensureLocalUser } from "@/lib/db";
import { filePathFor, saveFile } from "@/lib/storage";
import { extractDocument } from "@/lib/extract";
import { MAX_UPLOAD_BYTES } from "@/lib/constants";
import type { SourceType } from "@/generated/prisma/client";

export const runtime = "nodejs";

function detectType(name: string, mime: string): SourceType | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pdf") || mime === "application/pdf") return "pdf";
  if (lower.endsWith(".epub") || mime === "application/epub+zip") return "epub";
  return null;
}

function titleFromFilename(name: string): string {
  return name
    .replace(/\.(pdf|epub)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File too large (max 80 MB)." }, { status: 413 });
  }

  const sourceType = detectType(file.name, file.type);
  if (!sourceType) {
    return NextResponse.json(
      { error: "Only PDF and EPUB files are supported." },
      { status: 415 }
    );
  }

  const userId = await ensureLocalUser();
  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash("sha256").update(buffer).digest("hex");

  const doc = await prisma.document.create({
    data: {
      userId,
      title: titleFromFilename(file.name) || "Untitled",
      sourceType,
      filePath: "", // set below once we know the id
      fileHash,
      status: "pending",
    },
  });

  const absPath = filePathFor(userId, doc.id, sourceType);
  await saveFile(absPath, buffer);
  await prisma.document.update({
    where: { id: doc.id },
    data: { filePath: absPath },
  });

  // Extract inline so the client can poll status immediately. (Fast for typical
  // documents; a queue is the post-MVP upgrade for very large files.)
  await extractDocument(doc.id);

  const final = await prisma.document.findUnique({ where: { id: doc.id } });
  return NextResponse.json({ document: final }, { status: 201 });
}
