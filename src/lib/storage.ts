import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
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
