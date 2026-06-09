// Runs once per server boot (Next.js instrumentation hook), before traffic.
//
// Extraction and OCR are fire-and-forget in this process, so a crash or
// redeploy mid-run strands documents in a non-terminal status (pending /
// extracting / ocr_running) that nothing will ever finish — the shelf would
// poll them forever. At boot no such work can be in flight, so mark them
// failed with a retryable message. (Assumes a single server instance, which
// is how Audm deploys; a second instance booting could mis-flag another's
// in-flight extraction.)
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { prisma } = await import("@/lib/db");
    const stranded = await prisma.document.updateMany({
      where: { status: { in: ["pending", "extracting", "ocr_running"] } },
      data: {
        status: "failed",
        error: "Interrupted by a server restart — please import it again.",
      },
    });
    if (stranded.count > 0) {
      console.warn(
        `[boot] Marked ${stranded.count} document(s) stranded mid-extraction as failed.`
      );
    }
  } catch (err) {
    // Never block boot on the sweep (e.g. a fresh dev checkout before db:push).
    console.error("[boot] Stale-status sweep failed:", err);
  }
}
