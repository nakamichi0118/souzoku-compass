/**
 * 地図で土地を評価する画面で使う、画面を持たない決まった処理。
 *
 * 路線価の読み取りは、読んだときの条件（場所・路線価図・ページ・重ね方・読んだ道路の位置）と一緒に覚える。
 * 条件が変わったら、前の読み取りは使わずに読み直す。本人が入れた・選んだ路線価は、自動の読み取りでは上書きしない。
 */
import type { Frame } from "@/domain/geo/frame";
import type { LatLng } from "@/domain/geo/lot";
import type { Frontage } from "@/domain/geo/polygon";
import type { LandMethod } from "@/domain/types";
import type { Edge, RoadInput } from "@/domain/valuation/roads";
import { parseRouteNotation } from "@/domain/valuation/rosenka";
import type { GeoPair } from "./MapView";

export interface ReadCandidate {
  notation: string;
  where: string;
  distanceToMarker: string;
}

/** 接している道路（まとまり）ごとの路線価の欄の状態 */
export interface RoadNotes {
  /** 欄に入っている路線価の表記（例：420D） */
  text: Record<string, string>;
  /** 本人が入れた・選んだもの、前に確かめて保存したもの（自動の読み取りでは上書きしない） */
  mine: Record<string, true>;
  /** コンパスくんが読んだときの条件と、読み取った候補 */
  read: Record<string, { ctx: string; candidates: ReadCandidate[] }>;
}

export const EMPTY_NOTES: RoadNotes = { text: {}, mine: {}, read: {} };

/** 道路のまとまりを見分ける名前（含まれる辺の番号） */
export const keyOf = (f: Pick<Frontage, "edges">) => f.edges.join("-");

/** 路線価図を読む条件：場所・図（URL、なければ読み込んだ画像）・ページ・重ね方（基準点が2つ以上ならそれ、なければ枠） */
export function readingContext(o: { property?: LatLng; sheetId: string; page: number; pairs: GeoPair[]; frame: Frame | null }): string {
  return JSON.stringify([o.property ?? null, o.sheetId, o.page, o.pairs.length >= 2 ? o.pairs : o.frame]);
}

/** 道路のまとまりごとの条件。読み取りに使う道路の上の点（約1m単位）も含める */
export const frontageContext = (ctx: string, f: Pick<Frontage, "outside">) => `${ctx}|${f.outside[0].toFixed(5)},${f.outside[1].toFixed(5)}`;

/** 欄に出す路線価：いまの条件で読んだもの、または本人が入れたものだけ */
export function noteFor(n: RoadNotes, key: string, ctx: string): string {
  return n.mine[key] || n.read[key]?.ctx === ctx ? (n.text[key] ?? "") : "";
}

/** いまの条件で読んだ候補（前の条件の候補は出さない） */
export function candidatesFor(n: RoadNotes, key: string, ctx: string): ReadCandidate[] | undefined {
  const r = n.read[key];
  return r && r.ctx === ctx ? r.candidates : undefined;
}

/** まだいまの条件で読んでいない */
export const needsRead = (n: RoadNotes, key: string, ctx: string) => n.read[key]?.ctx !== ctx;

/** 本人が欄に入れた・候補から選んだ。空にしたときは、また読み取りの結果を入れられるようにする */
export function typeNote(n: RoadNotes, key: string, value: string): RoadNotes {
  const mine = { ...n.mine };
  if (value.trim()) mine[key] = true;
  else delete mine[key];
  return { ...n, text: { ...n.text, [key]: value }, mine };
}

/**
 * 読み取りの結果を、いまの状態に重ねる（読んでいる間に変わったものも残す）。
 * force（本人が読み直しを頼んだ）なら、本人が入れたものも読み取った路線価に置き換える。
 * 読み取れなかった道路（図の外など）は results に入れない。読んだことにせず、次にまた読む。
 */
export function mergeReadings(n: RoadNotes, results: { key: string; ctx: string; candidates: ReadCandidate[] }[], force: boolean): RoadNotes {
  const next: RoadNotes = { text: { ...n.text }, mine: { ...n.mine }, read: { ...n.read } };
  for (const r of results) {
    next.read[r.key] = { ctx: r.ctx, candidates: r.candidates };
    const first = r.candidates.find((c) => parseRouteNotation(c.notation))?.notation;
    if (force) {
      if (first) {
        next.text[r.key] = first;
        delete next.mine[r.key];
      }
    } else if (!n.mine[r.key]) next.text[r.key] = first ?? "";
  }
  return next;
}

/**
 * 保存してある評価の道路（辺の番号ごとの路線価）を、開き直した土地の形の道路のまとまりに戻す。
 * 本人が確かめたものなので、自動では読み直さず、上書きもしない。
 */
export function notesFromSaved(roads: RoadInput[], frontages: Frontage[], classes: (Edge | null)[], ctxOf: (f: Frontage) => string): RoadNotes {
  const out: RoadNotes = { text: {}, mine: {}, read: {} };
  frontages.forEach((f, i) => {
    const e = classes[i];
    if (e === null || e === undefined) return;
    const r = roads.find((x) => x.edge === e);
    const text = r?.notation?.trim() || (r && r.price > 0 && r.price % 1000 === 0 ? String(r.price / 1000) : "");
    if (!text) return;
    const k = keyOf(f);
    out.text[k] = text;
    out.mine[k] = true;
    out.read[k] = { ctx: ctxOf(f), candidates: [] };
  });
  return out;
}

/**
 * 保存してある評価の方法から、路線価地域か倍率地域かが決まっているか。
 * 書類から読んだだけの仮の方法（路線価も倍率も0）や、金額を直接入れた方法なら null（場所から調べて決める）。
 */
export function savedRoute(m: LandMethod): "rosenka" | "ratio" | null {
  if (m.type === "multiplier") return m.multiplier > 0 ? "ratio" : null;
  if (m.type === "rosenka") return m.shape?.length || m.lot || m.routePrice > 0 || m.roads?.some((r) => r.price > 0) ? "rosenka" : null;
  return null;
}

// ---------------------------------------------------------------- 路線価図の縮尺

export const SCALES = [500, 600, 1000, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000];
export const nearestScale = (sc: number) => SCALES.reduce((a, b) => (Math.abs(b - sc) < Math.abs(a - sc) ? b : a));
/** 微調整で動かせる幅（基準の縮尺の何倍まで） */
export const FINE_MIN = 0.8;
export const FINE_MAX = 1.25;

/**
 * 微調整の基準の縮尺。選んだ縮尺（base）をそのまま使い、縮尺が微調整の幅から外れたとき
 * （自動で合わせた新しい枠が来たときなど）だけ、いちばん近い縮尺に直す。
 */
export function fineBase(base: number | null, scale: number): number {
  return base && scale >= base * FINE_MIN - 1e-9 && scale <= base * FINE_MAX + 1e-9 ? base : nearestScale(scale);
}

// ---------------------------------------------------------------- 地図の操作

/**
 * 指（またはペン）で触ったときに出る右クリックの代わりの操作か。
 * スマートフォンの長押しでは、Leaflet やブラウザが右クリックと同じ操作を出すため、それと見分ける。
 */
export function fromTouch(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const o = e as { _simulated?: boolean; pointerType?: string; sourceCapabilities?: { firesTouchEvents?: boolean } | null };
  return !!o._simulated || o.pointerType === "touch" || o.pointerType === "pen" || !!o.sourceCapabilities?.firesTouchEvents;
}
