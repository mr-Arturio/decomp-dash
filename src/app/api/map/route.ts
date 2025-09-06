import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const { labels, rules, meta } = await req.json();

  const hasLLM = !!process.env.LLM_ENDPOINT;
  if (hasLLM) {
    const prompt = `You are a recycling policy engine. Given image labels with probabilities and local rules, output strict JSON: {"material":"...","bin":"recycling|compost|landfill|special","rationale":"...","tip":"...","years":number,"risk_score":0-1}.
Labels:${JSON.stringify(labels)}
Rules:${JSON.stringify(rules)}
FraudMeta:${JSON.stringify(meta)}
Constraints: choose plausible material; if ambiguous pick stricter rule and explain; years from rules (cap glass at 2000); risk_score higher for near-duplicates, low motion, many scans, or very low confidence. OUTPUT ONLY JSON.`;
    const r = await fetch(process.env.LLM_ENDPOINT!, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.LLM_KEY
          ? { authorization: `Bearer ${process.env.LLM_KEY}` }
          : {}),
      },
      body: JSON.stringify({
        model: process.env.LLM_MODEL || "openai/gpt-oss-20b",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      }),
    });
    const data = await r.json().catch(() => null);
    const text = data?.choices?.[0]?.message?.content || "";
    try {
      return new Response(text, {
        headers: { "content-type": "application/json" },
      });
    } catch {}
  }

  // Fallback: map via best label heuristic
  const top = (labels?.[0]?.name || "").toLowerCase() as string;
  const material = top.includes("glass")
    ? "glass"
    : top.includes("metal") ||
      top.includes("aluminum") ||
      top.includes("steel") ||
      top.includes("tin")
    ? "metal"
    : top.includes("paper")
    ? "paper"
    : top.includes("cardboard") || top.includes("box")
    ? "cardboard"
    : top.includes("banana") ||
      top.includes("apple") ||
      top.includes("food") ||
      top.includes("peel")
    ? "compost"
    : top.includes("battery") ||
      top.includes("phone") ||
      top.includes("electronic")
    ? "e-waste"
    : top.includes("bottle") ||
      top.includes("cup") ||
      top.includes("plastic") ||
      top.includes("clamshell")
    ? "plastic"
    : "landfill";
  const rule = rules[material] || {
    bin: "landfill",
    years: 50,
    tip: "Reduce single‑use.",
  };
  const safeYears = material === "glass" ? 2000 : rule.years;
  const json = {
    material,
    bin: rule.bin,
    tip: rule.tip,
    years: safeYears,
    risk_score: 0,
  };
  return new Response(JSON.stringify(json), {
    headers: { "content-type": "application/json" },
  });
}
