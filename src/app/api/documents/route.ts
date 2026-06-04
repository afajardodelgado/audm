import { NextResponse } from "next/server";
import { prisma, LOCAL_USER_ID } from "@/lib/db";

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
      createdAt: true,
    },
  });
  return NextResponse.json({ documents });
}
