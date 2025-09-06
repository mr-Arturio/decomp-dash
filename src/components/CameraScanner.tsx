"use client";

import { useEffect, useRef, useState } from "react";
import { ScoreCard } from "./ScoreCard";
import { aHashFromImageData } from "../lib/ahash";
import { labelToMaterial } from "../lib/materials";
import { scoreFor } from "../lib/scoring";
import { db, ensureAnonAuth } from "../lib/firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

type BinTag = { teamId: string; binId: string };

export default function CameraScanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [sessionActive, setSessionActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [binTag, setBinTag] = useState<BinTag | null>(null);
  const [result, setResult] = useState<null | {
    label: string;
    material: string;
    bin: string;
    years: number;
    points: number;
    ahash: string;
    confidence: number;
    tip: string;
  }>(null);

  useEffect(() => {
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach((t) => t.stop());
      }
    };
  }, []);

  async function startSession() {
    setResult(null);
    setSessionActive(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      // For demo: if you have a BinTag QR flow, set from there. Otherwise, stub one.
      if (!binTag) setBinTag({ teamId: "demo-team", binId: "demo-bin" });
    } catch (e) {
      setSessionActive(false);
      console.error("Camera access failed", e);
    }
  }

  async function captureAndRecord() {
    if (!videoRef.current || !canvasRef.current) return;
    setBusy(true);
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const ahash = aHashFromImageData(img);

      // Placeholder prediction. Replace with your model inference if available.
      const predictedLabel = "plastic bottle";
      const confidence = 0.9;

      const material = labelToMaterial(predictedLabel);
      const { bin, years, tip, points } = scoreFor(material);

      // Persist
      const uid = await ensureAnonAuth();
      await addDoc(collection(db, "scans"), {
        userId: uid,
        teamId: binTag?.teamId ?? null,
        binId: binTag?.binId ?? null,
        ts: serverTimestamp(),
        material,
        confidence,
        binSuggested: bin,
        ahash,
        points,
      });

      setResult({
        label: predictedLabel,
        material,
        bin,
        years,
        points,
        ahash,
        confidence,
        tip,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative">
        <video
          ref={videoRef}
          className="w-full rounded border bg-black"
          playsInline
          muted
        />
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute inset-x-0 top-2 text-center text-xs bg-black/40 text-white py-1">
          {binTag
            ? `BinTag detected: ${binTag.teamId.slice(
                0,
                6
              )}…/${binTag.binId.slice(0, 6)}…`
            : "Show your BinTag QR in frame"}
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={startSession}
          disabled={sessionActive}
          className="px-3 py-2 rounded border"
        >
          {sessionActive ? "Session running…" : "Start 90s Session"}
        </button>
        <button
          disabled={!sessionActive || busy}
          onClick={captureAndRecord}
          className="px-4 py-2 rounded bg-emerald-600 text-white disabled:opacity-50"
        >
          {busy ? "Scanning…" : "Capture & Save"}
        </button>
      </div>
      {result && (
        <ScoreCard
          label={result.label}
          material={result.material}
          bin={result.bin}
          years={result.years}
          points={result.points}
          tip={result.tip}
        />
      )}
      <p className="text-xs text-neutral-500">
        Privacy: images are processed client‑side; only a perceptual hash +
        label is saved. LLM receives only labels + simple metadata, not your
        image.
      </p>
    </div>
  );
}
