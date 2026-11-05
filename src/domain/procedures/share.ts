/**
 * 聞き取りの答えを URL に入れられる短い文字列にする（カレンダーの購読 URL 用）。
 * サーバーには答えを保存しない。購読 URL を開いた Google などが、そのつど手続きリストを作り直す。
 *
 * 画面と同じ手続きを載せるため、財産を評価した計算結果による判定（$v）と、「不要」にした手続き（$x）も入れられる。
 * 聞き取りの項目と名前が重ならないよう $ を付ける。$v・$x のない古い URL もそのまま読める。
 */
import { blankInterview, type Interview, type Verdict } from "./interview";

const toB64Url = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64Url = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

const VERDICTS: readonly Verdict[] = ["none", "borderline", "relief", "likely"];
const isVerdict = (v: unknown): v is Verdict => typeof v === "string" && (VERDICTS as readonly string[]).includes(v);
/** 手続きの id（rules.ts）の形。長さと件数にも上限を設ける */
const TASK_ID = /^[a-z0-9-]{1,40}$/;
const MAX_SKIP = 64;

export interface FeedExtras {
  /** 相続税申告の画面で評価した結果による判定（なければ聞き取りの目安で判定する） */
  verdict?: Verdict;
  /** 「不要」にした手続きの id（カレンダーに載せない） */
  skip?: string[];
}

export interface Feed {
  iv: Interview;
  verdict?: Verdict;
  skip: string[];
}

/** 既定値と同じ項目は省いて短くする。名前と住所は入れない */
export function encodeInterview(iv: Interview, extra: FeedExtras = {}): string {
  const base = blankInterview() as unknown as Record<string, unknown>;
  const diff: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(iv)) if (k !== "decedentName" && k !== "address" && k !== "zip" && k !== "myRelation" && base[k] !== v) diff[k] = v;
  if (extra.verdict && isVerdict(extra.verdict)) diff.$v = extra.verdict;
  const skip = [...new Set(extra.skip ?? [])].filter((id) => TASK_ID.test(id)).slice(0, MAX_SKIP);
  if (skip.length) diff.$x = skip;
  return toB64Url(JSON.stringify(diff));
}

/** 購読 URL の文字列から、聞き取りの答え・判定・不要にした手続きを取り出す。読めなければ null */
export function decodeFeed(s: string): Feed | null {
  try {
    const obj = JSON.parse(fromB64Url(s));
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
    const iv = blankInterview() as unknown as Record<string, unknown>;
    let verdict: Verdict | undefined;
    let skip: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (k === "$v") {
        if (isVerdict(v)) verdict = v;
        continue;
      }
      if (k === "$x") {
        if (Array.isArray(v)) skip = [...new Set(v.filter((id): id is string => typeof id === "string" && TASK_ID.test(id)))].slice(0, MAX_SKIP);
        continue;
      }
      if (!(k in iv) || typeof v !== typeof iv[k]) continue;
      if (typeof v === "number") {
        if (!Number.isFinite(v) || v < 0) continue;
        iv[k] = Math.min(Math.floor(v), typeof iv[k] === "number" && k.match(/^(children|grandchildrenOfPredeceased|parentsAlive|siblings)$/) ? 20 : 1e13);
      } else if (typeof v === "string") {
        iv[k] = v.slice(0, 40);
      } else iv[k] = v;
    }
    return { iv: iv as unknown as Interview, verdict, skip };
  } catch {
    return null;
  }
}

/** 聞き取りの答えだけを取り出す（判定・不要の手続きは無視する） */
export function decodeInterview(s: string): Interview | null {
  return decodeFeed(s)?.iv ?? null;
}
