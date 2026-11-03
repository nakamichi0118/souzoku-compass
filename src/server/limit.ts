/**
 * 回数の制限（簡易）。同じ相手からの呼び出しを、決まった時間あたりの回数までに抑える。
 * Cloud Run の1つのインスタンスの中だけで数える（厳密ではないが、総当たりや使いすぎを防ぐには足りる）。
 */
const buckets = new Map<string, { n: number; until: number }>();
const MAX_KEYS = 10_000;

/** 呼び出しを1回数え、上限を超えたら true */
export function overLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > MAX_KEYS) for (const [k, b] of buckets) if (b.until < now) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || b.until < now) {
    buckets.set(key, { n: 1, until: now + windowMs });
    return false;
  }
  b.n += 1;
  return b.n > max;
}

export const resetLimit = (key: string) => buckets.delete(key);
