/**
 * 人に貸している土地・建物、人の土地を借りている場合の評価（財産評価基本通達25・26・27・93）。
 *
 * - 貸家建付地（アパート・貸家の敷地）：自用地の評価額 ×（1 − 借地権割合 × 借家権割合 × 賃貸割合）（通達26）
 * - 貸宅地（人に貸して、相手が建物を建てている土地）：自用地の評価額 ×（1 − 借地権割合）（通達25(1)）
 * - 借地権（人の土地を借りて建物を建てている権利）：自用地の評価額 × 借地権割合（通達27）
 * - 貸家（人に貸している家屋）：固定資産税評価額 ×（1 − 借家権割合 × 賃貸割合）（通達93）
 *
 * 借家権割合は全国一律30%（通達94。国税庁の路線価図・評価倍率表に記載）。
 * 借地権割合は、路線価図では路線価の数字のあとの記号（A〜G）、倍率地域では評価倍率表の「借地権割合」の欄で決まる。
 * 割合は小数4桁までの値として 1/10000 単位の整数にし、BigInt で掛けてから最後に1円未満を切り捨てる。
 * 借地権の取引の慣行がない地域（通達27ただし書。借地権は評価せず、貸宅地・貸家建付地は借地権割合を20%として計算する）は自動では判定しない。
 * 出典：https://www.nta.go.jp/law/tsutatsu/kihon/sisan/hyoka_new/02/05.htm（通達25・26）、
 *       財産評価基本通達27（借地権）・93（貸家）・94（借家権）、国税庁「路線価図の説明」（借地権割合の記号）
 */

/** 路線価図の借地権割合の記号 */
export type LeaseLetter = "A" | "B" | "C" | "D" | "E" | "F" | "G";

/** 記号ごとの借地権割合（路線価図の説明） */
export const LEASE_RATIO_BY_LETTER: Record<LeaseLetter, number> = { A: 0.9, B: 0.8, C: 0.7, D: 0.6, E: 0.5, F: 0.4, G: 0.3 };

/** 選択肢として並べる順（A＝90% … G＝30%） */
export const LEASE_LETTERS = Object.keys(LEASE_RATIO_BY_LETTER) as LeaseLetter[];

/** 借家権割合（全国一律30%） */
export const RENTAL_RIGHT_RATIO = 0.3;

/**
 * 路線価図の表記（例：「420D」「１，２５０Ｃ」）の末尾の記号（A〜G）を読む。
 * 数字だけの表記や読めない表記は undefined
 */
export function leaseLetterOf(notation: string | undefined | null): LeaseLetter | undefined {
  if (!notation) return undefined;
  const s = notation.normalize("NFKC").replace(/[,\s]/g, "").toUpperCase();
  const m = s.match(/^\d*([A-G])$/);
  return m ? (m[1] as LeaseLetter) : undefined;
}

/** 路線価図の表記から借地権割合を読む（例：「420D」→ 0.6）。記号がなければ undefined */
export function leaseRatioOf(notation: string | undefined | null): number | undefined {
  const l = leaseLetterOf(notation);
  return l ? LEASE_RATIO_BY_LETTER[l] : undefined;
}

/** 小数4桁までの割合を 1/10000 単位の整数にする（0.6 → 6000） */
export const ratio4 = (x: number) => Math.round(x * 10000);

/** 割合の表示（0.6 → "0.6"、0.85 → "0.85"） */
export const ratioText = (x4: number) => String(x4 / 10000);

/** 金額 × 分子 ÷ 分母（1円未満切捨て）。ありえない大きさの入力でも止まらないよう、安全な整数でなければ通常の計算にする */
function mulFrac(yen: number, num: bigint, den: bigint): number {
  const y = Math.floor(yen);
  if (!Number.isSafeInteger(y)) return Math.floor((y * Number(num)) / Number(den));
  return Number((BigInt(y) * num) / den);
}

const T4 = 10000n;

/**
 * 貸家建付地：自用地 ×（1 − 借地権割合 × 0.3 × 賃貸割合）。
 * lease4・rent4 は 1/10000 単位の整数。分母は 10000 × 10 × 10000
 */
export function rentedHouseLand(selfUse: number, lease4: number, rent4: number): number {
  const den = T4 * 10n * T4;
  return mulFrac(selfUse, den - BigInt(lease4) * 3n * BigInt(rent4), den);
}

/** 貸宅地：自用地 ×（1 − 借地権割合） */
export function leasedLand(selfUse: number, lease4: number): number {
  return mulFrac(selfUse, T4 - BigInt(lease4), T4);
}

/** 借地権：自用地 × 借地権割合 */
export function leaseholdRight(selfUse: number, lease4: number): number {
  return mulFrac(selfUse, BigInt(lease4), T4);
}

/** 貸家：自用家屋の評価額 ×（1 − 0.3 × 賃貸割合）。分母は 10 × 10000 */
export function rentedBuilding(selfUse: number, rent4: number): number {
  const den = 10n * T4;
  return mulFrac(selfUse, den - 3n * BigInt(rent4), den);
}

/** 賃貸割合が 0より大きく1以下か（1/10000 単位） */
export const validRent4 = (r4: number) => Number.isFinite(r4) && r4 > 0 && r4 <= 10000;
/** 借地権割合が 0より大きく1未満か（1/10000 単位） */
export const validLease4 = (l4: number) => Number.isFinite(l4) && l4 > 0 && l4 < 10000;

/** 賃貸割合の入力が正しくないときの案内 */
export const RENT_RATIO_MESSAGE =
  "賃貸割合が正しくありません。賃貸割合は「貸している部屋の床面積 ÷ 貸せる部屋全部の床面積」で、0より大きく1以下の数です（全部貸していれば1）。";
