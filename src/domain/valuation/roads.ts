/**
 * 道路に面する宅地の1㎡当たりの価額（財産評価基本通達15〜18・20-4）。
 *
 * - 正面路線：路線価 × 奥行価格補正率 が最も高い道路（通達16(1)）。同じ額なら、道路に接する距離（間口）の長い方
 *   （国税庁 質疑応答事例「正面路線の判定(1)」）。間口が分からない・同じなら路線価の高い方、さらに同じなら先に入力した方
 * - 側方路線（正面の隣の辺の道路）：その路線価を正面路線とみなして奥行価格補正をした額 × 側方路線影響加算率（付表2）
 * - 裏面路線（正面の向かいの辺の道路）：同じく × 二方路線影響加算率（付表3）
 * - 三方・四方は上を併用（通達18）
 * - 間口狭小・奥行長大（通達20-4）：正面の道路の間口距離が入っていれば、ここまでの1㎡当たりの価額に
 *   間口狭小補正率（付表6）× 奥行長大補正率（付表7。奥行距離 ÷ 間口距離 で決まる）を掛ける（1円未満切捨て）。
 *   ビル街地区で間口8m未満は表に定めがないため 1.00 とする。間口距離が入っていなければ補正しない。
 *   不整形地は20-4の対象外（不整形地補正率に間口狭小補正率を含める。付表5（注）3）なので、irregular のときは補正しない。
 *   irregular は、税理士に確認した不整形地補正率（1未満）を使うときだけ渡す（1＝減額なしなら間口狭小補正率も1のはずなので、20-4をする）
 *
 * 安全側（高め）に評価する：角地と準角地の区別は角地の加算率を使い、側方路線に一部しか接しない場合の
 * 按分や、不整形地などの減額の補正はしない。減額できる場合は税理士への相談を案内する。
 * 出典：https://www.nta.go.jp/law/tsutatsu/kihon/sisan/hyoka_new/02/02.htm（通達15〜18）
 *       https://www.nta.go.jp/law/tsutatsu/kihon/sisan/hyoka_new/02/03.htm（通達20-4）
 *       https://www.nta.go.jp/law/tsutatsu/kihon/sisan/hyoka_new/02/07.htm（付表1〜3・5・6・7）
 *       https://www.nta.go.jp/law/shitsugi/hyoka/03/01.htm（正面路線の判定(1)）
 */
import { type District, depthCorrection } from "./depth";
import { frontageRate100, longRate100 } from "./frontage";

/** 土地の辺の番号。0の向かいが2、1の向かいが3（四角形の辺を順に数えたもの） */
export type Edge = 0 | 1 | 2 | 3;

export interface RoadInput {
  edge: Edge;
  /** 1㎡当たりの路線価（円） */
  price: number;
  /** その道路から見た奥行距離（m） */
  depth: number;
  /** 路線価図の表記（例：420D）。末尾の記号（A〜G）が借地権割合 */
  notation?: string;
  /** 間口距離（m）。正面の道路の間口で間口狭小補正・奥行長大補正（付表6・7）をする。未入力なら補正しない */
  frontage?: number;
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
  /** 1㎡当たりの価額（円）。間口狭小・奥行長大の補正をした後 */
  perSqm: number;
  /** 間口狭小・奥行長大の補正をする前の1㎡当たりの価額（円）。側方・二方の加算後 */
  basePerSqm: number;
  /** 間口狭小補正率（正面の道路に間口距離が入っているときだけ。ビル街地区で間口8m未満は1） */
  frontageRate?: number;
  /** 奥行長大補正率（正面の道路に間口距離が入っているときだけ） */
  longRate?: number;
  front: RoadLine;
  steps: string[];
}

/** 間口距離が入っているか（0より大きい数） */
const hasFrontage = (r: RoadInput): r is RoadInput & { frontage: number } => r.frontage != null && r.frontage > 0;

/**
 * b を a より正面路線として優先するか。奥行価格補正後の価額が高い方。同額なら、両方の間口が分かっていれば間口の長い方
 * （正面路線の判定(1)）、それでも決まらなければ路線価の高い方。すべて同じなら先に入力した方（a）のまま
 */
function preferAsFront(a: { corrected: number; price: number } & RoadInput, b: { corrected: number; price: number } & RoadInput): boolean {
  if (b.corrected !== a.corrected) return b.corrected > a.corrected;
  if (hasFrontage(a) && hasFrontage(b) && b.frontage !== a.frontage) return b.frontage > a.frontage;
  return b.price > a.price;
}

export interface EvaluateRoadsOptions {
  /**
   * 不整形地（形がいびつな土地）で、税理士に確認した1未満の不整形地補正率を使う。間口狭小・奥行長大の補正（通達20-4）をしない：
   * 20-4 は不整形地を除き、不整形地補正率に間口狭小補正率を含める（付表5（注）3）ため。
   * 不整形地補正率が1（減額なし）のときは渡さない（不整形地補正率は間口狭小補正率を超えないので、1なら間口狭小補正率も1。20-4をふつうどおりする）
   */
  irregular?: boolean;
}

export function evaluateRoads(district: District, roads: RoadInput[], opts: EvaluateRoadsOptions = {}): MultiRoadResult | null {
  const usable = roads.filter((r) => r.price > 0 && r.depth > 0);
  if (usable.length === 0) return null;
  const withRate = usable.map((r) => {
    const depthRate = depthCorrection(district, r.depth);
    return { ...r, depthRate, corrected: Math.floor((r.price * milli(depthRate)) / 1000) };
  });
  // 正面路線：奥行価格補正後の価額が最も高い道路（同額なら間口の長い方 → 路線価の高い方 → 先に入力した方）
  const front = withRate.reduce((a, b) => (preferAsFront(a, b) ? b : a));
  const lines: RoadLine[] = withRate.map((r) => {
    if (r === front) return { ...r, role: "front", addRate: 0, addition: 0 };
    const back = r.edge === (((front.edge + 2) % 4) as Edge);
    const addRate = back ? backRate(district) : sideRate(district);
    return { ...r, role: back ? "back" : "side", addRate, addition: Math.floor((r.corrected * milli(addRate)) / 1000) };
  });
  const basePerSqm = lines.reduce((s, l) => s + (l.role === "front" ? l.corrected : l.addition), 0);
  const yen = (n: number) => n.toLocaleString("ja-JP");
  const name = { front: "正面", side: "側方", back: "裏面" } as const;
  lines.sort((a, b) => ["front", "side", "back"].indexOf(a.role) - ["front", "side", "back"].indexOf(b.role));
  // 側方路線は2本ありうる。同じ路線価・奥行でも説明の文が同じにならないよう「1本目」「2本目」と付ける
  const sides = lines.filter((l) => l.role === "side");
  const label = (l: RoadLine) => (l.role === "side" && sides.length > 1 ? `側方路線（${sides.indexOf(l) + 1}本目）` : `${name[l.role]}路線`);
  const steps = [
    ...lines.map((l) =>
      l.role === "front"
        ? `正面路線 ${yen(l.price)}円 × 奥行価格補正率 ${l.depthRate}（奥行${l.depth}m） = ${yen(l.corrected)}円`
        : `${label(l)} ${yen(l.price)}円 × 奥行価格補正率 ${l.depthRate} × ${l.role === "side" ? "側方路線影響加算率" : "二方路線影響加算率"} ${l.addRate} = ${yen(l.addition)}円`,
    ),
    ...(lines.length > 1 ? [`1㎡当たり ${yen(basePerSqm)}円`] : []),
  ];
  const frontLine = lines.find((l) => l.role === "front")!;
  // 間口狭小・奥行長大の補正（通達20-4）。正面の道路の間口距離が入っているときだけ
  const fr = frontLine.frontage;
  if (!(fr != null && fr > 0) || opts.irregular) return { lines, perSqm: basePerSqm, basePerSqm, front: frontLine, steps };
  const table = frontageRate100(district, fr);
  const f100 = table ?? 100; // ビル街地区で間口8m未満は表に定めがないため補正しない
  const l100 = longRate100(district, frontLine.depth, fr);
  // 2つの率を掛けた値（小数4桁）で1回だけ1円未満を切り捨てる。ありえない大きさの入力でも止まらないよう、安全な整数でなければ通常の計算にする
  const perSqm = Number.isSafeInteger(basePerSqm)
    ? Number((BigInt(basePerSqm) * BigInt(f100) * BigInt(l100)) / 10000n)
    : Math.floor((basePerSqm * f100 * l100) / 10000);
  const rate = (x: number) => (x / 100).toFixed(2);
  steps.push(
    ...(table == null ? [`ビル街地区で間口${fr}m（8m未満）は間口狭小補正率表に定めがないため、間口狭小補正率を1.00とします`] : []),
    `間口狭小補正率 ${rate(f100)}（間口${fr}m）× 奥行長大補正率 ${rate(l100)}（奥行${frontLine.depth}m ÷ 間口${fr}m）：${yen(basePerSqm)}円 × ${rate(f100)} × ${rate(l100)} = ${yen(perSqm)}円`,
  );
  return { lines, perSqm, basePerSqm, frontageRate: f100 / 100, longRate: l100 / 100, front: frontLine, steps };
}
