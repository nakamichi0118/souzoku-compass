/**
 * 2つ以上の道路に面する宅地の1㎡当たりの価額（財産評価基本通達15〜18）。
 *
 * - 正面路線：路線価 × 奥行価格補正率 が最も高い道路（通達16(1)）
 * - 側方路線（正面の隣の辺の道路）：その路線価を正面路線とみなして奥行価格補正をした額 × 側方路線影響加算率（付表2）
 * - 裏面路線（正面の向かいの辺の道路）：同じく × 二方路線影響加算率（付表3）
 * - 三方・四方は上を併用（通達18）
 *
 * 安全側（高め）に評価する：角地と準角地の区別は角地の加算率を使い、側方路線に一部しか接しない場合の
 * 按分や、間口狭小・奥行長大・不整形地などの減額の補正はしない。減額できる場合は税理士への相談を案内する。
 * 出典：https://www.nta.go.jp/law/tsutatsu/kihon/sisan/hyoka_new/02/02.htm
 *       https://www.nta.go.jp/law/tsutatsu/kihon/sisan/hyoka_new/02/07.htm（付表1〜3）
 */
import { type District, depthCorrection } from "./depth";

/** 土地の辺の番号。0の向かいが2、1の向かいが3（四角形の辺を順に数えたもの） */
export type Edge = 0 | 1 | 2 | 3;

export interface RoadInput {
  edge: Edge;
  /** 1㎡当たりの路線価（円） */
  price: number;
  /** その道路から見た奥行距離（m） */
  depth: number;
  /** 路線価図の表記（例：420D） */
  notation?: string;
}

/** 付表2 側方路線影響加算率表（角地・準角地） */
const SIDE_RATE: Record<District, { corner: number; semi: number }> = {
  ビル街地区: { corner: 0.07, semi: 0.03 },
  高度商業地区: { corner: 0.1, semi: 0.05 },
  繁華街地区: { corner: 0.1, semi: 0.05 },
  "普通商業・併用住宅地区": { corner: 0.08, semi: 0.04 },
  普通住宅地区: { corner: 0.03, semi: 0.02 },
  中小工場地区: { corner: 0.03, semi: 0.02 },
  大工場地区: { corner: 0.02, semi: 0.01 },
};

/** 付表3 二方路線影響加算率表 */
const BACK_RATE: Record<District, number> = {
  ビル街地区: 0.03,
  高度商業地区: 0.07,
  繁華街地区: 0.07,
  "普通商業・併用住宅地区": 0.05,
  普通住宅地区: 0.02,
  中小工場地区: 0.02,
  大工場地区: 0.02,
};

export const sideRate = (d: District) => SIDE_RATE[d].corner;
export const backRate = (d: District) => BACK_RATE[d];

/** 小数3桁までの率を整数（1/1000）にする */
const milli = (x: number) => Math.round(x * 1000);

export interface RoadLine extends RoadInput {
  role: "front" | "side" | "back";
  depthRate: number;
  /** 路線価 × 奥行価格補正率（円、1円未満切捨て） */
  corrected: number;
  /** 加算率（正面は0） */
  addRate: number;
  /** 加算額（円、1円未満切捨て） */
  addition: number;
}

export interface MultiRoadResult {
  lines: RoadLine[];
  /** 1㎡当たりの価額（円） */
  perSqm: number;
  front: RoadLine;
  steps: string[];
}

export function evaluateRoads(district: District, roads: RoadInput[]): MultiRoadResult | null {
  const usable = roads.filter((r) => r.price > 0 && r.depth > 0);
  if (usable.length === 0) return null;
  const withRate = usable.map((r) => {
    const depthRate = depthCorrection(district, r.depth);
    return { ...r, depthRate, corrected: Math.floor((r.price * milli(depthRate)) / 1000) };
  });
  // 正面路線：奥行価格補正後の価額が最も高い道路（同額なら路線価の高い方、さらに同じなら先に入力した方）
  const front = withRate.reduce((a, b) => (b.corrected > a.corrected || (b.corrected === a.corrected && b.price > a.price) ? b : a));
  const lines: RoadLine[] = withRate.map((r) => {
    if (r === front) return { ...r, role: "front", addRate: 0, addition: 0 };
    const back = r.edge === (((front.edge + 2) % 4) as Edge);
    const addRate = back ? backRate(district) : sideRate(district);
    return { ...r, role: back ? "back" : "side", addRate, addition: Math.floor((r.corrected * milli(addRate)) / 1000) };
  });
  const perSqm = lines.reduce((s, l) => s + (l.role === "front" ? l.corrected : l.addition), 0);
  const yen = (n: number) => n.toLocaleString("ja-JP");
  const name = { front: "正面", side: "側方", back: "裏面" } as const;
  const steps = [
    ...lines
      .sort((a, b) => ["front", "side", "back"].indexOf(a.role) - ["front", "side", "back"].indexOf(b.role))
      .map((l) =>
        l.role === "front"
          ? `正面路線 ${yen(l.price)}円 × 奥行価格補正率 ${l.depthRate}（奥行${l.depth}m） = ${yen(l.corrected)}円`
          : `${name[l.role]}路線 ${yen(l.price)}円 × 奥行価格補正率 ${l.depthRate} × ${l.role === "side" ? "側方路線影響加算率" : "二方路線影響加算率"} ${l.addRate} = ${yen(l.addition)}円`,
      ),
    ...(lines.length > 1 ? [`1㎡当たり ${yen(perSqm)}円`] : []),
  ];
  return { lines, perSqm, front: lines.find((l) => l.role === "front")!, steps };
}
