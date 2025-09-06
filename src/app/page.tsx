"use client";
import { useEffect } from "react";

export default function Page() {
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Welcome</h2>
      <p>
        Snap an item, we tell you the right bin and convert its decomposition
        time into points. Use a BinTag QR on your bin to keep it honest.
      </p>
      <div className="flex gap-3">
        <a className="px-4 py-2 bg-black text-white rounded" href="/scan">
          Start Scanning
        </a>
        <a className="px-4 py-2 border rounded" href="/team">
          Create/Join Team
        </a>
      </div>
    </section>
  );
}
