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

// DEMO FLAG: when true, QR code is not required
const DEMO_NO_QR = process.env.NEXT_PUBLIC_DEMO_NO_QR === "1";

// loop settings
const SCAN_INTERVAL_MS = 333; // ~3 fps
const DETECT_WIDTH = 320; // downscale for motion/QR to reduce CPU

// ---- cached MobileNet load (avoid cold starts every capture) ----
let _mobilenetModel: any | null = null;
async function getMobileNet() {
  if (_mobilenetModel) return _mobilenetModel;
  const mobilenet = await import("@tensorflow-models/mobilenet");
  _mobilenetModel = await mobilenet.load();
  return _mobilenetModel;
}

export default function CameraScanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null); // full-res capture
  const detectCanvasRef = useRef<HTMLCanvasElement | null>(null); // downscaled loop

  const [sessionActive, setSessionActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
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
    // stop when unmounting or tab becomes hidden
    const onVis = () => {
      if (document.hidden) stopSession();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stopSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function stopSession() {
    setSessionActive(false);
    if (!DEMO_NO_QR) setBinTag(null);
    if (detectTimerRef.current) {
      clearInterval(detectTimerRef.current);
      detectTimerRef.current = null;
    }
    if (sessionTimerRef.current) {
      clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = null;
    }
    const v = videoRef.current;
    const stream = (v?.srcObject as MediaStream | null) || null;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (v) v.srcObject = null;
  }

  function getDemoTag(): BinTag {
    const localTeam = localStorage.getItem("dd:lastTeamId") || "demo-team";
    const localBin = localStorage.getItem("dd:lastBinId") || "demo-bin";
    return { teamId: localTeam, binId: localBin };
  }

  async function startSession() {
    setErr(null);
    setResult(null);
    setSessionActive(true);
    try {
      const stream = await navigator.mediaDevices
        .getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 640 },
            height: { ideal: 640 },
            aspectRatio: 1,
          },
          audio: false,
        })
        .catch(() =>
          navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        );

      const v = videoRef.current;
      if (!v) return;
      v.srcObject = stream;
      await v.play();

      // preload model in the background once the camera is live
      getMobileNet().catch(() => {});

      // In demo mode, prefill a fake tag and skip QR detection
      if (DEMO_NO_QR) setBinTag(getDemoTag());

      // Start motion (and optionally QR) loop (~3 fps) on a small canvas
      if (detectTimerRef.current) clearInterval(detectTimerRef.current);
      detectTimerRef.current = setInterval(() => {
        const v2 = videoRef.current;
        const c = detectCanvasRef.current;
        if (!v2 || !c) return;

        const aspect = (v2.videoHeight || 480) / (v2.videoWidth || 640);
        const w = (c.width = DETECT_WIDTH);
        const h = (c.height = Math.max(1, Math.round(DETECT_WIDTH * aspect)));

        const ctx = c.getContext("2d");
        if (!ctx) return;

        ctx.drawImage(v2, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);

        // Motion delta (sampled grid @ downscale)
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

        if (!DEMO_NO_QR) {
          // QR detect (demo mode skips this)
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
        }
      }, SCAN_INTERVAL_MS);

      // Auto-stop after 90s
      if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = setTimeout(stopSession, 90_000);
    } catch (e: unknown) {
      stopSession();
      setErr(
        e instanceof Error
          ? e.message
          : "Failed to access camera. Check site permissions."
      );
      // console.error("Camera access failed", e);
    }
  }

  async function classifyWithMobilenet(
    canvas: HTMLCanvasElement
  ): Promise<Pred[]> {
    try {
      const model = await getMobileNet();
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
    if (!videoRef.current || !captureCanvasRef.current) return;
    if (!sessionActive) return;

    // Resolve tag (demo mode auto-fills if needed)
    const activeTag: BinTag | null = DEMO_NO_QR
      ? binTag ?? getDemoTag()
      : binTag;
    if (!activeTag) {
      alert("Show your BinTag QR to continue.");
      return;
    }

    // Motion threshold (>= 2%)
    if ((motionDeltaRef.current || 0) < 0.02) {
      alert("Move the camera or item a bit to proceed.");
      return;
    }

    setBusy(true);
    try {
      const video = videoRef.current;
      const canvas = captureCanvasRef.current;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const ahash = aHashFromImageData(img);

      // Duplicate check (Hamming < 5) per bin
      const key = `${activeTag.teamId}:${activeTag.binId}`;
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

      // Classify
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
        teamId: activeTag.teamId,
        binId: activeTag.binId,
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

      if ("vibrate" in navigator) {
        try {
          // haptic feedback on success
          (navigator as any).vibrate?.(50);
        } catch {}
      }

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

  const captureDisabled = !sessionActive || !!busy || (!DEMO_NO_QR && !binTag);

  return (
    <div className="space-y-3">
      <div className="card mx-auto w-48 sm:w-64 md:w-96 overflow-hidden">
        <div className="relative aspect-square bg-neutral-900">
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-contain"
            playsInline
            muted
          />
          {/* keep canvases hidden */}
          <canvas ref={captureCanvasRef} className="hidden" />
          <canvas ref={detectCanvasRef} className="hidden" />

          {/* tighter overlays for the smaller box */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-black/40 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/40 to-transparent" />

          <div className="absolute left-2 top-2">
            <span className="chip bg-white/90 text-neutral-800">
              {DEMO_NO_QR
                ? "Demo mode: QR optional"
                : binTag
                ? "BinTag detected"
                : "Show your BinTag QR"}
            </span>
          </div>
        </div>
      </div>

      {err && (
        <div className="card p-3 bg-amber-50 border-amber-200 text-sm text-amber-800">
          {err}
        </div>
      )}

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
        disabled={captureDisabled}
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
