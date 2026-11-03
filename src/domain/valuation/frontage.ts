/**
 * 間口狭小補正率表（付表6）と奥行長大補正率表（付表7）。財産評価基本通達20-4。
 * 間口が狭い土地や、間口に比べて奥行が長い土地は使いにくいため、1㎡当たりの価額に補正率を掛けて下げる。
 * 出典：https://www.nta.go.jp/law/tsutatsu/kihon/sisan/hyoka_new/02/07.htm（付表6・付表7）
 *       https://www.nta.go.jp/law/tsutatsu/kihon/sisan/hyoka_new/02/03.htm（通達20-4）
 * 国税庁の表で空欄（直上と同じ値）の箇所は値を補って記載している。率は 1/100 単位の整数。
 * 距離は0.01m単位の整数にしてから比べ、浮動小数点の誤差で区分がずれないようにする。
 */
import { DISTRICTS, type District } from "./depth";

// 付表6：[間口距離の下限(m), ビル街, 高度商業, 繁華街, 普通商業・併用住宅, 普通住宅, 中小工場, 大工場]
// null は表に定めがない（ビル街地区の間口8m未満は「－」）
const FRONTAGE_TABLE: readonly (readonly (number | null)[])[] = [
  [0, null, 85, 90, 90, 90, 80, 80],
  [4, null, 94, 100, 97, 94, 85, 85],
  [6, null, 97, 100, 100, 97, 90, 90],
  [8, 95, 100, 100, 100, 100, 95, 95],
  [10, 97, 100, 100, 100, 100, 100, 97],
  [16, 98, 100, 100, 100, 100, 100, 98],
  [22, 99, 100, 100, 100, 100, 100, 99],
  [28, 100, 100, 100, 100, 100, 100, 100],
];

// 付表7：[奥行距離÷間口距離の下限, ビル街, 高度商業, 繁華街, 普通商業・併用住宅, 普通住宅, 中小工場, 大工場]
// 国税庁の表では高度商業・繁華街・普通商業・併用住宅地区が1つの欄。2未満は表になく補正なし（1.00）
const LONG_TABLE: readonly (readonly number[])[] = [
  [0, 100, 100, 100, 100, 100, 100, 100],
  [2, 100, 100, 100, 100, 98, 100, 100],
  [3, 100, 99, 99, 99, 96, 99, 100],
  [4, 100, 98, 98, 98, 94, 98, 100],
  [5, 100, 96, 96, 96, 92, 96, 100],
  [6, 100, 94, 94, 94, 90, 94, 100],
  [7, 100, 92, 92, 92, 90, 92, 100],
  [8, 100, 90, 90, 90, 90, 90, 100],
];

/** m を 0.01m 単位の整数にする */
const cm = (m: number) => Math.round(m * 100);

/**
 * 間口狭小補正率（1/100 単位の整数）。表に定めがない場合（ビル街地区で間口8m未満）は null
 */
export function frontageRate100(district: District, frontageM: number): number | null {
  if (!(frontageM > 0)) throw new Error("間口距離は正の数で入力してください");
  const col = DISTRICTS.indexOf(district) + 1;
  const f = cm(frontageM);
  let row = FRONTAGE_TABLE[0];
  for (const r of FRONTAGE_TABLE) if (f >= (r[0] as number) * 100) row = r;
  return row[col];
}

/** 奥行長大補正率（1/100 単位の整数）。奥行距離 ÷ 間口距離 の区分で決まる */
export function longRate100(district: District, depthM: number, frontageM: number): number {
  if (!(frontageM > 0) || !(depthM > 0)) throw new Error("奥行距離と間口距離は正の数で入力してください");
  const col = DISTRICTS.indexOf(district) + 1;
  const d = cm(depthM);
  const f = cm(frontageM);
  let row = LONG_TABLE[0];
  // 奥行 ÷ 間口 ≧ 下限 を、割り算をせず 奥行 ≧ 下限 × 間口 で比べる
  for (const r of LONG_TABLE) if (d >= r[0] * f) row = r;
  return row[col];
}

/** 間口狭小補正率（例 0.94）。表に定めがない場合は null */
export function frontageRate(district: District, frontageM: number): number | null {
  const r = frontageRate100(district, frontageM);
  return r == null ? null : r / 100;
}

/** 奥行長大補正率（例 0.96） */
export function longRate(district: District, depthM: number, frontageM: number): number {
  return longRate100(district, depthM, frontageM) / 100;
}
