/**
 * 日本郵便の郵便番号データ（住所の郵便番号 CSV）を、郵便番号 → 住所の表にする。
 *
 * CSV の列（日本郵便「郵便番号データの説明」による）：
 *   0 全国地方公共団体コード / 1 旧郵便番号 / 2 郵便番号（7桁） / 3〜5 カナ /
 *   6 都道府県名 / 7 市区町村名 / 8 町域名 / 9〜14 フラグ
 * 町域名が長いときに複数の行に分かれている古い形式（かっこが次の行で閉じる）にも対応する。
 */
import { PREFECTURES } from "@/data/consultFirm";

/** [都道府県の番号（PREFECTURES の位置）, 市区町村, 町域] */
export type ZipRow = [number, string, string];
/** 郵便番号の下4桁 → 候補 */
export type ZipChunk = Record<string, ZipRow[]>;

/** 1行の CSV を列に分ける（"…" で囲まれた値、"" は " 1文字） */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * 町域名を、住所の欄に入れる形にする。
 * - 「以下に掲載がない場合」「〇〇の次に番地がくる場合」「〇〇一円」は町域なし（市区町村まで）
 * - かっこ書き（丁目・番地の範囲、ビルの階など）は外す
 */
export function cleanTown(town: string): string {
  const t = town.trim();
  if (t === "以下に掲載がない場合" || t.endsWith("の次に番地がくる場合")) return "";
  // 「一円」という町名もあるので、それだけのときは残す
  if (t.length > 2 && t.endsWith("一円")) return "";
  return t.replace(/[（(].*$/, "").trim();
}

const PREF_INDEX = new Map<string, number>(PREFECTURES.map((p, i) => [p, i]));

/** CSV 全体から、郵便番号の上3桁ごとの表を作る */
export function buildZipIndex(csv: string): Map<string, ZipChunk> {
  const chunks = new Map<string, ZipChunk>();
  const seen = new Set<string>();
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/);
  let pending: string[] | null = null;
  const add = (cols: string[]) => {
    const zip = cols[2].trim();
    if (!/^\d{7}$/.test(zip)) return;
    const pref = PREF_INDEX.get(cols[6].trim());
    if (pref == null) throw new Error(`知らない都道府県名：${cols[6]}`);
    const row: ZipRow = [pref, cols[7].trim(), cleanTown(cols[8])];
    const key = `${zip}|${row.join("|")}`;
    if (seen.has(key)) return;
    seen.add(key);
    const head = zip.slice(0, 3);
    const chunk = chunks.get(head) ?? {};
    (chunk[zip.slice(3)] ??= []).push(row);
    chunks.set(head, chunk);
  };
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (cols.length < 9) continue;
    // 古い形式：町域名のかっこが閉じないまま次の行へ続く
    if (pending) {
      if (cols[2] === pending[2]) {
        pending[8] += cols[8];
        if (!hasOpenParen(pending[8])) {
          add(pending);
          pending = null;
        }
        continue;
      }
      add(pending);
      pending = null;
    }
    if (hasOpenParen(cols[8])) pending = cols;
    else add(cols);
  }
  if (pending) add(pending);
  return chunks;
}

const hasOpenParen = (s: string) => (s.match(/[（(]/g)?.length ?? 0) > (s.match(/[）)]/g)?.length ?? 0);
