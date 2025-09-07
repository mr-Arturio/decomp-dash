import { MATERIALS } from "./materials";

export function scoreFor(material: keyof typeof MATERIALS | string): {
  points: number;
  bin: string;
  years: number;
  tip: string;
} {
  const key = (
    material in MATERIALS ? (material as keyof typeof MATERIALS) : "landfill"
  ) as keyof typeof MATERIALS;
  const m = MATERIALS[key];
  // Cap glass points for sanity in demos
  const years = key === "glass" ? 2000 : m.years;
  return { points: Math.round(years), bin: m.bin, years, tip: m.tip };
}
