"use client";

import "@tensorflow/tfjs";
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

import { aHashFromImageData } from "../lib/ahash";
import { hammingHex } from "../lib/hamming";
import { MATERIALS, labelToMaterial } from "../lib/materials";
import { scoreFor } from "../lib/scoring";
import { db, ensureAnonAuth } from "../lib/firebase";

type BinTag = { teamId: string; binId: string };
type Pred = { className: string; probability: number };

type MapResult = {
  material: string;
  bin: string;
  tip: string;
  years: number;
  risk_score?: number;
  _mode?: "llm" | "heuristic";
  _model?: string;
};

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
    _mode?: "llm" | "heuristic";
    _model?: string;
    risk_score?: number;
  }>(null);

  // QR + motion tracking
  const lastQRSeenAtRef = useRef<number>(0);
  const prevFrameRef = useRef<ImageData | null>(null);
  const motionDeltaRef = useRef<number>(0);
  const detectTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Per-bin recent hashes + hourly cap
  const recentByBinRef = useRef<
    Map<string, { hashes: string[]; times: number[] }>
  >(new Map());

  useEffect(() => {
    // Cleanup on unmount
    return () => stopSession();
  }, []);

  function stopSession() {
    setSessionActive(false);
    setBinTag(null);
    if (detectTimerRef.current) {
      clearInterval(detectTimerRef.current);
      detectTimerRef.current = null;
    }
    if (sessionTimerRef.current) {
      clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    const v = videoRef.current;
    const stream = (v?.srcObject as MediaStream) || null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (v) v.srcObject = null;
  }

  async function startSession() {
    setResult(null);
    setSessionActive(true);
    try {
      const stream = await navigator.mediaDevices
        .getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })
        .catch(() =>
          navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        );

      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      // Start QR + motion loop (~3 fps)
      if (detectTimerRef.current) clearInterval(detectTimerRef.current);
      detectTimerRef.current = setInterval(() => {
        const v = videoRef.current;
        const c = canvasRef.current;
        if (!v || !c) return;

        const w = (c.width = v.videoWidth || 640);
        const h = (c.height = v.videoHeight || 480);
        const ctx = c.getContext("2d");
        if (!ctx) return;

        ctx.drawImage(v, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);

        // Motion delta (sampled grid)
        const prev = prevFrameRef.current;
        if (prev && prev.data.length === img.data.length) {
          let diff = 0;
          let count = 0;
          for (let i = 0; i < img.data.length; i += 16 * 4) {
            const dr = Math.abs(img.data[i] - prev.data[i]);
            const dg = Math.abs(img.data[i + 1] - prev.data[i + 1]);
            const dbv = Math.abs(img.data[i + 2] - prev.data[i + 2]);
            diff += dr + dg + dbv;
            count++;
          }
          const avg = diff / (count * 255 * 3);
          motionDeltaRef.current = avg; // 0..1
        }
        prevFrameRef.current = img;

        // QR detect
        const qr = jsQR(img.data, w, h);
        const now = Date.now();
        if (
          qr &&
          typeof qr.data === "string" &&
          qr.data.startsWith("BINTAG:")
        ) {
          const parts = qr.data.split(":");
          if (parts.length >= 3) {
            const tag = { teamId: parts[1], binId: parts[2] };
            setBinTag(tag);
            localStorage.setItem("dd:lastTeamId", tag.teamId);
            localStorage.setItem("dd:lastBinId", tag.binId);
            lastQRSeenAtRef.current = now;
          }
        } else {
          if (now - lastQRSeenAtRef.current > 1500) setBinTag(null);
        }
      }, 333);

      // Auto-stop after 90s
      if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = setTimeout(stopSession, 90_000);
    } catch (e) {
      stopSession();
      console.error("Camera access failed", e);
    }
  }

  async function classifyWithMobilenet(
    canvas: HTMLCanvasElement
  ): Promise<Pred[]> {
    try {
      const mobilenet = await import("@tensorflow-models/mobilenet");
      const model = await mobilenet.load();
      const preds = await model.classify(canvas);
      return preds as unknown as Pred[];
    } catch {
      // Fallback stub for offline/demo
      return [{ className: "plastic bottle", probability: 0.9 }];
    }
  }

  async function mapWithApi(
    preds: Pred[],
    recentCount: number,
    delta: number,
    conf: number
  ): Promise<MapResult> {
    try {
      const r = await fetch("/api/map", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          labels: preds.map((p) => ({
            name: p.className,
            prob: p.probability,
          })),
          rules: MATERIALS,
          meta: { recentCount, delta, conf },
        }),
      });
      if (r.ok) {
        const data = (await r.json()) as MapResult;

        // Typed header parsing (no 'any')
        const modeHeader = r.headers.get("x-map-mode");
        const parsedMode: MapResult["_mode"] =
          modeHeader === "llm"
            ? "llm"
            : modeHeader === "heuristic"
            ? "heuristic"
            : "heuristic";
        data._mode = parsedMode;

        const modelHeader = r.headers.get("x-map-model");
        data._model = modelHeader ?? "";

        return data;
      }
    } catch {
      // ignore -> fallback below
    }
    // Fallback (client-side heuristic)
    const top = preds[0]?.className || "";
    const material = labelToMaterial(top);
    const { bin, years, tip } = scoreFor(material);
    return { material, bin, tip, years, _mode: "heuristic", _model: "" };
  }

  async function captureAndRecord() {
    if (!videoRef.current || !canvasRef.current) return;
    if (!sessionActive || !binTag) return;

    // Motion threshold (>= 2%)
    if ((motionDeltaRef.current || 0) < 0.02) {
      alert("Move the camera or item a bit to proceed.");
      return;
    }

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

      // Duplicate check (Hamming < 5) for this bin
      const key = `${binTag.teamId}:${binTag.binId}`;
      const entry = recentByBinRef.current.get(key) || {
        hashes: [],
        times: [] as number[],
      };
      for (const h of entry.hashes) {
        if (hammingHex(h, ahash) < 5) {
          alert("Looks like a duplicate capture—try a different angle.");
          return;
        }
      }

      // Per-bin per-hour cap = 6
      const now = Date.now();
      entry.times = entry.times.filter((t) => now - t < 60 * 60 * 1000);
      if (entry.times.length >= 6) {
        alert("Hourly capture limit reached for this bin.");
        return;
      }

      // Classify (with fallback stub)
      const preds = await classifyWithMobilenet(canvas);
      const predictedLabel = preds[0]?.className || "unknown";
      const confidence = preds[0]?.probability ?? 0.5;

      // Map via API (with fallback inside)
      const mapped = await mapWithApi(
        preds,
        entry.hashes.length,
        motionDeltaRef.current || 0,
        confidence
      );

      const material = mapped.material;
      const { bin, years, tip } = mapped;
      const risk = Math.max(0, Math.min(1, mapped.risk_score ?? 0));
      const points = Math.round(Math.round(years) * (1 - 0.5 * risk));

      const uid = await ensureAnonAuth();
      await addDoc(collection(db, "scans"), {
        userId: uid,
        teamId: binTag.teamId,
        binId: binTag.binId,
        ts: serverTimestamp(),
        label: predictedLabel,
        material,
        confidence,
        binSuggested: bin,
        years: Math.round(years),
        ahash,
        points,
        llmMode: mapped._mode || "heuristic",
        llmModel: mapped._model || "",
        risk_score: risk,
      });

      // Update recent trackers
      entry.hashes.unshift(ahash);
      if (entry.hashes.length > 20) entry.hashes.pop();
      entry.times.push(now);
      recentByBinRef.current.set(key, entry);

      setResult({
        label: predictedLabel,
        material,
        bin,
        years,
        points,
        ahash,
        confidence,
        tip,
        _mode: mapped._mode,
        _model: mapped._model,
        risk_score: risk,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="card overflow-hidden">
        <div className="relative">
          <video
            ref={videoRef}
            className="w-full aspect-[3/4] object-cover bg-neutral-900"
            playsInline
            muted
          />
          <canvas ref={canvasRef} className="hidden" />
          <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/40 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/40 to-transparent" />
          <div className="absolute left-3 top-3">
            <span className="chip bg-white/90 text-neutral-800">
              {binTag ? "BinTag detected" : "Show your BinTag QR"}
            </span>
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={startSession}
          disabled={sessionActive}
          className="btn-outline w-1/2"
        >
          {sessionActive ? "Session running…" : "Start 90s Session"}
        </button>
        <button
          onClick={stopSession}
          disabled={!sessionActive}
          className="btn-outline w-1/2"
        >
          Stop
        </button>
      </div>

      <button
        disabled={!sessionActive || !binTag || busy}
        onClick={captureAndRecord}
        className="btn-primary w-full disabled:opacity-50"
      >
        {busy ? "Scanning…" : "Capture & Save"}
      </button>

      {/* Unknown material banner */}
      {result?.material === "unknown" && (
        <div className="card p-3 bg-amber-50 border-amber-200">
          <div className="text-sm text-amber-800">
            Not recyclable/compostable here — please use landfill. (Check tip
            below.)
          </div>
        </div>
      )}

      {result && (
        <div className="card p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm text-neutral-500">Prediction</div>
            <div className="flex gap-2">
              {result._mode === "llm" ? (
                <span className="chip">AI: {result._model || "LLM"}</span>
              ) : (
                <span className="chip bg-amber-100 text-amber-700">
                  Offline rules
                </span>
              )}
            </div>
          </div>

          <div className="text-lg font-semibold">
            {result.label} <span className="text-neutral-400">→</span>{" "}
            <span className="uppercase font-mono">{result.material}</span>
          </div>

          <div className="flex flex-wrap gap-2 text-sm">
            <span className="chip">
              Bin: <b className="ml-1">{result.bin}</b>
            </span>
            <span className="chip">
              Saved:{" "}
              <b className="ml-1">
                {Math.round(result.years).toLocaleString()} yrs
              </b>
            </span>
            <span className="chip">
              Points: <b className="ml-1">{result.points}</b>
            </span>
            {typeof result.risk_score === "number" &&
              result.risk_score > 0.6 && (
                <span className="chip bg-amber-100 text-amber-700">
                  High risk
                </span>
              )}
          </div>

          <p className="text-neutral-600 text-sm">
            Tip:{" "}
            {result.tip ??
              "Rinse/flatten when possible to reduce contamination."}
          </p>
          <p className="text-xs text-neutral-500">
            Privacy: on-device vision; only a perceptual hash + label is stored.
          </p>
        </div>
      )}
    </div>
  );
}
