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

const DEFAULT_BIN_BY_MATERIAL: Record<AllowedMaterial, Bin> = {
  plastic: "recycling",
  metal: "recycling",
  glass: "recycling",
  paper: "recycling",
  cardboard: "recycling",
  organic: "compost",
  ewaste: "special",
};

const DEFAULT_YEARS_BY_MATERIAL: Record<AllowedMaterial, number> = {
  plastic: 450,
  metal: 50,
  glass: 2000, // cap enforced below
  paper: 2,
  cardboard: 2,
  organic: 1,
  ewaste: 1000,
};

// ---------- material-first cues ----------
const PAPER_RE =
  /\b(paper|sheet|a4|document|doc|page|printer(?: |-)?paper|notebook|book|magazine|newspaper|envelope|receipt|invoice|letter|menu)\b/;
const CUP_RE = /\b(paper cup|coffee cup|hot cup|\bcup\b)\b/;

function hasPaperCues(labels: Label[]) {
  return labels.some((l) => PAPER_RE.test((l.name || "").toLowerCase()));
}
function hasCupCues(labels: Label[]) {
  return labels.some((l) => CUP_RE.test((l.name || "").toLowerCase()));
}

// ---------- utilities ----------
function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

function computeRisk(meta: Record<string, unknown>, labels: Label[]): number {
  const top =
    labels[0]?.prob ??
    (typeof meta.conf === "number" ? (meta.conf as number) : undefined);
  const top2 = labels[1]?.prob;
  let risk = 0;

  if (typeof top === "number") {
    if (top < 0.3) risk += 0.55;
    else if (top < 0.5) risk += 0.35;
  }

  const delta =
    typeof meta.delta === "number" ? (meta.delta as number) : undefined;
  if (typeof delta === "number" && delta < 0.02) risk += 0.25;

  const recent =
    typeof meta.recentCount === "number" ? (meta.recentCount as number) : 0;
  if (recent >= 6) risk += 0.3;
  else if (recent >= 3) risk += 0.15;

  if (
    typeof top === "number" &&
    typeof top2 === "number" &&
    Math.abs(top - top2) < 0.15
  ) {
    risk += 0.1;
  }

  return clamp01(risk);
}

// Normalize & guardrail whatever the model returns
function normalizeDecision(raw: unknown, rules: Rules): Decision {
  const r =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};

  let material = String(r["material"] ?? "").toLowerCase();
  const binCandidate = r["bin"];
  let bin: Bin =
    binCandidate === "recycling" ||
    binCandidate === "compost" ||
    binCandidate === "landfill" ||
    binCandidate === "special"
      ? (binCandidate as Bin)
      : "landfill";

  let years =
    typeof r["years"] === "number" && Number.isFinite(r["years"])
      ? (r["years"] as number)
      : 50;

  const tipRaw =
    typeof r["tip"] === "string" && r["tip"].trim().length > 0
      ? (r["tip"] as string)
      : "";
  let tip =
    tipRaw.trim().length > 0
      ? tipRaw.trim().slice(0, 140)
      : "Follow local rules; rinse and sort properly.";

  // Out-of-scope → unknown/landfill with explicit tip
  if (!ALLOWED.includes(material as AllowedMaterial)) {
    material = "unknown";
    bin = "landfill";
    tip = "Not a recyclable/compostable item here—dispose in landfill.";
  }

  // Prefer rulebook for recognized materials; otherwise sensible defaults
  if (material !== "unknown") {
    const rule = rules[material] || {};
    bin =
      (rule.bin as Bin) ??
      bin ??
      DEFAULT_BIN_BY_MATERIAL[material as AllowedMaterial];
    years =
      typeof rule.years === "number"
        ? material === "glass"
          ? Math.min(2000, rule.years)
          : rule.years
        : material === "glass"
        ? 2000
        : DEFAULT_YEARS_BY_MATERIAL[material as AllowedMaterial];
    tip = String(rule.tip ?? tip);

    // ensure default bin if we somehow ended at landfill
    if (bin === "landfill") {
      bin = DEFAULT_BIN_BY_MATERIAL[material as AllowedMaterial];
    }
  }

  // Apply caps
  if (material === "glass" && years > 2000) years = 2000;

  return {
    material,
    bin,
    tip,
    years,
    risk_score: clamp01(Number((r["risk_score"] as number | undefined) ?? 0)),
  };
}

// ---------- Heuristic helpers ----------
function anyMatch(labels: Label[], rex: RegExp): boolean {
  return labels.some((l) => rex.test((l.name || "").toLowerCase()));
}

function inferMaterialFromLabels(
  labels: Label[]
): AllowedMaterial | "unknown" | "paper_cup_special" {
  // Strong early exits
  if (
    anyMatch(
      labels,
      /\b(battery|batteries|phone|laptop|tablet|charger|cable|earbuds?|power bank|light bulb|printer cartridge|electronics?)\b/
    )
  )
    return "ewaste";

  // Paper cup / coffee cup (plastic-lined → usually non-recyclable curbside)
  if (anyMatch(labels, /\b(paper cup|coffee cup|hot cup)\b/))
    return "paper_cup_special";

  // If we have paper cues and no "cup" cues -> treat as *paper* (A4, book, receipt, menu, etc.)
  if (hasPaperCues(labels) && !hasCupCues(labels)) return "paper";

  if (
    anyMatch(labels, /\b(jar|bottle)\b/) &&
    anyMatch(labels, /\b(glass|jar)\b/)
  )
    return "glass";

  if (anyMatch(labels, /\b(glass|jar|wine glass)\b/)) return "glass";

  if (anyMatch(labels, /\b(aluminum|tin|steel|metal|drink can|can)\b/))
    return "metal";

  if (anyMatch(labels, /\b(corrugated|cardboard|shipping box|carton|box)\b/))
    return "cardboard";

  if (
    anyMatch(
      labels,
      /\b(paper|sheet|document|doc|a4|printer(?: |-)?paper|page|notebook|book|magazine|newspaper|envelope|receipt|invoice|letter|mail|paper bag)\b/
    )
  )
    return "paper";

  if (
    anyMatch(
      labels,
      /\b(banana|apple|orange|food|peel|scraps?|coffee grounds?|tea bag|carrot|broccoli|bread|eggshells?)\b/
    )
  )
    return "organic";

  if (
    anyMatch(
      labels,
      /\b(bottle|plastic\b|clamshell|tub|lid|straw|bag|film|blister|shrink wrap|takeout lid)\b/
    )
  )
    return "plastic";

  return "unknown";
}

// ---------- Route ----------
export async function POST(req: NextRequest) {
  const {
    labels = [],
    rules = {},
    meta = {},
  } = (await req.json().catch(() => ({ labels: [], rules: {}, meta: {} }))) as {
    labels?: unknown;
    rules?: unknown;
    meta?: unknown; // { recentCount?: number, delta?: number, conf?: number, ... }
  };

  const hasKey = !!process.env.OPENAI_API_KEY;
  const labelsArr = Array.isArray(labels) ? (labels as Label[]) : [];
  const rulesObj = (rules as Rules) ?? {};
  const metaObj = (meta ?? {}) as Record<string, unknown>;

  // Inject a strong PAPER hint if we see paper cues and no "cup" cues
  const labelsForModel: Label[] = [...labelsArr];
  if (hasPaperCues(labelsArr) && !hasCupCues(labelsArr)) {
    const top = labelsArr[0]?.prob ?? 0.95;
    labelsForModel.unshift({ name: "paper", prob: Math.max(0.9, top) });
  }

  // ---------- LLM path (Chat Completions JSON mode) ----------
  if (hasKey) {
    try {
      const system = [
        "You are a STRICT recycling policy engine.",
        "Your ONLY output is a compact JSON object with keys:",
        '{ "material": string, "bin": "recycling|compost|landfill|special", "tip": string, "years": number, "risk_score": number }',
        "No extra text. No code fences. No explanations.",
        "Be conservative: if unsure, choose stricter binning and say so in tip (<=140 chars).",
        "Never describe or analyze people or pets — focus only on the item material.",
      ].join(" ");

      const user = [
        "TASK:",
        "- Decide the recycling mapping given image LABELS (with probabilities), local RULES, and anti-fraud META.",
        "- Allowed materials: plastic, metal, glass, paper, cardboard, organic, ewaste. If none fits → material='unknown', bin='landfill'.",
        "- Default bin by material (if RULES don't override): plastic/metal/glass/paper/cardboard → recycling; organic → compost; ewaste → special.",

        "",
        "HOW TO USE INPUTS:",
        "- LABELS is an array of {name, prob}. Names may be noisy (e.g., 'bottle', 'tin can', 'pizza box', 'menu'). Normalize to MATERIALS below.",
        "- RULES is a mapping per material that may override bin/years/tip. Always respect RULES if present.",
        "- META includes: conf (top prob 0..1), delta (camera motion 0..1), recentCount (# recent scans for this bin). Use only for risk_score per policy.",

        "",
        "MATERIAL-FIRST RULE:",
        "- If ANY label suggests flat paper media AND there is NO 'cup' cue, classify as material='paper' (unless RULES say otherwise).",
        "- Flat paper media cues include: sheet, A4, printer paper, document, page, notebook, book, magazine, newspaper, mail, envelope, receipt, invoice, letter, handout, flyer, brochure, menu, ticket.",
        "- 'menu'/'receipt'/'document' are PAPER, not 'unknown'.",
        "- EXCEPTION: if there is a clear 'paper cup' or 'coffee cup' cue → treat as paper-cup (see subtypes).",

        "",
        "DECORATIVE-IMAGE RULE (IGNORE PRINTED SUBJECTS):",
        "- If labels describe a depicted subject likely printed on the item (e.g., 'elephant', 'person', 'flower', 'landscape', 'logo', 'illustration', 'drawing', 'sticker', 'cover art'), DO NOT infer the material from that subject.",
        "- Prefer the substrate/material cues instead (e.g., notebook/book/page → material='paper').",
        "- Example: labels ['elephant', 'book'] → PAPER; labels ['person', 'magazine'] → PAPER.",
        "- If paper cues are present without 'cup' cues, treat material as 'paper' regardless of printed subjects.",

        "",
        "BACKGROUND DEBIASING:",
        "- Deprioritize typical environment labels (person, face, hand, potted plant, plant, tree, keyboard, laptop, monitor, tv, chair, couch, shelf, refrigerator, bed) when a plausible item/material label is present (cup, bottle, jar, box, book, notebook, can, plate, foil, bag, wrapper, carton, paper, cardboard).",
        "- If only background labels are present and no clear material cue is available → material='unknown'.",
        "- Do not classify based on people/pets/animals (person, dog, cat, bird, horse, etc.).",

        "",
        "CAMERA GUIDANCE (for interpreting LABELS):",
        "- Treat 'centered' and 'large' objects as more likely foreground; de-emphasize small/edge/background items.",
        "- If labels indicate both a subject and a substrate (e.g., 'elephant' + 'book'), choose the substrate as the material.",

        "",
        "CLASSIFICATION GUIDANCE (SYNONYMS & CUES):",
        "- plastic: PET/HDPE/LDPE/PP, water/soda bottle, cup, clamshell, yogurt tub, blister pack, straw, cutlery, plastic bag/film, shrink wrap, black plastic, polystyrene/Styrofoam, takeout lid.",
        "- metal: aluminum/tin/steel can, drink can, metal lid, CLEAN foil (ball it), foil tray, empty aerosol can.",
        "- glass: jar, bottle (clear/green/brown). Broken glass often excluded → prefer stricter unless RULES accept.",
        "- paper: office/printer paper, sheet/page, book/notebook, magazine/newspaper, mail/envelope, paper bag, receipts, flyers, menus.",
        "- cardboard: corrugated/shipping/moving box, carton sleeve; pizza box is uncertain if greasy.",
        "- organic: food scraps, peels, cores, coffee grounds, tea bags (remove staples), bread, eggshells.",
        "- ewaste: batteries (AA/AAA/lithium), phones, laptops/tablets, chargers/cables, earbuds, power banks, printer cartridges, CFL bulbs, small electronics.",
        "- Often NOT curbside recyclable (treat as 'unknown' unless RULES allow): textiles/clothing, toys, wood, ceramics, diapers, paper cups (plastic-lined), plastic film/bags, Styrofoam, metallized snack wrappers (chips/candy), multi-layer pouches, propane tanks, sharps.",

        "",
        "SPECIAL SUBTYPES (DEFAULT TO STRICTER unless RULES say otherwise):",
        "- Paper cups: usually plastic-lined; default material='paper' but bin='landfill' (or 'compost' ONLY if RULES explicitly accept certified compostable cups). Tip: 'Paper cups are plastic-lined.'",
        "- Cartons (Tetra Pak): paper+plastic(+aluminum). If RULES accept cartons → recycling; else unknown/landfill.",
        "- Plastic film & bags: usually NOT curbside; if RULES mention store drop-off → bin='special' (material='plastic'); else unknown/landfill.",
        "- Foil vs metallized plastic: crumple test — true foil keeps shape (metal), metallized plastic springs back (landfill). If unsure → landfill.",
        "- Black plastic: often not sortable → unknown/landfill unless RULES accept.",
        "- Greasy/food-soiled paper/cardboard: NOT recycling. If local compost accepts food-soiled paper → compost; else landfill.",
        "- Batteries & bulbs: material='ewaste', bin='special' (never 'recycling').",
        "- Broken glass: if RULES unclear → unknown/landfill; if accepted and safely contained → glass/recycling.",

        "",
        "MULTI-MATERIAL & CONTAINERS:",
        "- If easily separable (e.g., metal lid on glass jar), classify by main material and mention separation in tip (<=140 chars).",
        "- If non-separable composite (e.g., coffee cup with plastic lining) and RULES don’t explicitly accept → stricter bin (landfill or special).",
        "- For labels that include contents (e.g., 'pizza' and 'box'): assume contamination; prefer stricter (compost/landfill) unless RULES accept soiled paper/cardboard.",

        "",
        "DECISION RULES:",
        "1) Select the material that best matches plausible labels. If top probability < 0.40 → material='unknown'.",
        "2) Apply RULES[material] for bin/years/tip when present; otherwise use defaults below. Cap glass years at 2000.",
        "3) If material='unknown', set bin='landfill' and add a short reason in tip (<=140 chars).",
        "4) If conflicting materials are plausible (e.g., 'paper cup' vs 'plastic cup'), choose the stricter outcome and say why briefly.",
        "5) Tips must be <=140 chars, specific & actionable (e.g., 'Rinse & flatten.', 'Electronics drop-off.', 'Greasy—use compost/landfill.', 'Remove lid & recycle jar.').",

        "",
        "YEARS (DECOMPOSITION) POLICY:",
        "- Use RULES[material].years when provided. Otherwise defaults:",
        "  plastic=450, metal=50, glass=2000 (hard cap 2000), paper=2, cardboard=2, organic=1, ewaste=1000, unknown=50.",

        "",
        "AMBIGUITY & CONFLICT RESOLUTION:",
        "- If top-2 labels map to different bins and |p1 - p2| < 0.15 → choose stricter bin and mention uncertainty in tip.",
        "- When 'cup' appears without 'glass/ceramic/metal' cues, assume paper/lined cup → stricter (usually landfill) unless RULES accept.",
        "- 'menu', 'receipt', 'document', 'page', 'book', 'notebook' → paper (recycling) if clean & dry.",
        "- 'napkin', 'tissue', 'paper towel' → not recycling; compost if RULES allow, else landfill.",
        "- For 'foil' vs 'wrapper' uncertainty → landfill.",
        "- For 'pizza box': if 'grease' or food present implied → compost (if allowed) else landfill; otherwise recycle clean lid only.",

        "",
        "RISK SCORE (0..1):",
        "- Start at 0.",
        "- If META.conf < 0.50 → +0.35; if < 0.30 → +0.55.",
        "- If META.delta < 0.02 → +0.25.",
        "- If META.recentCount >= 3 → +0.15; if >= 6 → +0.30.",
        "- If top-2 label probabilities differ by < 0.15 → +0.10.",
        "- Clamp to [0,1].",
        "- Do NOT encode policy outcomes into risk; it only reflects uncertainty/abuse likelihood.",

        "",
        "DEFAULTS (ONLY IF RULES DON'T SPECIFY):",
        "- Bin by material: plastic/metal/glass/paper/cardboard → recycling; organic → compost; ewaste → special; unknown → landfill.",
        "- Years by material: plastic=450, metal=50, glass=2000 (cap), paper=2, cardboard=2, organic=1, ewaste=1000, unknown=50.",
        "- Tips: concise, local-actionable, <=140 chars.",

        "",
        "OUTPUT FORMAT — JSON ONLY:",
        '{ "material": "...", "bin": "recycling|compost|landfill|special", "tip": "...", "years": <number>, "risk_score": <0..1> }',
        "No code fences. No extra keys. No explanations outside JSON.",

        "",
        "EXAMPLES:",
        "- Example 1 (A4 sheet):",
        '  Labels: [{"name":"menu","prob":0.72},{"name":"paper","prob":0.2}]',
        '  → {"material":"paper","bin":"recycling","tip":"Recycle clean paper; remove staples.","years":2,"risk_score":0.0}',
        "- Example 2 (paper cup):",
        '  Labels: [{"name":"paper cup","prob":0.81}]',
        '  → {"material":"paper","bin":"landfill","tip":"Paper cups are plastic-lined; use landfill unless your program accepts them.","years":2,"risk_score":0.0}',
        "- Example 3 (plastic bottle):",
        '  Labels: [{"name":"bottle","prob":0.83},{"name":"plastic","prob":0.62}]',
        '  → {"material":"plastic","bin":"recycling","tip":"Empty & quick rinse; replace cap if accepted.","years":450,"risk_score":0.0}',
        "- Example 4 (battery):",
        '  Labels: [{"name":"battery","prob":0.77}]',
        '  → {"material":"ewaste","bin":"special","tip":"Take batteries to e-waste drop-off.","years":1000,"risk_score":0.0}',
        "- Example 5 (decorated notebook):",
        '  Labels: [{"name":"elephant","prob":0.71},{"name":"book","prob":0.44}]',
        '  → {"material":"paper","bin":"recycling","tip":"Recycle clean paper; remove bindings if required.","years":2,"risk_score":0.1}',

        "",
        "INPUT:",
        `Labels: ${JSON.stringify(labelsForModel)}`,
        `Rules: ${JSON.stringify(rulesObj)}`,
        `Meta: ${JSON.stringify(metaObj)}`,
      ].join("\\n");

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
      const normalized = normalizeDecision(parsedUnknown, rulesObj);

      const final: Decision = {
        ...normalized,
        risk_score:
          typeof normalized.risk_score === "number"
            ? clamp01(normalized.risk_score)
            : computeRisk(metaObj, labelsForModel),
      };

      return new Response(JSON.stringify(final), {
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
      return heuristic(labelsForModel, rulesObj, metaObj, { reason: msg });
    }
  }

  // ---------- No key → heuristic ----------
  return heuristic(labelsForModel, rulesObj, metaObj, { reason: "no_key" });
}

// ---------- Heuristic fallback (shared) ----------
function heuristic(
  labels: Label[],
  rules: Rules,
  meta: Record<string, unknown>,
  diag?: { reason?: string }
) {
  // If very low confidence overall → unknown
  const topProb = typeof labels?.[0]?.prob === "number" ? labels[0].prob! : 1;
  if (topProb < 0.4) {
    const json: Decision = {
      material: "unknown",
      bin: "landfill",
      tip: "Low confidence — cannot classify reliably. Use landfill.",
      years: 50,
      risk_score: computeRisk(meta, labels),
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

  // Look at multiple labels and infer
  const inferred = inferMaterialFromLabels(labels);

  // Special-case paper cup: treat as non-recyclable unless rules explicitly allow
  if (inferred === "paper_cup_special") {
    const json: Decision = {
      material: "unknown",
      bin: "landfill",
      tip: "Paper cups are often plastic-lined — not curbside recyclable.",
      years: 50,
      risk_score: computeRisk(meta, labels),
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

  const material: AllowedMaterial | "unknown" =
    inferred === "unknown" ? "unknown" : inferred;

  let bin: Bin;
  let years: number;
  let tip: string;

  if (material === "unknown") {
    bin = "landfill";
    years = 50;
    tip = "Not a recyclable/compostable item here—dispose in landfill.";
  } else {
    const rule = rules[material] || {};
    bin = (rule.bin as Bin) ?? DEFAULT_BIN_BY_MATERIAL[material];
    years =
      typeof rule.years === "number"
        ? material === "glass"
          ? Math.min(2000, rule.years)
          : rule.years
        : DEFAULT_YEARS_BY_MATERIAL[material];
    tip = String(
      rule.tip ??
        (material === "ewaste"
          ? "Take electronics/batteries to a special drop-off."
          : material === "organic"
          ? "Compost food scraps if your program allows."
          : "Rinse and recycle.")
    );
  }

  // Clamp to reasonable minimums to avoid 0 yrs cases from rules
  const MIN_YEARS: Record<string, number> = {
    plastic: 450,
    metal: 50,
    glass: 1,
    paper: 2,
    cardboard: 2,
    organic: 1,
    ewaste: 1000,
    unknown: 50,
  };
  const minY = MIN_YEARS[material] ?? 1;
  if (!Number.isFinite(years) || years < minY) years = minY;

  const json: Decision = {
    material,
    bin,
    tip,
    years,
    risk_score: computeRisk(meta, labels),
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
