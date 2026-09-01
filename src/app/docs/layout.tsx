import type { ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { source } from "@/lib/source";
import "./docs.css";

// Docs sit under their own provider and stylesheet so Fumadocs' theme stays
// inside /docs and never reaches the console, which has its own design system.
export default function DocsRootLayout({ children }: { children: ReactNode }) {
  return (
    <RootProvider>
      {/* Opts this subtree out of the global margin/padding reset in
          globals.css, which would otherwise flatten every Fumadocs utility. */}
      <div className="nomos-docs">
      <DocsLayout
        tree={source.pageTree}
        nav={{ title: "Nomos docs" }}
        githubUrl="https://github.com/wheval/nomos"
      >
        {children}
      </DocsLayout>
      </div>
    </RootProvider>
  );
}
