import { NextRequest } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.MAP_MODEL ?? "gpt-4o-mini";

// Allowed categories your app recognizes
const ALLOWED = [
  "plastic",
  "metal",
  "glass",
  "paper",
  "cardboard",
  "organic",
  "ewaste",
] as const;
type AllowedMaterial = (typeof ALLOWED)[number];
type Bin = "recycling" | "compost" | "landfill" | "special";

type Decision = {
  material: string;
  bin: Bin;
  tip: string;
  years: number;
  risk_score?: number;
};

// Normalize & guardrail whatever the model returns
function normalizeDecision(raw: any, rules: Record<string, any>): Decision {
  let material = String(raw?.material ?? "").toLowerCase();
  let bin: Bin =
    raw?.bin === "recycling" ||
    raw?.bin === "compost" ||
    raw?.bin === "landfill" ||
    raw?.bin === "special"
      ? raw.bin
      : "landfill";
  let years = Number.isFinite(raw?.years) ? Number(raw.years) : 50;
  let tip =
    typeof raw?.tip === "string" && raw.tip.trim().length > 0
      ? raw.tip.trim().slice(0, 140)
      : "Follow local rules; rinse and sort properly.";

  // If the model picked something out of scope → force unknown→landfill with explicit tip
  if (!ALLOWED.includes(material as AllowedMaterial)) {
    material = "unknown";
    bin = "landfill";
    tip = "Not a recyclable/compostable item here—dispose in landfill.";
  }

  // Apply policy caps/adjustments
  if (material === "glass" && years > 2000) years = 2000;

  // If we DO recognize the material, prefer your rulebook for bin/years/tip
  if (material !== "unknown") {
    const rule = (rules as any)[material] || null;
    if (rule) {
      bin = (rule.bin as Bin) ?? bin;
      years =
        typeof rule.years === "number"
          ? material === "glass"
            ? Math.min(2000, rule.years)
            : rule.years
          : years;
      tip = String(rule.tip ?? tip);
    }
  }

  return {
    material,
    bin,
    tip,
    years,
    risk_score: Math.max(0, Math.min(1, Number(raw?.risk_score ?? 0))),
  };
}

export async function POST(req: NextRequest) {
  const {
    labels = [],
    rules = {},
    meta = {},
  } = await req.json().catch(() => ({ labels: [], rules: {}, meta: {} }));
  const hasKey = !!process.env.OPENAI_API_KEY;

  // ---------- LLM path (Chat Completions JSON mode) ----------
  if (hasKey) {
    try {
      const system =
        "You are a strict recycling policy engine. Output ONLY compact JSON. Prefer conservative guidance; " +
        "if unsure, choose stricter binning and explain briefly in `tip` (<=140 chars).";
      const user = [
        "Return JSON with keys: material, bin (recycling|compost|landfill|special), tip, years (number), risk_score (0..1).",
        "Allowed materials: plastic, metal, glass, paper, cardboard, organic, ewaste. If none fits, use material='unknown' and bin='landfill' with a clear tip.",
        "Cap glass years at 2000.",
        `Labels: ${JSON.stringify(labels)}`,
        `Rules: ${JSON.stringify(rules)}`,
        `FraudMeta: ${JSON.stringify(meta)}`,
      ].join("\n");

      const chat = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
        // Older SDKs know json_object; this avoids the Responses API typing issue
        response_format: { type: "json_object" as any },
      });

      const text = chat.choices?.[0]?.message?.content || "{}";
      let parsed: any = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        // fall through to heuristic
        return heuristic(labels, rules, { reason: "json_parse_failed" });
      }

      const json = normalizeDecision(parsed, rules);
      return new Response(JSON.stringify(json), {
        headers: {
          "content-type": "application/json",
          "x-map-mode": "llm",
          "x-map-model": MODEL,
        },
      });
    } catch (err: any) {
      const msg = (err?.message || "llm_error").slice(0, 120);
      return heuristic(labels, rules, { reason: msg });
    }
  }

  // ---------- No key → heuristic ----------
  return heuristic(labels, rules, { reason: "no_key" });
}

// ---------- Heuristic fallback (shared) ----------
function heuristic(
  labels: any[],
  rules: Record<string, any>,
  diag?: { reason?: string }
) {
  const top = (labels?.[0]?.name || "").toLowerCase();

  const material = top.includes("glass")
    ? "glass"
    : top.includes("aluminum") ||
      top.includes("steel") ||
      top.includes("tin") ||
      top.includes("metal")
    ? "metal"
    : top.includes("cardboard") || top.includes("box")
    ? "cardboard"
    : top.includes("paper")
    ? "paper"
    : top.includes("banana") ||
      top.includes("apple") ||
      top.includes("food") ||
      top.includes("peel")
    ? "organic"
    : top.includes("battery") ||
      top.includes("phone") ||
      top.includes("electronic")
    ? "ewaste"
    : top.includes("bottle") ||
      top.includes("cup") ||
      top.includes("plastic") ||
      top.includes("clamshell")
    ? "plastic"
    : "unknown";

  const rule = (rules as any)[material] || {
    bin: "landfill",
    years: 50,
    tip: "Not recyclable here—use landfill.",
  };
  const safeYears =
    material === "glass" ? Math.min(2000, rule.years) : rule.years;

  const json: Decision = {
    material,
    bin: material === "unknown" ? "landfill" : (rule.bin as Bin),
    tip:
      material === "unknown"
        ? "Not a recyclable/compostable item here—dispose in landfill."
        : String(rule.tip),
    years: safeYears,
    risk_score: 0,
  };

  return new Response(JSON.stringify(json), {
    headers: {
      "content-type": "application/json",
      "x-map-mode": "heuristic",
      "x-map-model": MODEL,
      ...(diag?.reason ? { "x-map-error": diag.reason } : {}),
    },
  });
}
