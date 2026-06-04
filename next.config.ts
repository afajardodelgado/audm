import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Efficient single-binary output for Railway.
  output: "standalone",
  // Keep PDF/EPUB parsers out of the bundler so their worker/native deps
  // (DOMMatrix polyfills, inlined worker, zip internals) resolve at runtime.
  serverExternalPackages: ["unpdf", "pdfjs-dist", "@lingo-reader/epub-parser"],
  reactCompiler: true,
};

export default nextConfig;
