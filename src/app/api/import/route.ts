import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma, ensureLocalUser } from "@/lib/db";
import { filePathFor, saveFile } from "@/lib/storage";
import { persistResult } from "@/lib/extract";
import { textToResult } from "@/lib/extract/text";
import { urlToResult } from "@/lib/extract/url";
import type { ExtractResult } from "@/lib/extract/types";
import type { SourceType } from "@/generated/prisma/client";

export const runtime = "nodejs";

const MAX_TEXT_CHARS = 2_000_000; // ~2MB of pasted text

interface ImportBody {
  kind?: "text" | "url";
  title?: string;
  text?: string;
  url?: string;
}

export async function POST(req: NextRequest) {
  let body: ImportBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  let sourceType: SourceType;
  let result: ExtractResult;
  let sourceText: string;
  let fallbackTitle: string;

  try {
    if (body.kind === "text") {
      const text = (body.text ?? "").trim();
      if (!text) {
        return NextResponse.json({ error: "No text provided." }, { status: 400 });
      }
      if (text.length > MAX_TEXT_CHARS) {
        return NextResponse.json({ error: "Text too long." }, { status: 413 });
      }
      sourceType = "text";
      fallbackTitle = body.title?.trim() || firstLineTitle(text);
      result = textToResult(text, fallbackTitle);
      sourceText = text;
    } else if (body.kind === "url") {
      const url = (body.url ?? "").trim();
      if (!isHttpUrl(url)) {
        return NextResponse.json({ error: "Enter a valid http(s) URL." }, { status: 400 });
      }
      sourceType = "web";
      const extracted = await urlToResult(url);
      result = extracted.result;
      sourceText = extracted.sourceText;
      fallbackTitle = body.title?.trim() || result.title || url;
    } else {
      return NextResponse.json({ error: "Unknown import kind." }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed." },
      { status: 502 }
    );
  }

  if (!result.blocks.length) {
    return NextResponse.json(
      { error: "No readable text was found." },
      { status: 422 }
    );
  }

  const userId = await ensureLocalUser();
  const fileHash = createHash("sha256").update(sourceText).digest("hex");

  const doc = await prisma.document.create({
    data: {
      userId,
      title: (result.title?.trim() || fallbackTitle || "Untitled").slice(0, 300),
      sourceType,
      filePath: "",
      fileHash,
      status: "pending",
    },
  });

  // Store the raw source so the document can be re-extracted/debugged later.
  const absPath = filePathFor(userId, doc.id, sourceType);
  await saveFile(absPath, Buffer.from(sourceText, "utf8"));
  await prisma.document.update({
    where: { id: doc.id },
    data: { filePath: absPath },
  });

  // No heavy async work — persist inline like the upload path.
  await persistResult(doc.id, doc, result);

  const final = await prisma.document.findUnique({ where: { id: doc.id } });
  return NextResponse.json({ document: final }, { status: 201 });
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function firstLineTitle(text: string): string {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  return firstLine.trim().slice(0, 80) || "Pasted text";
}
