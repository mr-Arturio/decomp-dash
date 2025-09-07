"use client";
import { useEffect, useState } from "react";
import CameraScanner from "@/components/CameraScanner";

export default function ScanPage() {
  const [ready, setReady] = useState(false);
  const [hasTeam, setHasTeam] = useState(false);

  useEffect(() => {
    setReady(true);
    const t = localStorage.getItem("dd:lastTeamId");
    const b = localStorage.getItem("dd:lastBinId");
    setHasTeam(Boolean(t && b));
  }, []);

  if (!ready) return null;

  if (!hasTeam) {
    return (
      <section className="card p-4 space-y-3">
        <h2 className="text-lg font-semibold">Create a Team to Start</h2>
        <p className="text-sm text-neutral-600">
          Generate your <b>BinTag</b> QR on the Team page, tape it by your bin,
          then come back to scan.
        </p>
        <a href="/team" className="btn-primary w-full text-center">
          Go to Team
        </a>
      </section>
    );
  }

  return <CameraScanner />;
}
