import type { ReactNode } from "react";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { RootProvider } from "fumadocs-ui/provider/next";
import { source } from "@/lib/source";
import "./docs.css";

// Docs sit under their own provider and stylesheet so Fumadocs' theme stays
// inside /docs and never reaches the console, which has its own design system.
// Inlined rather than imported from components/Brand: that one is styled by
// uni.module.css, which the docs subtree deliberately opts out of.
function NomosMark() {
  return (
    <svg viewBox="0 0 64 64" width="22" height="22" aria-hidden="true" style={{ display: "block", borderRadius: 5 }}>
      <rect width="64" height="64" rx="15" fill="#e56b43" />
      <g stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" fill="none">
        <path d="M14 22 V15.5 A1.5 1.5 0 0 1 15.5 14 H22" />
        <path d="M42 14 H48.5 A1.5 1.5 0 0 1 50 15.5 V22" />
        <path d="M50 42 V48.5 A1.5 1.5 0 0 1 48.5 50 H42" />
        <path d="M22 50 H15.5 A1.5 1.5 0 0 1 14 48.5 V42" />
      </g>
      <g fill="#ffffff">
        <rect x="21" y="19" width="6.4" height="26" rx="0.6" />
        <rect x="36.6" y="19" width="6.4" height="26" rx="0.6" />
        <polygon points="27.4,19 33.8,19 36.6,45 30.2,45" />
      </g>
    </svg>
  );
}

export default function DocsRootLayout({ children }: { children: ReactNode }) {
  return (
    <RootProvider>
      {/* Opts this subtree out of the global margin/padding reset in
          globals.css, which would otherwise flatten every Fumadocs utility. */}
      <div className="nomos-docs">
      <DocsLayout
        tree={source.pageTree}
        nav={{
          // The mark, not just the word — the docs are the one surface that
          // carried no Nomos identity at all.
          title: (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <NomosMark />
              Nomos docs
            </span>
          ),
        }}
        githubUrl="https://github.com/wheval/nomos"
      >
        {children}
      </DocsLayout>
      </div>
    </RootProvider>
  );
}
