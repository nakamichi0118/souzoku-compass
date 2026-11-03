/**
 * 路線価図の表記（例：「420D」）の読み方。
 * 数字は1㎡当たりの価額（千円単位）、アルファベットは借地権割合（A=90% … G=30%）。
 * 出典：国税庁「路線価図の説明」
 */
import { LEASE_RATIO_BY_LETTER, type LeaseLetter } from "./lease";

/** 借地権割合の記号と割合（lease.ts と同じ表） */
export const LEASEHOLD_RATIO: Record<string, number> = LEASE_RATIO_BY_LETTER;

export interface RouteNotation {
  /** 1㎡当たりの路線価（円） */
  routePrice: number;
  /** 借地権割合の記号（なければ undefined） */
  letter?: string;
  leaseholdRatio?: number;
}

export function parseRouteNotation(text: string): RouteNotation | null {
  const s = text
    .normalize("NFKC")
    .replace(/[,\s]/g, "")
    .toUpperCase();
  const m = s.match(/^(\d{1,6})([A-G])?$/);
  if (!m) return null;
  const letter = m[2];
  return { routePrice: Number(m[1]) * 1000, letter, leaseholdRatio: letter ? LEASE_RATIO_BY_LETTER[letter as LeaseLetter] : undefined };
}
