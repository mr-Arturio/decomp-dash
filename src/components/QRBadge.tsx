"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

export default function QRBadge({ payload }: { payload: string }) {
  const [dataUrl, setDataUrl] = useState<string>("");
  useEffect(() => {
    QRCode.toDataURL(payload, { margin: 1, width: 256 }).then(setDataUrl);
  }, [payload]);
  return (
    <div className="flex flex-col items-center gap-2">
      {dataUrl && (
        <img src={dataUrl} alt="BinTag QR" className="border rounded" />
      )}
      <code className="text-xs bg-neutral-100 px-2 py-1 rounded">
        {payload}
      </code>
    </div>
  );
}
