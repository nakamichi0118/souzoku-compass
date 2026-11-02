/**
 * 聞き取りの答えを URL に入れられる短い文字列にする（カレンダーの購読 URL 用）。
 * サーバーには答えを保存しない。購読 URL を開いた Google などが、そのつど手続きリストを作り直す。
 */
import { blankInterview, type Interview } from "./interview";

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

/** 既定値と同じ項目は省いて短くする。名前は入れない */
export function encodeInterview(iv: Interview): string {
  const base = blankInterview() as unknown as Record<string, unknown>;
  const diff: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(iv)) if (k !== "decedentName" && base[k] !== v) diff[k] = v;
  return toB64Url(JSON.stringify(diff));
}

export function decodeInterview(s: string): Interview | null {
  try {
    const obj = JSON.parse(fromB64Url(s));
    if (!obj || typeof obj !== "object") return null;
    const iv = blankInterview() as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (!(k in iv) || typeof v !== typeof iv[k]) continue;
      if (typeof v === "number") {
        if (!Number.isFinite(v) || v < 0) continue;
        iv[k] = Math.min(Math.floor(v), typeof iv[k] === "number" && k.match(/^(children|grandchildrenOfPredeceased|parentsAlive|siblings)$/) ? 20 : 1e13);
      } else if (typeof v === "string") {
        iv[k] = v.slice(0, 40);
      } else iv[k] = v;
    }
    return iv as unknown as Interview;
  } catch {
    return null;
  }
}
