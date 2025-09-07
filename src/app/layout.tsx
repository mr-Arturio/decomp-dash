import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

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
              <a href="/" className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-xl bg-emerald-600 text-white grid place-items-center shadow">
                  ♻️
                </div>
                <h1 className="text-lg font-semibold text-neutral-900">
                  Decomp Dash
                </h1>
              </a>
              <nav className="hidden sm:flex gap-3 text-sm">
                <a
                  href="/scan"
                  className="text-neutral-700 hover:text-emerald-700"
                >
                  Scan
                </a>
                <a
                  href="/team"
                  className="text-neutral-700 hover:text-emerald-700"
                >
                  Team
                </a>
                <a
                  href="/leaderboard"
                  className="text-neutral-700 hover:text-emerald-700"
                >
                  Leaderboard
                </a>
                <a
                  href="/achievements"
                  className="text-neutral-700 hover:text-emerald-700"
                >
                  Achievements
                </a>
              </nav>
            </div>
          </header>
          <main className="space-y-4">{children}</main>

          <nav className="fixed bottom-4 left-0 right-0 mx-auto w-[92%] max-w-md rounded-2xl bg-white/90 shadow backdrop-blur px-4 py-2 grid grid-cols-3 sm:hidden">
            <a
              href="/scan"
              className="flex flex-col items-center py-1 text-xs text-neutral-700 hover:text-emerald-700"
            >
              📷<span>Scan</span>
            </a>
            <a
              href="/team"
              className="flex flex-col items-center py-1 text-xs text-neutral-700 hover:text-emerald-700"
            >
              🏷️<span>Team</span>
            </a>
            <a
              href="/leaderboard"
              className="flex flex-col items-center py-1 text-xs text-neutral-700 hover:text-emerald-700"
            >
              🏆<span>Rank</span>
            </a>
            <a
              href="/achievements"
              className="flex flex-col items-center py-1 text-xs text-neutral-700 hover:text-emerald-700"
            >
              🎖️<span>Awards</span>
            </a>
          </nav>
        </div>
      </body>
    </html>
  );
}
