import "./globals.css";
import type { Metadata, Viewport } from "next";

export const viewport: Viewport = {
  themeColor: "#10b981",
};

export const metadata: Metadata = {
  title: "Decomp Dash",
  description: "Scan → classify → save centuries of decomposition time",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className="min-h-screen bg-neutral-50 text-neutral-900"
        suppressHydrationWarning
      >
        <div className="max-w-3xl mx-auto p-4 space-y-4">
          <header className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">Decomp Dash</h1>
            <nav className="flex gap-3 text-sm">
              <a href="/scan" className="underline">
                Scan
              </a>
              <a href="/team" className="underline">
                Team
              </a>
              <a href="/leaderboard" className="underline">
                Leaderboard
              </a>
            </nav>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
