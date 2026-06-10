import { notFound } from "next/navigation";
import { prisma, LOCAL_USER_ID } from "@/lib/db";
import Reader from "@/components/reader/Reader";
import { tocFromMeta, pageDimsFromMeta } from "@/lib/types";
import type { BlockData, HighlightData } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReadPage({
  params,
}: {
  params: Promise<{ docId: string }>;
}) {
  const { docId } = await params;

  const document = await prisma.document.findFirst({
    where: { id: docId, userId: LOCAL_USER_ID },
    include: {
      blocks: { orderBy: { index: "asc" } },
      highlights: {
        where: { userId: LOCAL_USER_ID },
        include: { comments: { orderBy: { createdAt: "asc" } } },
      },
    },
  });

  if (!document) notFound();

  const blocks: BlockData[] = document.blocks.map((b) => ({
    id: b.id,
    index: b.index,
    type: b.type,
    level: b.level,
    text: b.text,
    sentenceCount: b.sentenceCount,
    // The DB stores the bare asset filename; the client gets a servable URL.
    src: b.src ? `/api/files/${document.id}/images/${b.src}` : null,
    width: b.width,
    height: b.height,
    layout: (b.layout as number[][] | null) ?? null,
  }));

  const highlights: HighlightData[] = document.highlights.map((h) => ({
    id: h.id,
    startSid: h.startSid,
    endSid: h.endSid,
    startOffset: h.startOffset,
    endOffset: h.endOffset,
    exactText: h.exactText,
    prefix: h.prefix,
    suffix: h.suffix,
    color: h.color,
    comments: h.comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.createdAt.toISOString(),
    })),
  }));

  return (
    <Reader
      docId={document.id}
      title={document.title}
      author={document.author}
      status={document.status}
      blocks={blocks}
      initialHighlights={highlights}
      lastReadSid={document.lastReadSid}
      toc={tocFromMeta(document.meta)}
      sourceType={document.sourceType}
      pageDims={pageDimsFromMeta(document.meta)}
    />
  );
}
