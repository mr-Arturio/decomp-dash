"use client";

import "@tensorflow/tfjs";
import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

import { aHashFromImageData } from "../lib/ahash";
import { hammingHex } from "../lib/hamming";
import { db, ensureAnonAuth } from "../lib/firebase";
import {
  detectPrimaryROI,
  classify,
  mergeLabels,
  getCoco,
} from "../lib/vision";
import { mapWithApi, type MapResult } from "../lib/mapping";

type BinTag = { teamId: string; binId: string };

// Vendor-extended media types (progressive enhancement)
type VendorTrackCapabilities = MediaTrackCapabilities & {
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
  zoom?: { min: number; max: number; step?: number };
  pointsOfInterest?: boolean;
};
type VendorTrackConstraintSet = MediaTrackConstraintSet & {
  focusMode?: string;
  exposureMode?: string;
  whiteBalanceMode?: string;
  zoom?: number;
  pointsOfInterest?: { x: number; y: number }[];
};

// DEMO FLAG: when true, QR code is not required
const DEMO_NO_QR = process.env.NEXT_PUBLIC_DEMO_NO_QR === "1";

// loop settings
const SCAN_INTERVAL_MS = 333; // ~3 fps
const DETECT_WIDTH = 320; // downscale for motion/QR to reduce CPU
const DETECT_EVERY_MS = 650; // live-outline cadence

type Box = {
  x: number; // 0..1
  y: number; // 0..1
  w: number; // 0..1
  h: number; // 0..1
  label?: string;
  score?: number;
} | null;

export default function CameraScanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null); // full-res capture
  const detectCanvasRef = useRef<HTMLCanvasElement | null>(null); // downscaled loop

  // NEW: UI/track control refs
  const camBoxRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const videoTrackRef = useRef<MediaStreamTrack | null>(null);
  const zoomCapsRef = useRef<{ min: number; max: number; step: number } | null>(
    null
  );
  const pinchRef = useRef<{ base: number; start: number } | null>(null);
  const lastDetAtRef = useRef(0);
  const detectBusyRef = useRef(false);
  const [box, setBox] = useState<Box>(null);

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

  async function enableTrackControls(stream: MediaStream) {
    const track = stream.getVideoTracks()[0];
    videoTrackRef.current = track;

    const caps =
      (track.getCapabilities?.() as VendorTrackCapabilities | undefined) ||
      ({} as VendorTrackCapabilities);
    const adv: VendorTrackConstraintSet[] = [];

    if (caps.focusMode && caps.focusMode.includes("continuous")) {
      adv.push({ focusMode: "continuous" });
    }
    if (caps.exposureMode && caps.exposureMode.includes("continuous")) {
      adv.push({ exposureMode: "continuous" });
    }
    if (caps.whiteBalanceMode && caps.whiteBalanceMode.includes("continuous")) {
      adv.push({ whiteBalanceMode: "continuous" });
    }
    if (caps.zoom && typeof caps.zoom.min === "number") {
      zoomCapsRef.current = {
        min: caps.zoom.min,
        max: caps.zoom.max,
        step: caps.zoom.step || 0.1,
      };
    }

    if (adv.length) {
      try {
        await track.applyConstraints({
          advanced: adv,
        } as MediaTrackConstraints);
      } catch {}
    }
  }

  async function focusAt(clientX: number, clientY: number) {
    const track = videoTrackRef.current;
    if (!track) return;
    const caps =
      (track.getCapabilities?.() as VendorTrackCapabilities | undefined) ||
      ({} as VendorTrackCapabilities);
    if (!caps.pointsOfInterest) return;

    const box = camBoxRef.current?.getBoundingClientRect();
    if (!box) return;
    const x = (clientX - box.left) / box.width;
    const y = (clientY - box.top) / box.height;

    try {
      const constraints: MediaTrackConstraints = {
        advanced: [
          {
            pointsOfInterest: [{ x, y }],
          } as unknown as VendorTrackConstraintSet,
        ],
      };
      await track.applyConstraints(constraints);
    } catch {}
  }

  async function setZoom(rel: number) {
    const caps = zoomCapsRef.current;
    const track = videoTrackRef.current;
    if (!track || !caps) return;
    const cur = track.getSettings?.().zoom as number | undefined;
    const base = typeof cur === "number" ? cur : caps.min;
    const next = Math.max(caps.min, Math.min(caps.max, base * rel));
    try {
      const constraintsZoom = {
        advanced: [{ zoom: next } as VendorTrackConstraintSet],
      } as unknown as MediaTrackConstraints;
      await track.applyConstraints(constraintsZoom);
    } catch {}
  }

  useEffect(() => {
    const onVis = () => {
      if (document.hidden) stopSession();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      stopSession();
    };
  }, []);

  function stopSession() {
    setSessionActive(false);
    setBox(null);
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
    // optional: detach listeners if needed; kept lightweight for demo
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

      // Enable autofocus/zoom controls where supported
      await enableTrackControls(stream);

      // lightweight tap & pinch listeners
      const el = camBoxRef.current;
      if (el) {
        el.addEventListener("click", (e) =>
          focusAt((e as MouseEvent).clientX, (e as MouseEvent).clientY)
        );
        el.addEventListener(
          "touchstart",
          (e) => {
            const te = e as TouchEvent;
            if (te.touches.length === 2) {
              const dx = te.touches[0].clientX - te.touches[1].clientX;
              const dy = te.touches[0].clientY - te.touches[1].clientY;
              pinchRef.current = { base: Math.hypot(dx, dy), start: 1 };
            }
          },
          { passive: true }
        );
        el.addEventListener(
          "touchmove",
          (e) => {
            const te = e as TouchEvent;
            if (te.touches.length === 2 && pinchRef.current) {
              const dx = te.touches[0].clientX - te.touches[1].clientX;
              const dy = te.touches[0].clientY - te.touches[1].clientY;
              const dist = Math.hypot(dx, dy);
              const rel = Math.max(
                0.5,
                Math.min(2, dist / pinchRef.current.base)
              );
              setZoom(rel);
            }
          },
          { passive: true }
        );
      }

      // warm up models
      // Models are loaded lazily by vision utils when called

      if (DEMO_NO_QR) setBinTag(getDemoTag());

      // motion (+ optional QR) loop
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

        // motion
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
        }

        // Live detection for green outline (throttled)
        const nowTs = Date.now();
        if (
          nowTs - lastDetAtRef.current > DETECT_EVERY_MS &&
          !detectBusyRef.current
        ) {
          detectBusyRef.current = true;
          (async () => {
            try {
              const model = await getCoco();
              const dets = await model.detect(c as HTMLCanvasElement);
              type MiniDet = {
                class: string;
                score: number;
                bbox: [number, number, number, number];
              };
              const sorted = (dets as unknown as MiniDet[]).sort(
                (a, b) => (b.score || 0) - (a.score || 0)
              );
              const best = sorted[0];
              const minArea = w * h * 0.06;
              const area = best ? best.bbox[2] * best.bbox[3] : 0;

              if (!best || area < minArea) {
                setBox(null);
              } else {
                const [bx, by, bw, bh] = best.bbox;
                setBox({
                  x: bx / w,
                  y: by / h,
                  w: bw / w,
                  h: bh / h,
                  label: best.class,
                  score: best.score,
                });
              }
            } catch {
            } finally {
              lastDetAtRef.current = Date.now();
              detectBusyRef.current = false;
            }
          })();
        }
      }, SCAN_INTERVAL_MS);

      if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current);
      sessionTimerRef.current = setTimeout(stopSession, 90_000);
    } catch (e: unknown) {
      stopSession();
      setErr(
        e instanceof Error
          ? e.message
          : "Failed to access camera. Check site permissions."
      );
    }
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
      const ctx = canvas.getContext("2d");
      if (!video || !ctx) return;

      // Prefer ImageCapture.grabFrame() (sharper than drawing <video>)
      let bitmap: ImageBitmap | null = null;
      try {
        const stream = video.srcObject as MediaStream | null;
        const track = stream?.getVideoTracks?.()[0];
        if (track && "ImageCapture" in window) {
          type ImageCaptureCtor = new (t: MediaStreamTrack) => {
            grabFrame(): Promise<ImageBitmap>;
          };
          const icCtor = (
            window as unknown as { ImageCapture?: ImageCaptureCtor }
          ).ImageCapture;
          if (icCtor) {
            const ic = new icCtor(track);
            bitmap = await ic.grabFrame();
          }
        }
      } catch {}

      if (bitmap) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        ctx.drawImage(bitmap, 0, 0);
      } else {
        // fallback
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      }
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
      if (entry.times.length >= 10) {
        alert("Hourly capture limit reached for this bin.");
        return;
      }

      // --------- Detect + ROI crop, then classify ---------
      const { roi, detections, primary } = await detectPrimaryROI(canvas);
      const mobPreds = await classify(roi);

      // Merge labels (detector first + synonyms, then MobileNet, then PAPER hint)
      const labels = mergeLabels(detections, mobPreds);

      // choose a user-facing label
      const predictedLabel =
        (primary?.class && primary.score > 0.55
          ? primary.class
          : mobPreds[0]?.className) || "unknown";
      const confidence =
        (primary?.class && primary.score > 0.55
          ? primary.score
          : mobPreds[0]?.probability) ?? 0.5;

      // Map via API (with fallback inside)
      const mapped: MapResult = await mapWithApi(
        labels,
        entry.hashes.length,
        motionDeltaRef.current || 0,
        confidence
      );

      const material = mapped.material;
      const { bin, years, tip } = mapped;
      const risk = Math.max(0, Math.min(1, mapped.risk_score ?? 0));
      const yearsRounded = Math.max(1, Math.round(years));
      const points = Math.max(1, Math.round(yearsRounded * (1 - 0.5 * risk)));

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
        years: yearsRounded,
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
          (
            navigator as Navigator & {
              vibrate?: (pattern: number | number[]) => boolean;
            }
          ).vibrate?.(50);
        } catch {}
      }

      setResult({
        label: predictedLabel,
        material,
        bin,
        years: yearsRounded,
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
        <div ref={viewRef} className="relative aspect-square bg-neutral-900">
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full object-contain"
            playsInline
            muted
          />
          {/* hidden work canvases */}
          <canvas ref={captureCanvasRef} className="hidden" />
          <canvas ref={detectCanvasRef} className="hidden" />

          {/* GREEN OUTLINE OVERLAY */}
          {box &&
            viewRef.current &&
            videoRef.current &&
            (() => {
              const containerW = viewRef.current!.clientWidth;
              const containerH = viewRef.current!.clientHeight;
              const vW = videoRef.current!.videoWidth || 640;
              const vH = videoRef.current!.videoHeight || 480;
              const videoAR = vW / vH;
              const containerAR = containerW / containerH;

              let vw: number, vh: number, vx: number, vy: number;
              if (videoAR > containerAR) {
                vw = containerW;
                vh = containerW / videoAR;
                vx = 0;
                vy = (containerH - vh) / 2;
              } else {
                vh = containerH;
                vw = containerH * videoAR;
                vy = 0;
                vx = (containerW - vw) / 2;
              }

              const left = vx + box!.x * vw;
              const top = vy + box!.y * vh;
              const width = box!.w * vw;
              const height = box!.h * vh;

              return (
                <div className="absolute inset-0 pointer-events-none">
                  <div
                    className="absolute border-2 rounded-md"
                    style={{
                      left,
                      top,
                      width,
                      height,
                      borderColor: "rgb(16,185,129)",
                      boxShadow:
                        "0 0 0 2px rgba(16,185,129,0.45) inset, 0 0 8px rgba(16,185,129,0.35)",
                    }}
                  />
                  {box!.label && (
                    <div
                      className="absolute px-2 py-0.5 text-xs font-medium rounded-md"
                      style={{
                        left,
                        top: Math.max(0, top - 22),
                        background: "rgba(16,185,129,0.9)",
                        color: "white",
                      }}
                    >
                      {box!.label}
                      {typeof box!.score === "number"
                        ? ` · ${(box!.score * 100) | 0}%`
                        : ""}
                    </div>
                  )}
                </div>
              );
            })()}

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
