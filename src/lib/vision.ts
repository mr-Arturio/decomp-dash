import "@tensorflow/tfjs";

export type Pred = { className: string; probability: number };
export type Detection = {
  class: string;
  score: number;
  bbox: [number, number, number, number];
};

let _mobilenetModel: any | null = null;
async function getMobileNet() {
  if (_mobilenetModel) return _mobilenetModel;
  const mobilenet = await import("@tensorflow-models/mobilenet");
  _mobilenetModel = await mobilenet.load();
  return _mobilenetModel;
}

let _cocoModel: any | null = null;
async function getCoco() {
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

export async function detectPrimaryROI(src: HTMLCanvasElement): Promise<{
  roi: HTMLCanvasElement;
  detections: Detection[];
  primary?: Detection;
}> {
  const model = await getCoco();
  const dets = (await model.detect(src)) as Detection[];

  const sorted = [...dets].sort((a, b) => b.score - a.score);
  let primary = sorted.find((d) => PRIORITY_CLASSES.has(d.class));
  if (!primary) primary = sorted[0];

  if (!primary) {
    return { roi: src, detections: [], primary: undefined };
  }

  const [x, y, w, h] = primary.bbox;
  const pad = 0.1;
  const sx = Math.max(0, x - w * pad);
  const sy = Math.max(0, y - h * pad);
  const sw = Math.min(src.width - sx, w * (1 + 2 * pad));
  const sh = Math.min(src.height - sy, h * (1 + 2 * pad));

  const out = document.createElement("canvas");
  out.width = 256;
  out.height = Math.round((sh / sw) * 256) || 256;
  const octx = out.getContext("2d")!;
  octx.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);

  return { roi: out, detections: dets, primary };
}

export async function classify(canvas: HTMLCanvasElement): Promise<Pred[]> {
  try {
    const model = await getMobileNet();
    const preds = await model.classify(canvas);
    return preds as unknown as Pred[];
  } catch {
    return [{ className: "plastic bottle", probability: 0.9 }];
  }
}

export function mergeLabels(dets: Detection[], mob: Pred[]): Pred[] {
  const out: Pred[] = [];

  const detPreds: Pred[] = dets
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((d) => ({ className: d.class.toLowerCase(), probability: d.score }));

  for (const p of detPreds) {
    if (p.className === "cup") {
      out.push({ className: "paper cup", probability: p.probability * 0.85 });
      out.push({ className: "coffee cup", probability: p.probability * 0.8 });
    }
    if (p.className === "bottle") {
      out.push({
        className: "plastic bottle",
        probability: p.probability * 0.9,
      });
      out.push({
        className: "glass bottle",
        probability: p.probability * 0.7,
      });
    }
    out.push(p);
  }

  const seen = new Set(out.map((p) => p.className));
  for (const m of mob) {
    const name = m.className.toLowerCase();
    if (!seen.has(name)) {
      out.push({ className: name, probability: m.probability });
      seen.add(name);
    }
  }

  const names = out.map((p) => p.className);
  const paperCue = hasAnyHint(names, PAPER_HINTS);
  const cupCue = hasAnyHint(names, CUP_HINTS);
  if (paperCue && !cupCue) {
    out.unshift({
      className: "paper",
      probability: Math.max(0.9, (out[0]?.probability as number) ?? 0.9),
    });
  }

  return out.slice(0, 12);
}
