/**
 * 計算に使う面積の桁（0.01㎡）。地積は登記で0.01㎡まで記録されるので、計算も0.01㎡単位にする。
 * 持分で分けた面積や、小数第3位まで入れた面積は0.01㎡未満を切り捨てる（特例を使う面積の上限・空室の面積と同じ扱い）。
 * 掛け算の誤差（67.745 × 100 = 6774.4999… など）で決め方が揺れないよう、ごく小さな値を足してから切り捨てる
 */
export function area100(sqm: number): number {
  return Math.floor(sqm * 100 + 1e-6);
}

/** 計算に使う面積（㎡）。0.01㎡未満を切り捨てた値 */
export function usedArea(sqm: number): number {
  return area100(sqm) / 100;
}

/** 入れた面積に0.01㎡未満の端数があり、計算では切り捨てた面積を使うか */
export function areaTrimmed(sqm: number | undefined | null): boolean {
  return typeof sqm === "number" && Number.isFinite(sqm) && sqm > 0 && Math.abs(sqm * 100 - area100(sqm)) > 1e-6;
}
