import type { Metadata } from "next";
// Self-hosted variable serifs (SIL OFL). Optical-size axis on both,
// plus Newsreader italic for bylines/blockquotes.
import "@fontsource-variable/newsreader";
import "@fontsource-variable/newsreader/opsz-italic.css";
import "@fontsource-variable/source-serif-4";
import "./globals.css";

export const metadata: Metadata = {
  title: "Audm — a place to read",
  description:
    "A calm reading sanctuary. Upload PDFs and EPUBs, read them in one quiet column with auto-scroll, and annotate by keyboard.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
