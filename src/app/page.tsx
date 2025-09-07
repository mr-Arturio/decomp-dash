"use client";
import { useEffect } from "react";

export default function Page() {
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  return (
    <section className="card p-4 sm:p-6">
      <div className="flex items-center gap-2 mb-2">
        <span className="chip">Eco</span>
        <span className="chip">PWA</span>
      </div>
      <h2 className="text-xl sm:text-2xl font-semibold">
        Scan it. Sort it. Save centuries.
      </h2>
      <p className="mt-2 text-neutral-600">
        Show your bin’s QR (“BinTag”) and the item together. We pick the correct
        bin and turn avoided decomposition years into points.
      </p>
      <div className="mt-4 flex gap-2">
        <a className="btn-primary w-full" href="/scan">
          Start Scanning
        </a>
        <a className="btn-outline w-full" href="/team">
          Create Team
        </a>
      </div>
    </section>
  );
}
