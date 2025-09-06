import dynamic from "next/dynamic";
const CameraScanner = dynamic(() => import("@/components/CameraScanner"), {
  ssr: false,
});

export default function ScanPage() {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold">Scan</h2>
      <p className="text-sm text-neutral-600">
        Start a 90s session. Each capture must include your BinTag QR and the
        item.
      </p>
      <CameraScanner />
    </section>
  );
}
