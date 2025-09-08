import "@tensorflow/tfjs";
import type { MobileNet } from "@tensorflow-models/mobilenet";
import type {
  ObjectDetection,
  DetectedObject,
} from "@tensorflow-models/coco-ssd";

export type Pred = { className: string; probability: number };
export type Detection = {
  class: string;
  score: number;
  bbox: [number, number, number, number];
};

let _mobilenetModel: MobileNet | null = null;
async function getMobileNet(): Promise<MobileNet> {
  if (_mobilenetModel) return _mobilenetModel;
  const mobilenet = await import("@tensorflow-models/mobilenet");
  _mobilenetModel = await mobilenet.load();
  return _mobilenetModel;
}

let _cocoModel: ObjectDetection | null = null;
export async function getCoco(): Promise<ObjectDetection> {
  if (_cocoModel) return _cocoModel;
  const cocoSsd = await import("@tensorflow-models/coco-ssd");
  _cocoModel = await cocoSsd.load({ base: "lite_mobilenet_v2" });
  return _cocoModel;
}

const PRIORITY_CLASSES = new Set([
  "cup",
  "bottle",
  "wine glass",
  "bowl",
  "banana",
  "apple",
  "orange",
  "pizza",
  "sandwich",
  "donut",
  "cake",
  "carrot",
  "broccoli",
  "book",
  "laptop",
  "keyboard",
  "cell phone",
]);

const PAPER_HINTS = [
  "paper",
  "sheet",
  "a4",
  "document",
  "doc",
  "page",
  "printer paper",
  "notebook",
  "book",
  "magazine",
  "newspaper",
  "envelope",
  "receipt",
  "invoice",
  "letter",
  "menu",
];
const CUP_HINTS = ["paper cup", "coffee cup", "hot cup", "cup"];

function hasAnyHint(names: string[], hints: string[]) {
  return names.some((n) => hints.some((h) => n.includes(h)));
}

// Center/size weighting helpers
function centerWeight(
  b: [number, number, number, number],
  W: number,
  H: number
) {
  const [x, y, w, h] = b;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const dx = Math.abs(cx - W / 2) / (W / 2);
  const dy = Math.abs(cy - H / 2) / (H / 2);
  const dist = Math.sqrt(dx * dx + dy * dy);
  return 1 - Math.min(1, dist);
}
function sizeWeight(b: [number, number, number, number], W: number, H: number) {
  const area = b[2] * b[3];
  return Math.min(1, area / (W * H));
}

// --- stronger ROI with center-crop fallback ---
export async function detectPrimaryROI(src: HTMLCanvasElement): Promise<{
  roi: HTMLCanvasElement;
  detections: Detection[];
  primary?: Detection;
}> {
  const model = await getCoco();
  const detsRaw = (await model.detect(src)) as DetectedObject[];

  const W = src.width;
  const H = src.height;

  const dets: Detection[] = detsRaw.map((d) => ({
    class: d.class,
    score: d.score,
    bbox: d.bbox as [number, number, number, number],
  }));

  const scored = dets
    .filter((d) => (d.bbox[2] * d.bbox[3]) / (W * H) >= 0.06)
    .map((d) => {
      const cw = centerWeight(d.bbox, W, H);
      const sw = sizeWeight(d.bbox, W, H);
      const pBoost = PRIORITY_CLASSES.has(d.class) ? 0.35 : 0;
      const score = d.score * (1 + 1.2 * cw + 0.6 * sw) + pBoost;
      return { d, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0]?.d;

  // Fallback: center crop if no strong detection
  if (!best) {
    const out = document.createElement("canvas");
    const cw = Math.round(W * 0.6);
    const ch = Math.round(H * 0.6);
    const sx = Math.round((W - cw) / 2);
    const sy = Math.round((H - ch) / 2);
    out.width = 320;
    out.height = Math.round((ch / cw) * 320) || 320;
    const octx = out.getContext("2d")!;
    octx.drawImage(src, sx, sy, cw, ch, 0, 0, out.width, out.height);
    return { roi: out, detections: dets, primary: undefined };
  }

  const [x, y, w, h] = best.bbox;
  const pad = 0.12;
  const sx = Math.max(0, x - w * pad);
  const sy = Math.max(0, y - h * pad);
  const sw = Math.min(W - sx, w * (1 + 2 * pad));
  const sh = Math.min(H - sy, h * (1 + 2 * pad));

  const out = document.createElement("canvas");
  const targetW = 320;
  const targetH = Math.round((sh / sw) * targetW) || targetW;
  out.width = targetW;
  out.height = targetH;
  const octx = out.getContext("2d")!;
  octx.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);

  return { roi: out, detections: dets, primary: best };
}

export async function classify(canvas: HTMLCanvasElement): Promise<Pred[]> {
  try {
    const model = await getMobileNet();
    const preds = await model.classify(canvas);
    // Cast to our simple Pred shape
    return preds as unknown as Pred[];
  } catch {
    return [{ className: "plastic bottle", probability: 0.9 }];
  }
}

// --- mergeLabels that ignores decorative content on paper ---
const CONTENT_CLASSES = new Set([
  "person",
  "man",
  "woman",
  "boy",
  "girl",
  "elephant",
  "zebra",
  "giraffe",
  "cat",
  "dog",
  "bird",
  "horse",
  "kite",
  "tv",
  "laptop",
  "keyboard",
  "potted plant",
  "remote",
  "mouse",
]);

export function mergeLabels(dets: Detection[], mob: Pred[]): Pred[] {
  const out: Pred[] = [];

  // detector first (top 5)
  const detPreds: Pred[] = dets
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((d) => ({ className: d.class.toLowerCase(), probability: d.score }));

  for (const p of detPreds) {
    if (p.className === "cup") {
      // push cup-specific synonyms hard so patterns don't win
      out.push({
        className: "paper cup",
        probability: Math.min(1, p.probability * 0.95),
      });
      out.push({ className: "coffee cup", probability: p.probability * 0.9 });
    }
    if (p.className === "bottle") {
      out.push({
        className: "plastic bottle",
        probability: p.probability * 0.9,
      });
      out.push({ className: "glass bottle", probability: p.probability * 0.7 });
    }
    out.push(p);
  }

  // then MobileNet, de-dup by name
  const seen = new Set(out.map((p) => p.className));
  for (const m of mob) {
    const name = m.className.toLowerCase();
    if (!seen.has(name)) {
      out.push({ className: name, probability: m.probability });
      seen.add(name);
    }
  }

  // PAPER-FIRST: if we have strong paper cues and no cup cue,
  // inject 'paper' at the top and down-weight content labels.
  const names = out.map((p) => p.className);
  const paperCue = hasAnyHint(names, PAPER_HINTS);
  const cupCue = hasAnyHint(names, CUP_HINTS);

  if (paperCue && !cupCue) {
    // down-weight decorative content that happens to be printed on paper
    for (const p of out) {
      if (CONTENT_CLASSES.has(p.className)) p.probability *= 0.35;
    }
    // inject/boost 'paper'
    const strongest = Math.max(...out.map((p) => p.probability));
    out.unshift({ className: "paper", probability: Math.max(0.92, strongest) });
  }

  return out.sort((a, b) => b.probability - a.probability).slice(0, 12);
}
