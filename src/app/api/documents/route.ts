import { NextResponse } from "next/server";
import { prisma, LOCAL_USER_ID } from "@/lib/db";
import { bookFromMeta } from "@/lib/types";

export const runtime = "nodejs";

// List the library (newest first), with light counts for the shelf.
export async function GET() {
  const documents = await prisma.document.findMany({
    where: { userId: LOCAL_USER_ID },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      author: true,
      sourceType: true,
      status: true,
      wordCount: true,
      readingProgress: true,
      hasCover: true,
      createdAt: true,
      meta: true,
    },
  });
  // Derive the card's imprint fields server-side; meta itself (which carries
  // the full EPUB table of contents) never ships to the shelf.
  return NextResponse.json({
    documents: documents.map(({ meta, ...d }) => ({ ...d, ...bookFromMeta(meta) })),
  });
}
