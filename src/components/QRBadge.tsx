"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

export default function QRBadge({ payload }: { payload: string }) {
  const [dataUrl, setDataUrl] = useState<string>("");
  useEffect(() => {
    QRCode.toDataURL(payload, {
      margin: 1,
      width: 256,
      color: { dark: "#064e3b", light: "#ffffffff" },
    }).then(setDataUrl);
  }, [payload]);
  return (
    <div className="flex flex-col items-center gap-2">
      {dataUrl && (
        <img
          src={dataUrl}
          alt="BinTag QR"
          className="rounded-xl border border-emerald-200 shadow"
        />
      )}
      <div className="text-xs text-neutral-500">
        Payload:{" "}
        <code className="bg-neutral-100 rounded px-1.5 py-0.5">{payload}</code>
      </div>
    </div>
  );
}
