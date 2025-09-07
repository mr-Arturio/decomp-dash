export function ScoreCard({
  label,
  material,
  bin,
  years,
  points,
  tip,
}: {
  label: string;
  material: string;
  bin: string;
  years: number;
  points: number;
  tip: string;
}) {
  return (
    <div className="card p-4 space-y-1">
      <div className="text-sm text-neutral-500">Prediction</div>
      <div className="text-lg font-semibold">
        {label} <span className="text-neutral-400">→</span>{" "}
        <span className="font-mono uppercase">{material}</span>
      </div>
      <div className="flex flex-wrap gap-2 text-sm mt-1">
        <span className="chip">
          Bin: <b className="ml-1">{bin}</b>
        </span>
        <span className="chip">
          Saved: <b className="ml-1">{years.toLocaleString()} yrs</b>
        </span>
        <span className="chip">
          Points: <b className="ml-1">{points}</b>
        </span>
      </div>
      <div className="text-sm text-neutral-700">Tip: {tip}</div>
    </div>
  );
}
