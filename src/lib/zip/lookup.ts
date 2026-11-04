/**
 * 郵便番号から住所を引く（画面用）。表は public/zip/{上3桁}.json（scripts/zip/build.ts が作る）。
 * サーバーには上3桁の表を取りに行くだけで、入れた郵便番号や住所は送らない。
 */
import { PREFECTURES } from "@/data/consultFirm";
import type { ZipChunk } from "./parse";

export interface ZipHit {
  pref: string;
  city: string;
  town: string;
  /** 住所の欄に入れる形（都道府県＋市区町村＋町域） */
  address: string;
}

/** 全角の数字・ハイフンを半角にし、数字とハイフン以外を外す。7桁そろえば 123-4567 の形にする */
export function normalizeZip(input: string): string {
  const half = input.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[－ー‐―−]/g, "-");
  const kept = half.replace(/[^\d-]/g, "");
  const digits = kept.replace(/-/g, "");
  if (digits.length === 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return kept.slice(0, 8);
}

export const zipDigits = (zip: string) => zip.replace(/\D/g, "");

const cache = new Map<string, Promise<ZipChunk | null>>();

/**
 * 7桁の郵便番号の候補を返す。見つからなければ空の配列、表を取れなかったときは null。
 * 上3桁の表は一度取ったら覚えておく（取れなかったときは次にもう一度試す）。
 */
export async function lookupZip(zip: string, fetcher: typeof fetch = fetch): Promise<ZipHit[] | null> {
  const d = zipDigits(zip);
  if (d.length !== 7) return [];
  const head = d.slice(0, 3);
  let p = cache.get(head);
  if (!p) {
    p = fetcher(`/zip/${head}.json`)
      .then((r) => (r.status === 404 ? {} : r.ok ? (r.json() as Promise<ZipChunk>) : null))
      .catch(() => null);
    cache.set(head, p);
  }
  const chunk = await p;
  if (!chunk) {
    cache.delete(head);
    return null;
  }
  return (chunk[d.slice(3)] ?? []).map(([i, city, town]) => {
    const pref = PREFECTURES[i] ?? "";
    return { pref, city, town, address: `${pref}${city}${town}` };
  });
}

/** テスト用：覚えた表を消す */
export const clearZipCache = () => cache.clear();

/**
 * 見つかった住所を、いま入っている住所にどう入れるか。
 * - 空なら入れる
 * - 前に自動で入れた部分から始まっていれば、その部分だけ入れ替える（あとに足した番地は残す）
 * - 見つかった住所から始まっていれば、そのまま
 * - 自分で入れた別の住所なら、勝手に書き換えない（null。画面でボタンを出す）
 */
export function nextAddress(current: string, found: string, lastFilled: string | null): string | null {
  const cur = current.trim();
  if (!cur) return found;
  if (lastFilled && cur.startsWith(lastFilled)) return found + cur.slice(lastFilled.length);
  if (cur.startsWith(found)) return current;
  return null;
}
