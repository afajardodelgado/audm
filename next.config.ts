import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Efficient single-binary output for Railway.
  output: "standalone",
  // Keep PDF/EPUB parsers out of the bundler so their worker/native deps
  // (DOMMatrix polyfills, inlined worker, zip internals) resolve at runtime.
  serverExternalPackages: ["unpdf", "pdfjs-dist", "@lingo-reader/epub-parser"],
  reactCompiler: true,
  experimental: {
    // The proxy (proxy.ts) makes Next buffer request bodies, capped at 10MB by
    // default — which truncated large uploads and broke multipart parsing. Raise
    // it to match the upload route's own MAX_BYTES (80MB). /api/upload is also
    // excluded from the proxy matcher below, so this is belt-and-suspenders.
    proxyClientMaxBodySize: "80mb",
  },
};

export default nextConfig;
