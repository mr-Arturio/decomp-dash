export default function Debug() {
  return (
    <div className="space-y-4 p-4">
      <div className="text-sm text-neutral-600">
        Tailwind debug: if boxes below are colored and rounded, Tailwind is
        active.
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="h-12 rounded-lg bg-emerald-200" />
        <div className="h-12 rounded-lg bg-sky-200" />
        <div className="h-12 rounded-lg bg-neutral-200" />
      </div>
      <button className="btn-primary">Primary Button</button>
    </div>
  );
}
