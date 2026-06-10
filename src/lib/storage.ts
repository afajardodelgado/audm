import { mkdir, writeFile, readFile, unlink, rm } from "node:fs/promises";
import path from "node:path";

// On Railway the persistent volume is mounted and its path is injected as
// RAILWAY_VOLUME_MOUNT_PATH (e.g. /data). Locally we fall back to ./data.
// IMPORTANT: the volume only mounts at runtime — never write here at build time.
export function storageRoot(): string {
  return process.env.RAILWAY_VOLUME_MOUNT_PATH ?? path.join(process.cwd(), "data");
}

// {root}/{userId}/{documentId}.{ext}
export function filePathFor(
  userId: string,
  documentId: string,
  sourceType: "pdf" | "epub" | "text" | "web"
): string {
  return path.join(storageRoot(), userId, `${documentId}.${sourceType}`);
}

// {root}/{userId}/{documentId}.cover.png — generated cover thumbnail.
export function coverPathFor(userId: string, documentId: string): string {
  return path.join(storageRoot(), userId, `${documentId}.cover.png`);
}

// {root}/{userId}/{documentId}.img — a document's inline image assets.
export function imageDirFor(userId: string, documentId: string): string {
  return path.join(storageRoot(), userId, `${documentId}.img`);
}

// One inline image asset; `asset` is the stored filename ("{index}-{sha8}.{ext}").
export function imagePathFor(
  userId: string,
  documentId: string,
  asset: string
): string {
  return path.join(imageDirFor(userId, documentId), asset);
}

// {root}/{userId}/{documentId}.pages — rendered original-PDF page images,
// produced on first request and cached (the source file never changes for a
// given document, so a rendered page is immutable).
export function pageDirFor(userId: string, documentId: string): string {
  return path.join(storageRoot(), userId, `${documentId}.pages`);
}

export function pagePathFor(
  userId: string,
  documentId: string,
  pageNumber: number
): string {
  return path.join(pageDirFor(userId, documentId), `${pageNumber}.png`);
}

/** Persist an uploaded file to the volume, creating the user dir as needed. */
export async function saveFile(absPath: string, data: Buffer): Promise<void> {
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, data);
}

export async function readStoredFile(absPath: string): Promise<Buffer> {
  return readFile(absPath);
}

export async function deleteStoredFile(absPath: string): Promise<void> {
  await unlink(absPath).catch(() => {
    /* already gone — fine */
  });
}

/** Remove a directory of stored assets (best-effort, no-op when absent). */
export async function deleteStoredDir(absPath: string): Promise<void> {
  await rm(absPath, { recursive: true, force: true }).catch(() => {
    /* already gone — fine */
  });
}

// Stored images (covers, EPUB figures) are kept verbatim, so the served type is
// read from the file's magic bytes rather than trusted from any source.
export function sniffImageType(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)
    return "image/jpeg";
  if (buf.length >= 4 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return "image/png";
  if (buf.length >= 6 && buf.toString("ascii", 0, 6).startsWith("GIF8"))
    return "image/gif";
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  return "application/octet-stream";
}
