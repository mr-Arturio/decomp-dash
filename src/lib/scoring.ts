import { MATERIALS } from "./materials";

export function scoreFor(material: keyof typeof MATERIALS): {
  points: number;
  bin: string;
  years: number;
  tip: string;
} {
  const m = MATERIALS[material];
  // Cap glass points for sanity in demos
  const years = material === "glass" ? 2000 : m.years;
  return { points: Math.round(years), bin: m.bin, years, tip: m.tip };
}
