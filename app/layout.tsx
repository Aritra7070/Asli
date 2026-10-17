import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { GITHUB_URL } from "@/lib/constants";

export const metadata: Metadata = {
  title: {
    default: "Asli — the honest scan for medicine",
    template: "%s · Asli",
  },
  description:
    "Verify a medicine batch in seconds: wallet-signed attestations, a public custody trail, and recalls that can't be erased — on Arkiv. You can photocopy the strip. You can't photocopy the proof.",
};

function Logo() {
  return (
    <span className="flex items-center gap-2">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
        <rect
          x="1.5"
          y="1.5"
          width="23"
          height="23"
          rx="11.5"
          stroke="#34d399"
          strokeWidth="1.6"
        />
        <path
          d="M7.5 13.4l3.4 3.4 7.6-8"
          stroke="#34d399"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight">
        Asli
        <span className="ml-2 align-middle text-[13px] font-normal text-[var(--muted)]">
          असली
        </span>
      </span>
    </span>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-[rgba(10,15,14,0.82)] backdrop-blur">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
            <Link href="/" aria-label="Asli home">
              <Logo />
            </Link>
            <nav className="flex items-center gap-5 text-sm text-[var(--muted)]">
              <Link href="/radar" className="hover:text-[var(--ink)]">
                Radar
              </Link>
              <Link href="/how" className="hover:text-[var(--ink)]">
                How it works
              </Link>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer"
                className="hover:text-[var(--ink)]"
              >
                GitHub
              </a>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-4 pb-24">{children}</main>
        <footer className="border-t border-[var(--line)] py-8 text-xs text-[var(--muted)]">
          <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4">
            <span>
              Built for the Arkiv Global Tour Stop · Best Indian Use Case · on
              the Tiramisu testnet
            </span>
            <span>
              Synthetic demo data only — no real patient information ever
              touches this chain. MIT licensed.
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
