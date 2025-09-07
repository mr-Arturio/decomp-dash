import { NextRequest } from "next/server";
import OpenAI from "openai";
import type { ChatCompletionCreateParams } from "openai/resources/chat/completions";

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

type Rule = { bin?: Bin; years?: number; tip?: string };
type Rules = Record<string, Rule>;
type Label = { name: string; prob?: number };

// Normalize & guardrail whatever the model returns
function normalizeDecision(raw: unknown, rules: Rules): Decision {
  const r = (
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {}
  ) as Record<string, unknown>;

  let material = String((r["material"] ?? "") as string).toLowerCase();
  const binCandidate = r["bin"] as unknown;
  let bin: Bin =
    binCandidate === "recycling" ||
    binCandidate === "compost" ||
    binCandidate === "landfill" ||
    binCandidate === "special"
      ? (binCandidate as Bin)
      : "landfill";

  let years = typeof r["years"] === "number" ? (r["years"] as number) : 50;
  const tipRaw = typeof r["tip"] === "string" ? (r["tip"] as string) : "";
  let tip =
    tipRaw.trim().length > 0
      ? tipRaw.trim().slice(0, 140)
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
    const rule = rules[material] || null;
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
    risk_score: Math.max(
      0,
      Math.min(1, Number((r["risk_score"] as number | undefined) ?? 0))
    ),
  };
}

export async function POST(req: NextRequest) {
  const {
    labels = [],
    rules = {},
    meta = {},
  } = (await req.json().catch(() => ({ labels: [], rules: {}, meta: {} }))) as {
    labels?: unknown;
    rules?: unknown;
    meta?: unknown;
  };
  const hasKey = !!process.env.OPENAI_API_KEY;

  const labelsArr = Array.isArray(labels) ? (labels as Label[]) : [];
  const rulesObj = (rules as Rules) ?? {};

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
        `Labels: ${JSON.stringify(labelsArr)}`,
        `Rules: ${JSON.stringify(rulesObj)}`,
        `FraudMeta: ${JSON.stringify(meta)}`,
      ].join("\n");

      const responseFormat: ChatCompletionCreateParams["response_format"] = {
        type: "json_object",
      } as const;

      const chat = await openai.chat.completions.create({
        model: MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0,
        response_format: responseFormat,
      });

      const text = chat.choices?.[0]?.message?.content || "{}";
      const parsedUnknown = JSON.parse(text) as unknown;

      const json = normalizeDecision(parsedUnknown, rulesObj);
      return new Response(JSON.stringify(json), {
        headers: {
          "content-type": "application/json",
          "x-map-mode": "llm",
          "x-map-model": MODEL,
        },
      });
    } catch (err: unknown) {
      const msg =
        typeof err === "object" && err && "message" in err
          ? String((err as { message?: string }).message ?? "llm_error").slice(
              0,
              120
            )
          : "llm_error";
      return heuristic(labelsArr, rulesObj, { reason: msg });
    }
  }

  // ---------- No key → heuristic ----------
  return heuristic(labelsArr, rulesObj, { reason: "no_key" });
}

// ---------- Heuristic fallback (shared) ----------
function heuristic(labels: Label[], rules: Rules, diag?: { reason?: string }) {
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

  const rule = rules[material] || {
    bin: "landfill" as Bin,
    years: 50,
    tip: "Not recyclable here—use landfill.",
  };
  const safeYears =
    material === "glass" ? Math.min(2000, rule.years ?? 50) : rule.years ?? 50;

  const json: Decision = {
    material,
    bin:
      material === "unknown" ? "landfill" : ((rule.bin ?? "landfill") as Bin),
    tip:
      material === "unknown"
        ? "Not a recyclable/compostable item here—dispose in landfill."
        : String(rule.tip ?? "Follow local rules; rinse and sort properly."),
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
