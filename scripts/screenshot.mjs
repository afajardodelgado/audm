// Dev-only: capture screenshots of the running app for visual review.
// Usage: node scripts/screenshot.mjs [baseUrl]
// Requires the dev server running and `playwright` installed.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3000";
const outDir = "/tmp/audm-shots";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});

async function shoot(path, name, { waitFor, settle = 800 } = {}) {
  const url = base + path;
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(settle);
  const file = `${outDir}/${name}.png`;
  await page.screenshot({ path: file, fullPage: false });
  console.log("saved", file, "from", url);
}

// 1) Library shelf
await shoot("/", "01-shelf", { settle: 1000 });

// 2) Reader — first ready document from the API
const docs = await page.evaluate(async (b) => {
  const r = await fetch(b + "/api/documents");
  const j = await r.json();
  return j.documents ?? [];
}, base);
const ready = docs.find((d) => d.status === "ready");
if (ready) {
  await shoot(`/read/${ready.id}`, "02-reader", { settle: 1500 });
  console.log("reader doc:", ready.title);
} else {
  console.log("no ready document to screenshot");
}

await browser.close();
console.log("DONE");
