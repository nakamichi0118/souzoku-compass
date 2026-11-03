/**
 * 回数の制限（簡易）。同じ相手からの呼び出しを、決まった時間あたりの回数までに抑える。
 * Cloud Run の1つのインスタンスの中だけで数える（厳密ではないが、総当たりや使いすぎを防ぐには足りる）。
 */
const buckets = new Map<string, { n: number; until: number }>();
export const MAX_KEYS = 10_000;
/** これだけ呼ばれるごとに、期限の切れた記録を掃除する */
const SWEEP_EVERY = 500;
/** キーが長すぎると記録が大きくなるため、長い部分は切る（呼び出し側でも長さを抑えること） */
const MAX_KEY_LENGTH = 300;
let calls = 0;

function sweep(now: number) {
  for (const [k, b] of buckets) if (b.until < now) buckets.delete(k);
}

/** 記録が上限に近づいたら、期限切れを消し、それでも多ければ古いものから1割ほど消す */
function makeRoom(now: number) {
  if (buckets.size < MAX_KEYS) return;
  sweep(now);
  const target = Math.floor(MAX_KEYS * 0.9);
  for (const k of buckets.keys()) {
    if (buckets.size <= target) break;
    buckets.delete(k);
  }
}

/** 呼び出しを1回数え、上限を超えたら true */
export function overLimit(rawKey: string, max: number, windowMs: number): boolean {
  const key = rawKey.slice(0, MAX_KEY_LENGTH);
  const now = Date.now();
  if (++calls % SWEEP_EVERY === 0) sweep(now);
  const b = buckets.get(key);
  if (!b || b.until < now) {
    // 入れ直して、Map の順番（古いものから）を保つ
    if (b) buckets.delete(key);
    else makeRoom(now);
    buckets.set(key, { n: 1, until: now + windowMs });
    return false;
  }
  b.n += 1;
  return b.n > max;
}

export const resetLimit = (key: string) => buckets.delete(key.slice(0, MAX_KEY_LENGTH));

/** テスト用：いま記録しているキーの数 */
export const limitKeyCount = () => buckets.size;
