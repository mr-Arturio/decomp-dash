import { MATERIALS, labelToMaterial } from "./materials";
import { scoreFor } from "./scoring";
import type { Pred } from "./vision";

export type MapResult = {
  material: string;
  bin: "recycling" | "compost" | "landfill" | "special";
  tip: string;
  years: number;
  risk_score?: number;
  _mode?: "llm" | "heuristic";
  _model?: string;
};

export async function mapWithApi(
  labels: Pred[],
  recentCount: number,
  delta: number,
  conf: number
): Promise<MapResult> {
  try {
    const r = await fetch("/api/map", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        labels: labels.map((p) => ({ name: p.className, prob: p.probability })),
        rules: MATERIALS,
        meta: { recentCount, delta, conf },
      }),
    });

    if (r.ok) {
      const data = (await r.json()) as MapResult;

      const modeHeader = r.headers.get("x-map-mode");
      const parsedMode: MapResult["_mode"] =
        modeHeader === "llm" ? "llm" : "heuristic";

      const modelHeader = r.headers.get("x-map-model") ?? "";

      // Return a fully typed object without `any`
      return { ...data, _mode: parsedMode, _model: modelHeader };
    }
  } catch {
    // ignore network/parse errors -> fallback below
  }

  // Fallback (client-side heuristic)
  const top = labels[0]?.className || "";
  const material = labelToMaterial(top);
  const { bin, years, tip } = scoreFor(material);

  return {
    material,
    bin: bin as MapResult["bin"],
    tip,
    years,
    _mode: "heuristic",
    _model: "",
  };
}
