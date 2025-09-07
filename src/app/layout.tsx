import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"] });

export const viewport: Viewport = {
  themeColor: "#10b981",
};

export const metadata: Metadata = {
  title: "Decomp Dash",
  description: "Scan → classify → save centuries",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body
        className={`${inter.className} min-h-screen bg-gradient-to-b from-sky-50 via-emerald-50 to-white`}
        suppressHydrationWarning
      >
        <div className="mx-auto max-w-md px-4 pb-20 pt-4 sm:max-w-2xl">
          <header className="sticky top-0 z-20 -mx-4 mb-4 bg-gradient-to-b from-white/80 to-white/40 backdrop-blur supports-[backdrop-filter]:bg-white/60 border-b">
            <div className="mx-auto max-w-md sm:max-w-2xl px-4 py-3 flex items-center justify-between">
              <Link href="/" className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-emerald-600 text-white grid place-items-center shadow">
                  ♻️
                </div>
                <h1 className="text-lg font-semibold text-neutral-900">
                  Decomp Dash
                </h1>
              </Link>
              <nav className="hidden sm:flex gap-3 text-sm">
                <Link
                  href="/scan"
                  className="text-neutral-700 hover:text-emerald-700"
                >
                  Scan
                </Link>
                <Link
                  href="/team"
                  className="text-neutral-700 hover:text-emerald-700"
                >
                  Team
                </Link>
                <Link
                  href="/leaderboard"
                  className="text-neutral-700 hover:text-emerald-700"
                >
                  Leaderboard
                </Link>
                <Link
                  href="/achievements"
                  className="text-neutral-700 hover:text-emerald-700"
                >
                  Achievements
                </Link>
              </nav>
            </div>
          </header>

          <main className="space-y-4">{children}</main>

          <nav className="fixed bottom-4 left-0 right-0 mx-auto mb-4 w-[92%] max-w-md rounded-2xl bg-white/90 shadow backdrop-blur px-3 py-2 grid grid-cols-4 border border-neutral-200 sm:hidden">
            <Link
              href="/scan"
              className="py-2 text-center text-sm text-neutral-700 hover:text-emerald-700"
            >
              Scan
            </Link>
            <Link
              href="/team"
              className="py-2 text-center text-sm text-neutral-700 hover:text-emerald-700"
            >
              Team
            </Link>
            <Link
              href="/leaderboard"
              className="py-2 text-center text-sm text-neutral-700 hover:text-emerald-700"
            >
              Rank
            </Link>
            <Link
              href="/achievements"
              className="py-2 text-center text-sm text-neutral-700 hover:text-emerald-700"
            >
              Awards
            </Link>
          </nav>
        </div>
      </body>
    </html>
  );
}
