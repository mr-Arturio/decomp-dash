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
    <div className="border rounded p-3 space-y-1 bg-white">
      <div className="text-sm text-neutral-500">Prediction</div>
      <div className="text-lg font-semibold">
        {label} → <span className="font-mono uppercase">{material}</span>
      </div>
      <div>
        Bin: <b>{bin}</b>
      </div>
      <div>
        Decomposition time saved: <b>{years.toLocaleString()} years</b>
      </div>
      <div>
        Points: <b>{points}</b>
      </div>
      <div className="text-sm text-neutral-600">Tip: {tip}</div>
    </div>
  );
}
