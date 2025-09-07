"use client";
import { useState } from "react";

type Props = {
  emoji: string;
  title: string; // e.g. "Ten-Day Streak"
  subtitle?: string; // e.g. "12,340 years saved" or "Streak: 10 days"
  fileName?: string; // e.g. "decomp-badge-ten-day-streak.png"
};

export default function ShareBadgeButton({
  emoji,
  title,
  subtitle,
  fileName = "decomp-badge.png",
}: Props) {
  const [busy, setBusy] = useState(false);

  async function makeBadge(): Promise<Blob> {
    // 1200x630 is OG-friendly
    const W = 1200,
      H = 630;
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;

    // Background gradient
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, "#ecfeff"); // sky-50-ish
    grad.addColorStop(0.5, "#ecfdf5"); // emerald-50-ish
    grad.addColorStop(1, "#ffffff");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Soft blob
    ctx.fillStyle = "rgba(16,185,129,0.12)"; // emerald-500 @ 12%
    ctx.beginPath();
    ctx.ellipse(W * 0.75, H * 0.2, 220, 140, 0.2, 0, Math.PI * 2);
    ctx.fill();

    // Card
    const pad = 48;
    const cardX = pad,
      cardY = pad,
      cardW = W - pad * 2,
      cardH = H - pad * 2;
    ctx.fillStyle = "#ffffff";
    roundRect(ctx, cardX, cardY, cardW, cardH, 32);
    ctx.fill();
    // subtle border
    ctx.strokeStyle = "rgba(0,0,0,0.06)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Header (logo-ish)
    ctx.fillStyle = "#065f46"; // emerald-900-ish
    ctx.font =
      "bold 28px Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI";
    ctx.fillText("Decomp Dash", cardX + 28, cardY + 52);

    // Emoji circle
    ctx.beginPath();
    ctx.arc(cardX + 60, cardY + 46, 26, 0, Math.PI * 2);
    ctx.fillStyle = "#10b981"; // emerald-600
    ctx.fill();
    ctx.font =
      "28px 'Apple Color Emoji','Segoe UI Emoji', Noto Color Emoji, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.fillText("♻️", cardX + 60, cardY + 46);

    // Badge emoji big
    ctx.textAlign = "left";
    ctx.font =
      "88px 'Apple Color Emoji','Segoe UI Emoji', Noto Color Emoji, sans-serif";
    ctx.fillText(emoji, cardX + 48, cardY + 190);

    // Title
    ctx.fillStyle = "#111827"; // neutral-900
    ctx.font =
      "700 56px Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI";
    ctx.fillText(title, cardX + 48 + 96, cardY + 168);

    // Subtitle
    if (subtitle) {
      ctx.fillStyle = "#374151"; // neutral-700
      ctx.font =
        "400 28px Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI";
      wrapText(ctx, subtitle, cardX + 48, cardY + 240, cardW - 96, 34);
    }

    // Footer note
    ctx.fillStyle = "#6b7280"; // neutral-500
    ctx.font =
      "400 20px Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI";
    ctx.fillText(
      "Scan → classify → save centuries",
      cardX + 48,
      cardY + cardH - 28
    );

    const blob: Blob = await new Promise((res) =>
      canvas.toBlob((b) => res(b!), "image/png")
    );
    return blob;
  }

  async function shareOrDownload() {
    setBusy(true);
    try {
      const blob = await makeBadge();
      const file = new File([blob], fileName, { type: "image/png" });

      // If Web Share Level 2 is supported (mobile & some desktops)
      const nav = navigator as Navigator & {
        canShare?: (data?: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      if (nav.canShare?.({ files: [file] }) && nav.share) {
        await nav.share({
          files: [file],
          title: "Decomp Dash Achievement",
          text: "I just unlocked an eco achievement on Decomp Dash!",
        });
      } else {
        // Fallback: download
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={shareOrDownload} disabled={busy} className="btn-outline">
      {busy ? "Preparing…" : "Share badge"}
    </button>
  );
}

// helpers
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(" ");
  let line = "";
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      ctx.fillText(line, x, y);
      line = words[n] + " ";
      y += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, y);
}
