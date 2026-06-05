// Dev-only: drive the narration state machine headlessly and assert the reader
// reacts. Stubs window.speechSynthesis BEFORE the app loads so the WebSpeech
// engine speaks against a fake that fires word boundaries + end synchronously.
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3000";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

// Inject a controllable fake speechSynthesis before any app code runs.
await page.addInitScript(() => {
  class FakeUtterance extends EventTarget {
    constructor(text) {
      super();
      this.text = text;
      this.rate = 1;
      this.voice = null;
    }
    set onboundary(fn) { this._b = fn; }
    set onend(fn) { this._e = fn; }
    set onerror(fn) { this._err = fn; }
  }
  const voices = [
    { voiceURI: "fake-en", name: "Fake English", lang: "en-US", default: true, localService: true },
  ];
  let current = null;
  window.__ttsFake = {
    // Fire a word boundary at charIndex with charLength, then advance.
    boundary(charIndex, charLength) {
      current?._b?.({ name: "word", charIndex, charLength });
    },
    end() {
      const u = current;
      current = null;
      u?._e?.();
    },
    speaking: () => !!current,
    currentText: () => current?.text ?? null,
  };
  const fakeSynth = {
    paused: false,
    speak(u) { current = u; },
    cancel() { current = null; },
    pause() { this.paused = true; },
    resume() { this.paused = false; },
    getVoices() { return voices; },
    addEventListener() {},
    removeEventListener() {},
  };
  // speechSynthesis is a non-configurable getter in Chromium, so a plain
  // assignment is ignored — redefine the property to install the fake.
  Object.defineProperty(window, "SpeechSynthesisUtterance", {
    configurable: true,
    writable: true,
    value: FakeUtterance,
  });
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    get: () => fakeSynth,
  });
});

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ok:", msg);
}

// Find a ready doc.
await page.goto(base + "/", { waitUntil: "networkidle" });
const docs = await page.evaluate(async (b) => {
  const r = await fetch(b + "/api/documents");
  return (await r.json()).documents ?? [];
}, base);
const ready = docs.find((d) => d.status === "ready");
if (!ready) throw new Error("no ready doc to test");
console.log("doc:", ready.title);

await page.goto(`${base}/read/${ready.id}`, { waitUntil: "networkidle" });
await page.waitForSelector("[data-sid]");
await page.waitForTimeout(600); // let `ready` flip + effects attach

// 1) Voice picker should render (we provided 1 voice — picker hides at <=1, so
//    assert the play button at least exists and is wired).
const playBtn = page.locator('footer button[aria-label="Play"], footer button[aria-label="Pause"]').first();
assert(await playBtn.count() > 0, "play button present");

// 2) Press play → narrator should start; first sentence gets currentSentence.
await playBtn.click();
await page.waitForTimeout(300);
const firstSpoken = await page.evaluate(() => window.__ttsFake.currentText());
assert(!!firstSpoken, "an utterance is speaking after play");
const activeCount1 = await page.locator('[data-sid].' + (await currentSentenceClass(page))).count();
assert(activeCount1 === 1, "exactly one sentence highlighted while narrating");
const firstSid = await activeSid(page);
assert(!!firstSid, "active sentence has a sid: " + firstSid);

// 3) Fire a word boundary → tts-word custom highlight should be set.
await page.evaluate(() => window.__ttsFake.boundary(0, 3));
await page.waitForTimeout(100);
const hasWord = await page.evaluate(() => CSS.highlights.has("tts-word"));
assert(hasWord, "tts-word highlight set after word boundary");

// 4) End the sentence → cursor advances → a DIFFERENT sentence is highlighted.
await page.evaluate(() => window.__ttsFake.end());
await page.waitForTimeout(300);
const secondSpoken = await page.evaluate(() => window.__ttsFake.currentText());
assert(!!secondSpoken && secondSpoken !== firstSpoken, "advanced to next sentence utterance");
const secondSid = await activeSid(page);
assert(secondSid && secondSid !== firstSid, `highlight advanced ${firstSid} -> ${secondSid}`);

// 4b) Click a later sentence → narration restarts from THAT sentence's sid.
const targetSid = await page.evaluate(() => {
  const spans = [...document.querySelectorAll("[data-sid]")];
  // pick a sentence well down the list so it differs from the current cursor
  return spans[Math.min(8, spans.length - 1)]?.getAttribute("data-sid") ?? null;
});
await page.locator(`[data-sid="${targetSid}"]`).click();
await page.waitForTimeout(300);
const clickedSid = await activeSid(page);
assert(clickedSid === targetSid, `click started narration at clicked sentence ${targetSid} (got ${clickedSid})`);
const clickedSpoken = await page.evaluate(() => window.__ttsFake.currentText());
assert(!!clickedSpoken, "an utterance is speaking after clicking a sentence");

// 5) Esc → stop → tts-word cleared, no narrating highlight forced.
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
const wordAfterStop = await page.evaluate(() => CSS.highlights.has("tts-word"));
assert(!wordAfterStop, "tts-word cleared after stop");
const speakingAfterStop = await page.evaluate(() => window.__ttsFake.speaking());
assert(!speakingAfterStop, "not speaking after stop");

console.log("\nALL NARRATION ASSERTIONS PASSED");
if (logs.length) console.log("\n--- page logs ---\n" + logs.join("\n"));
await browser.close();

// helpers — read the CSS-module hashed class name for .currentSentence
async function currentSentenceClass(page) {
  // The gold sentence uses a hashed class; find the element that has the
  // gold background by checking which [data-sid] currently has a class whose
  // computed background differs. Simpler: expose via the known prefix.
  return page.evaluate(() => {
    const el = [...document.querySelectorAll("[data-sid]")].find((e) =>
      [...e.classList].some((c) => c.toLowerCase().includes("currentsentence"))
    );
    if (!el) return "__none__";
    return [...el.classList].find((c) => c.toLowerCase().includes("currentsentence"));
  });
}
async function activeSid(page) {
  return page.evaluate(() => {
    const el = [...document.querySelectorAll("[data-sid]")].find((e) =>
      [...e.classList].some((c) => c.toLowerCase().includes("currentsentence"))
    );
    return el?.getAttribute("data-sid") ?? null;
  });
}
