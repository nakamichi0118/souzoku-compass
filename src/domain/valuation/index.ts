/**
 * 財産の評価（相続税評価額）。結果は円単位の整数。
 * 小数は 1/1000 単位の整数で扱い、浮動小数点の誤差を持ち込まない。
 */
import type { Asset, CondoAsset, LandAsset } from "../types";

export interface Valuation {
  value: number;
  /** 第11表の「単価」「倍数」「数量」欄、説明表示用 */
  unitPrice?: number;
  multiplier?: number;
  quantity?: string;
  steps: string[];
  /** 自動評価できず専門家への相談が必要 */
  needsConsultation?: string;
}

const thou = (x: number) => Math.round(x * 1000); // 小数3桁までの値を整数化

/** 区分所有補正率の計算（評価通達 居住用の区分所有財産の評価について、令和6年1月1日以後） */
export function condoCorrection(c: Pick<
  CondoAsset,
  "builtYearsMonths" | "totalFloors" | "floor" | "landShareSqm" | "exclusiveAreaSqm"
>) {
  const years = c.builtYearsMonths.years + (c.builtYearsMonths.months > 0 ? 1 : 0); // 1年未満切上げ
  const A = -33 * years; // ×1/1000
  const floorIndex = Math.min(1000, Math.floor((c.totalFloors * 1000) / 33)); // 第4位切捨て、上限1
  const B = Math.floor((floorIndex * 239) / 1000); // 第4位切捨て
  const C = 18 * Math.max(0, c.floor); // 地階は0
  // 敷地持分狭小度：第4位切上げ
  const narrowness = Math.ceil(
    (Math.round(c.landShareSqm * 100) * 1000) / Math.round(c.exclusiveAreaSqm * 100),
  );
  // D：第4位切上げ（絶対値が大きくなる方向。国税庁計算例 0.350×△1.195=△0.419）
  const D = -Math.ceil((narrowness * 1195) / 1000);
  const ratio = A + B + C + D + 3220; // 評価乖離率 ×1/1000
  let correction: number; // 区分所有補正率 ×1/10000
  let note: string;
  if (ratio <= 0) {
    correction = 0;
    note = "評価乖離率が0以下のため評価しません";
  } else if (1000 / ratio < 0.6) {
    correction = ratio * 6; // ×0.6 → 1/10000単位
    note = "評価水準が0.6未満のため 評価乖離率×0.6";
  } else if (ratio < 1000) {
    correction = ratio * 10;
    note = "評価水準が1を超えるため 評価乖離率";
  } else {
    correction = 10000;
    note = "評価水準が0.6以上1以下のため補正なし";
  }
  return { years, A, B, C, D, narrowness, ratio, correction, note };
}

export function valueLand(a: LandAsset): Valuation {
  const m = a.method;
  if (m.type === "rosenka") {
    const per = Math.floor(
      (m.routePrice * thou(m.depthCorrection) * thou(m.otherCorrection ?? 1)) / 1_000_000,
    );
    const value = Math.floor(per * a.areaSqm);
    return {
      value,
      unitPrice: per,
      quantity: `${a.areaSqm}㎡`,
      steps: [
        `路線価 ${m.routePrice.toLocaleString()}円 × 奥行価格補正率 ${m.depthCorrection}` +
          (m.otherCorrection && m.otherCorrection !== 1 ? ` × 補正 ${m.otherCorrection}` : "") +
          ` = ${per.toLocaleString()}円/㎡`,
        `${per.toLocaleString()}円/㎡ × ${a.areaSqm}㎡ = ${value.toLocaleString()}円`,
      ],
    };
  }
  if (m.type === "multiplier") {
    if (!(m.multiplier > 0) || !(m.fixedAssetValue > 0)) {
      return {
        value: 0,
        quantity: `${a.areaSqm}㎡`,
        steps: [],
        needsConsultation: "固定資産税評価額と倍率（国税庁の評価倍率表）が未入力です。確認して入力してください。",
      };
    }
    const value = Math.floor((m.fixedAssetValue * thou(m.multiplier)) / 1000);
    return {
      value,
      multiplier: m.multiplier,
      quantity: `${a.areaSqm}㎡`,
      steps: [`固定資産税評価額 ${m.fixedAssetValue.toLocaleString()}円 × 倍率 ${m.multiplier} = ${value.toLocaleString()}円`],
    };
  }
  return { value: Math.floor(m.value), quantity: `${a.areaSqm}㎡`, steps: ["評価額を直接入力"] };
}

export function valueAsset(a: Asset): Valuation {
  switch (a.kind) {
    case "land":
      return valueLand(a);
    case "building":
      return {
        value: a.fixedAssetValue,
        multiplier: 1.0,
        steps: [`固定資産税評価額 ${a.fixedAssetValue.toLocaleString()}円 × 1.0`],
      };
    case "condo": {
      const c = condoCorrection(a);
      const land = Math.floor((a.landValueBeforeCorrection * c.correction) / 10000);
      const bldg = Math.floor((a.buildingFixedAssetValue * c.correction) / 10000);
      return {
        value: land + bldg,
        steps: [
          `評価乖離率 ${(c.ratio / 1000).toFixed(3)}（${c.note}）→ 区分所有補正率 ${(c.correction / 10000).toFixed(4)}`,
          `敷地利用権 ${a.landValueBeforeCorrection.toLocaleString()}円 × 補正率 = ${land.toLocaleString()}円`,
          `区分所有権 ${a.buildingFixedAssetValue.toLocaleString()}円 × 補正率 = ${bldg.toLocaleString()}円`,
        ],
      };
    }
    case "deposit":
    case "cash":
    case "household":
    case "other": {
      const v = a.amount + (a.accruedInterest ?? 0);
      return { value: v, steps: [a.accruedInterest ? `残高＋既経過利息` : `金額`] };
    }
    case "listedStock": {
      const p = a.prices;
      // 未入力（0）を最も低い価格として採用しないよう、4つの価格がそろうまで確定しない
      if (![p.close, p.monthAvg, p.prevMonthAvg, p.prev2MonthAvg].every((x) => x > 0) || !(a.shares > 0)) {
        return {
          value: 0,
          quantity: `${a.shares}株`,
          steps: [],
          needsConsultation: "株数と4つの価格（亡くなった日の終値、その月・前月・前々月の終値の平均）がそろっていません。証券会社の資料で確認して入力してください。",
        };
      }
      const unit = Math.min(p.close, p.monthAvg, p.prevMonthAvg, p.prev2MonthAvg);
      return {
        value: Math.floor(unit * a.shares),
        unitPrice: unit,
        quantity: `${a.shares}株`,
        steps: [`4つの価格のうち最も低い ${unit.toLocaleString()}円 × ${a.shares}株`],
      };
    }
    case "unlistedStock":
      if (a.value == null) {
        return {
          value: 0,
          quantity: `${a.shares}株`,
          steps: [],
          needsConsultation: "非上場株式の評価額が未入力です。税理士にご相談ください。",
        };
      }
      return { value: a.value, quantity: `${a.shares}株`, steps: ["評価額を入力"] };
    case "insurance":
    case "retirement":
      return { value: a.amount, steps: ["受取金額"] };
  }
}

/** 小規模宅地等の特例（特定居住用宅地等：330㎡まで80%減額、租税特別措置法69条の4） */
/**
 * 小規模宅地等の特例（特定居住用宅地等・減額割合80%）。付表1の⑤⑥⑦の順に計算する。
 * ⑥ = ④ × ⑤/③（1円未満切捨て）、⑦ = ⑥ × 80/100（1円未満切捨て）
 */
export function smallResidentialSelection(value: number, areaSqm: number, limitSqm = 330) {
  if (areaSqm <= 0 || value <= 0) return { selectedArea: 0, selectedValue: 0, reduction: 0 };
  const area100 = Math.round(areaSqm * 100);
  const target100 = Math.min(area100, Math.max(0, Math.round(limitSqm * 100)));
  const selectedValue = Number((BigInt(value) * BigInt(target100)) / BigInt(area100));
  return { selectedArea: target100 / 100, selectedValue, reduction: Math.floor((selectedValue * 8) / 10) };
}

export function smallResidentialReduction(value: number, areaSqm: number, limitSqm = 330) {
  return smallResidentialSelection(value, areaSqm, limitSqm).reduction;
}
