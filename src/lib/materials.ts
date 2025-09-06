export const MATERIALS: Record<
  string,
  { bin: string; years: number; tip: string }
> = {
  plastic: {
    bin: "recycling",
    years: 450,
    tip: "Rinse to avoid contamination.",
  },
  metal: { bin: "recycling", years: 200, tip: "Crush cans to save space." },
  glass: {
    bin: "recycling",
    years: 1_000_000,
    tip: "Remove caps; glass is endlessly recyclable.",
  },
  paper: { bin: "recycling", years: 0.3, tip: "Keep paper dry to recycle." },
  cardboard: { bin: "recycling", years: 0.5, tip: "Flatten boxes." },
  compost: {
    bin: "compost",
    years: 0.05,
    tip: "Great for organics—use a liner if allowed.",
  },
  landfill: {
    bin: "landfill",
    years: 50,
    tip: "Reduce single-use items next time.",
  },
  "e-waste": {
    bin: "special",
    years: 0,
    tip: "Take to an e-waste drop-off—hazardous if trashed.",
  },
};

export function labelToMaterial(label: string): keyof typeof MATERIALS {
  const s = label.toLowerCase();
  if (s.includes("glass")) return "glass";
  if (
    s.includes("metal") ||
    s.includes("steel") ||
    s.includes("aluminum") ||
    s.includes("tin")
  )
    return "metal";
  if (s.includes("paper")) return "paper";
  if (s.includes("cardboard") || s.includes("box")) return "cardboard";
  if (
    s.includes("banana") ||
    s.includes("apple") ||
    s.includes("food") ||
    s.includes("peel") ||
    s.includes("compost")
  )
    return "compost";
  if (s.includes("battery") || s.includes("phone") || s.includes("electronic"))
    return "e-waste";
  if (
    s.includes("bottle") ||
    s.includes("cup") ||
    s.includes("plastic") ||
    s.includes("clamshell")
  )
    return "plastic";
  return "landfill";
}
