/**
 * 候補の路線価図のうち、土地の場所が載っている1枚を選び、地図に重ねる位置（枠）を求める。
 *
 * 1. 土地のまわりの地理院地図（赤い丸が土地）と、候補の路線価図をコンパスくん（Claude）に見せ、
 *    道路の形・川・線路・町名などから、どの図に載っているかと、両方で同じ場所（交差点の角など）を2〜4点選んでもらう
 * 2. その点の組から、路線価図1枚分の枠（中心・縮尺・向き）を最小二乗法で求める（決まった計算）
 * 3. 国土地理院の道路の線に路線価図の道路の線が重なるよう、枠を少しずつ動かして細かく合わせる（決まった計算）
 *
 * 最後は本人が地図の上で重なりを見て確かめる。合っていなければ別の図を選ぶか、手で合わせる。
 */
import { autoAlign } from "@/domain/geo/autoAlign";
import { frameFromPairs } from "@/domain/geo/fit";
import { type Frame, type Paper, frameCorners } from "@/domain/geo/frame";
import { type LatLng, type Road, projector } from "@/domain/geo/lot";
import { captureGsiMap } from "./capture";
import type { Sheet } from "./MapView";
import { renderPdfPage, sheetField } from "./sheet";

export interface Candidate {
  no: string;
  pdfUrl: string;
}

export interface LocateResult {
  /** 選ばれた図番号（分からなければ null） */
  no: string | null;
  frame: Frame | null;
  paper: Paper | null;
  confidence: "high" | "medium" | "low";
  reason: string;
  /** 道路の線で細かく合わせられた */
  refined: boolean;
}

interface LocateResponse {
  sheetNo: string | null;
  confidence: "high" | "medium" | "low";
  landOnSheet: { x: number; y: number } | null;
  points: { map: { x: number; y: number }; sheet: { x: number; y: number }; what: string }[];
  reason: string;
  error?: string;
}

/** 国税庁の路線価図PDFを取ってくる（同じ図は1回だけ） */
export async function fetchSheetPdf(url: string, cache: Map<string, ArrayBuffer>): Promise<ArrayBuffer> {
  const hit = cache.get(url);
  if (hit) return hit;
  const res = await fetch(`/api/rosenka/sheet?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "路線価図を読み込めませんでした。");
  const buf = await res.arrayBuffer();
  cache.set(url, buf);
  return buf;
}

const blobOf = async (s: Sheet) => (await fetch(s.src)).blob();

/** 点が枠の中にあるか（枠の四隅の多角形で判定） */
function inside(frame: Frame, paper: Paper, p: LatLng): boolean {
  const P = projector(p);
  const c = frameCorners(frame, paper).map(P.to);
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = c[i];
    const [bx, by] = c[(i + 1) % 4];
    const cross = (bx - ax) * (0 - ay) - (by - ay) * (0 - ax);
    if (cross !== 0) {
      if (sign === 0) sign = Math.sign(cross);
      else if (Math.sign(cross) !== sign) return false;
    }
  }
  return true;
}

/** 枠が路線価図としてありえる形か（縮尺・向き・土地が枠の中） */
const plausible = (f: Frame, paper: Paper, property: LatLng) => f.scale >= 300 && f.scale <= 20_000 && Math.abs(f.rotation) <= 30 && inside(f, paper, property);

export async function locateSheet(opts: {
  property: LatLng;
  candidates: Candidate[];
  town?: string | null;
  cache: Map<string, ArrayBuffer>;
  roads: Road[];
  onStep?: (msg: string) => void;
}): Promise<LocateResult> {
  const { property, cache, roads, onStep } = opts;
  const candidates = opts.candidates.slice(0, 4);
  onStep?.("候補の路線価図を国税庁のサイトから読み込んでいます");
  const rendered = await Promise.all(
    candidates.map(async (c) => {
      const buf = await fetchSheetPdf(c.pdfUrl, cache);
      return { c, sheet: await renderPdfPage(buf, 1, 1600) };
    }),
  );
  onStep?.("土地のまわりの地図を用意しています");
  const map = await captureGsiMap(property, { zoom: 17, width: 1280, height: 960, marker: true });

  onStep?.("コンパスくんが、土地が載っている路線価図を探しています");
  const fd = new FormData();
  fd.append("map", map.blob, "map.png");
  fd.append("mapSize", `${map.width},${map.height}`);
  if (opts.town) fd.append("town", opts.town);
  for (const r of rendered) {
    fd.append("sheet", await blobOf(r.sheet), `${r.c.no}.png`);
    fd.append("sheetNo", r.c.no);
    fd.append("sheetSize", `${r.sheet.width},${r.sheet.height}`);
  }
  const res = await fetch("/api/rosenka/locate", { method: "POST", body: fd });
  const json = (await res.json()) as LocateResponse;
  const chosen = res.ok ? rendered.find((r) => r.c.no === json.sheetNo) : undefined;
  for (const r of rendered) if (r !== chosen) URL.revokeObjectURL(r.sheet.src);
  if (!res.ok) throw new Error(json.error ?? "路線価図を選べませんでした。");
  if (!chosen) return { no: null, frame: null, paper: null, confidence: json.confidence ?? "low", reason: json.reason ?? "", refined: false };
  const paper = chosen.sheet.paper ?? { widthMm: 420, heightMm: 297 };
  const { width: sw, height: sh } = chosen.sheet;

  // コンパスくんが選んだ同じ場所の組 → 枠
  const pairs = (json.points ?? [])
    .filter((p) => p.map && p.sheet && p.sheet.x >= 0 && p.sheet.x <= sw && p.sheet.y >= 0 && p.sheet.y <= sh)
    .map((p) => ({ img: [p.sheet.x / sw, p.sheet.y / sh] as [number, number], latlng: map.toLatLng(p.map.x, p.map.y) }));
  let frame = frameFromPairs(pairs, paper);
  if ((!frame || !plausible(frame, paper, property)) && json.landOnSheet) {
    // 点の組が使えないときは、土地の位置だけから枠を置く（縮尺は一般的な 1/1,500 から）
    const scale = 1500;
    const x = json.landOnSheet.x / sw;
    const y = json.landOnSheet.y / sh;
    const P = projector(property);
    const east = (x - 0.5) * (paper.widthMm * scale) / 1000;
    const north = (0.5 - y) * (paper.heightMm * scale) / 1000;
    frame = { center: P.from(-east, -north), scale, rotation: 0 };
  }
  if (!frame || !plausible(frame, paper, property)) {
    URL.revokeObjectURL(chosen.sheet.src);
    return { no: chosen.c.no, frame: null, paper, confidence: json.confidence, reason: json.reason, refined: false };
  }

  // 道路の線で細かく合わせる（よくならなければコンパスくんの位置のまま）
  let refined = false;
  if (roads.length > 0) {
    onStep?.("道路の線に合わせて、重なりを細かく調整しています");
    await new Promise((ok) => setTimeout(ok, 30));
    const field = await sheetField(chosen.sheet);
    const r = autoAlign(field, paper, roads, property, frame, 80);
    if (r && r.score < r.before * 0.9 && plausible(r.frame, paper, property)) {
      frame = r.frame;
      refined = true;
    }
  }
  URL.revokeObjectURL(chosen.sheet.src);
  return { no: chosen.c.no, frame, paper, confidence: json.confidence, reason: json.reason, refined };
}
