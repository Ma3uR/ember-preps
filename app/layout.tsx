import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ember Preps — MCP × LangChain Lab",
  description:
    "Two-stage interview-prep learning lab: MCP-fronted text-to-SQL chat, with a parallel LangChain.js rebuild.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* Browser extensions (grammarly, password managers, dark-reader) inject
          attributes onto <body> after SSR — silence the hydration warning for
          this single element so it doesn't fire on every page load. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
