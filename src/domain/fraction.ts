/**
 * 法定相続分などの分数を誤差なく扱うための有理数。
 * 金額計算は円単位の整数で行い、端数処理は呼び出し側で明示する。
 */
export interface Fraction {
  readonly n: bigint;
  readonly d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b !== 0n) [a, b] = [b, a % b];
  return a;
}

export function frac(n: number | bigint, d: number | bigint = 1): Fraction {
  let nn = BigInt(n);
  let dd = BigInt(d);
  if (dd === 0n) throw new Error("division by zero");
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  const g = gcd(nn, dd) || 1n;
  return { n: nn / g, d: dd / g };
}

export const ZERO = frac(0);
export const ONE = frac(1);

export const add = (a: Fraction, b: Fraction) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Fraction, b: Fraction) => frac(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Fraction, b: Fraction) => frac(a.n * b.n, a.d * b.d);
export const div = (a: Fraction, b: Fraction) => frac(a.n * b.d, a.d * b.n);
export const eq = (a: Fraction, b: Fraction) => a.n === b.n && a.d === b.d;
export const sum = (xs: Fraction[]) => xs.reduce(add, ZERO);
export const toNumber = (a: Fraction) => Number(a.n) / Number(a.d);
export const toString = (a: Fraction) => (a.d === 1n ? `${a.n}` : `${a.n}/${a.d}`);

/** 金額(円) × 分数 を、指定単位未満切捨てで返す（負数は扱わない） */
export function mulYen(yen: number, f: Fraction, unit = 1): number {
  if (yen < 0) throw new Error("negative amount");
  const raw = (BigInt(Math.trunc(yen)) * f.n) / f.d; // 1円未満切捨て
  const u = BigInt(unit);
  return Number((raw / u) * u);
}
