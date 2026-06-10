import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // No `output: "standalone"` — Railway starts with `next start` from the full
  // node_modules (Nixpacks keeps the build image as the runtime image), so the
  // standalone bundle was never used; producing it only triggered next-start's
  // standalone warning at boot.
  // Keep PDF/EPUB parsers and the OCR stack out of the bundler so their
  // worker/native deps (DOMMatrix polyfills, inlined worker, zip internals,
  // @napi-rs/canvas .node binary, tesseract.js WASM) resolve at runtime.
  serverExternalPackages: [
    "unpdf",
    "pdfjs-dist",
    "@lingo-reader/epub-parser",
    "tesseract.js",
    "@napi-rs/canvas",
  ],
  reactCompiler: true,
  experimental: {
    // The proxy (proxy.ts) makes Next buffer request bodies, capped at 10MB by
    // default — which truncated large uploads and broke multipart parsing. Raise
    // it to match the upload route's own limit. Keep this in sync with
    // MAX_UPLOAD_BYTES in src/lib/constants.ts (80MB) — config is evaluated
    // before TS modules load, so it can't import the constant directly.
    proxyClientMaxBodySize: "80mb",
  },
  // Cross-origin isolation on the reader route enables SharedArrayBuffer, which
  // the in-browser Kokoro neural voice needs for its threaded WASM fallback
  // (the WebGPU path doesn't strictly require it, but the fallback does). Scoped
  // to /read/* to limit the blast radius of require-corp on the rest of the app.
  async headers() {
    return [
      {
        source: "/read/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
