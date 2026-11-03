/**
 * 財産の評価（相続税評価額）。結果は円単位の整数。
 * 小数は 1/1000 単位の整数で扱い、浮動小数点の誤差を持ち込まない。
 */
import type { Asset, CondoAsset, LandAsset } from "../types";
import { evaluateRoads } from "./roads";

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

/** 整数 a × 整数 b ÷ d（1未満切捨て）。桁あふれしないよう BigInt で計算する（ありえない大きさの入力でも止まらないようにする） */
function mulDiv(a: number, b: number, d: number): number {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return Math.floor((a * b) / d);
  return Number((BigInt(a) * BigInt(b)) / BigInt(d));
}

/**
 * 1㎡当たりの価額（円）× 地積（㎡）。1円未満切捨て。
 * 地積は0.01㎡単位の整数にしてから掛け、浮動小数点の誤差で1円ずれないようにする。
 */
export function perSqmTimesArea(perSqm: number, areaSqm: number): number {
  return mulDiv(Math.floor(perSqm), Math.round(areaSqm * 100), 100);
}

/**
 * 区分所有補正率を使わない建物かどうか（「居住用の区分所有財産の評価について」（注）1）。
 * 地階を除く階数が2以下の建物と、住まい用の部屋が3室以下でそのすべてを持ち主や親族が住まいに使っている建物は対象外。
 * 対象外なら理由を、対象なら null を返す。
 */
export function condoExclusion(c: Pick<CondoAsset, "totalFloors" | "fewUnitsFamily">): string | null {
  if (c.fewUnitsFamily) return "住まい用の部屋が3室以下で、そのすべてを持ち主や親族が住まいに使っているため区分所有補正なし";
  if (c.totalFloors > 0 && c.totalFloors <= 2) return "地階を除く階数が2以下のため区分所有補正なし";
  return null;
}

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
  const quantity = `${a.areaSqm}㎡`;
  const consult = (needsConsultation: string): Valuation => ({ value: 0, quantity, steps: [], needsConsultation });
  if (m.type === "rosenka") {
    // 未入力のまま0円で計算すると課税価格が過少になるため、そろうまで確定しない
    if (!(a.areaSqm > 0)) return consult("地積（土地の面積）が未入力です。固定資産税の課税明細書や登記事項証明書を見て入力してください。");
    if (m.roads?.length) {
      // 入れかけの道路を外して計算すると、角地などが道路1つの土地として低く評価されるため、すべての道路がそろうまで確定しない
      if (m.roads.some((r) => !(r.price > 0) || !(r.depth > 0)))
        return consult("路線価か奥行が未入力の道路があります。面しているすべての道路に路線価と奥行を入れてください（面していない道路は削除してください）。路線価図を見て入力できます。");
    } else if (!(m.routePrice > 0) || !(m.depthCorrection > 0)) {
      return consult("路線価と奥行価格補正率が未入力です。固定資産税の課税明細書や路線価図を見て入力してください。");
    }
    // 税理士に確認した補正率（任意）。未入力・0以下は「補正なし」（1）として扱い、0円にならないようにする
    const oc = m.otherCorrection != null && m.otherCorrection > 0 ? m.otherCorrection : 1;
    if (oc > 1) return consult(`税理士に確認した補正率（${m.otherCorrection}）が1を超えています。補正率は0より大きく1以下の数です。土地の画面で正しい補正率に直すか、空欄にしてください（空欄なら補正なしで計算します）。`);
    const ocStep = oc !== 1 ? ` × 補正 ${oc}` : "";
    if (m.roads?.length) {
      const r = evaluateRoads(m.district ?? "普通住宅地区", m.roads)!;
      const per = Math.floor((r.perSqm * thou(oc)) / 1000);
      const value = perSqmTimesArea(per, a.areaSqm);
      return {
        value,
        unitPrice: per,
        quantity,
        steps: [
          ...r.steps,
          ...(ocStep ? [`${r.perSqm.toLocaleString()}円/㎡${ocStep} = ${per.toLocaleString()}円/㎡`] : []),
          `${per.toLocaleString()}円/㎡ × ${a.areaSqm}㎡ = ${value.toLocaleString()}円`,
        ],
      };
    }
    const per = Math.floor((m.routePrice * thou(m.depthCorrection) * thou(oc)) / 1_000_000);
    const value = perSqmTimesArea(per, a.areaSqm);
    return {
      value,
      unitPrice: per,
      quantity,
      steps: [
        `路線価 ${m.routePrice.toLocaleString()}円 × 奥行価格補正率 ${m.depthCorrection}${ocStep} = ${per.toLocaleString()}円/㎡`,
        `${per.toLocaleString()}円/㎡ × ${a.areaSqm}㎡ = ${value.toLocaleString()}円`,
      ],
    };
  }
  if (m.type === "multiplier") {
    if (!(m.multiplier > 0) || !(m.fixedAssetValue > 0)) {
      return consult("固定資産税評価額と倍率（国税庁の評価倍率表）が未入力です。確認して入力してください。");
    }
    const value = Math.floor((m.fixedAssetValue * thou(m.multiplier)) / 1000);
    return {
      value,
      multiplier: m.multiplier,
      quantity,
      steps: [`固定資産税評価額 ${m.fixedAssetValue.toLocaleString()}円 × 倍率 ${m.multiplier} = ${value.toLocaleString()}円`],
    };
  }
  // 不特定多数の人が通り抜けに使う私道は評価しない（財産評価基本通達24）。本人がそう選んだときだけ0円にする
  if (m.publicPrivateRoad) return { value: 0, quantity, steps: ["誰でも通り抜けできる私道のため評価しない（財産評価基本通達24）"] };
  // 直接入力：0円のまま確定すると課税価格が過少になるため止める
  if (!(m.value > 0)) return consult("土地の評価額が未入力です。評価額を入力してください。誰でも通り抜けできる私道で評価しない土地なら、土地の画面でそのことを選んでください。");
  return { value: Math.floor(m.value), quantity, steps: ["評価額を直接入力"] };
}

export function valueAsset(a: Asset): Valuation {
  switch (a.kind) {
    case "land":
      return valueLand(a);
    case "building":
      if (!(a.fixedAssetValue > 0)) {
        return { value: 0, steps: [], needsConsultation: "家屋の固定資産税評価額が未入力です。固定資産税の課税明細書（または評価証明書）を見て入力してください。" };
      }
      return {
        value: a.fixedAssetValue,
        multiplier: 1.0,
        steps: [`固定資産税評価額 ${a.fixedAssetValue.toLocaleString()}円 × 1.0`],
      };
    case "condo": {
      const excluded = condoExclusion(a);
      // 未入力のまま計算すると0円や過少な評価になるため、そろうまで確定しない（補正の対象外なら補正に使う値は不要）
      const missing = [
        !(a.landValueBeforeCorrection > 0) && "敷地利用権の評価額",
        !(a.landShareSqm > 0) && "敷地利用権の面積",
        !excluded && !(a.totalFloors > 0) && "総階数",
        !excluded && !(a.exclusiveAreaSqm > 0) && "専有部分の面積",
        !excluded && !(a.floor >= 1) && "所在階",
      ].filter((x): x is string => !!x);
      if (missing.length) {
        return {
          value: 0,
          steps: [],
          needsConsultation:
            `${missing.join("・")}が未入力です。登記事項証明書や固定資産税の課税明細書を見て入力してください。` +
            (missing.includes("所在階") ? "地下にある部屋は、相続コンパスでは計算できないため税理士にご相談ください。" : ""),
        };
      }
      let correction = 10000; // 区分所有補正率 ×1/10000
      let first: string;
      if (excluded) {
        first = `${excluded}（区分所有補正率 1）`;
      } else {
        const c = condoCorrection(a);
        if (c.ratio <= 0) {
          return {
            value: 0,
            steps: [],
            needsConsultation: "評価乖離率が0以下になるため、通常の方法では評価できません（国税庁の通達では個別に評価します）。税理士にご相談ください。",
          };
        }
        correction = c.correction;
        first = `評価乖離率 ${(c.ratio / 1000).toFixed(3)}（${c.note}）→ 区分所有補正率 ${(c.correction / 10000).toFixed(4)}`;
      }
      const land = Math.floor((a.landValueBeforeCorrection * correction) / 10000);
      const bldg = Math.floor((a.buildingFixedAssetValue * correction) / 10000);
      return {
        value: land + bldg,
        steps: [
          first,
          `敷地利用権 ${a.landValueBeforeCorrection.toLocaleString()}円 × 補正率 = ${land.toLocaleString()}円`,
          `区分所有権 ${a.buildingFixedAssetValue.toLocaleString()}円 × 補正率 = ${bldg.toLocaleString()}円`,
        ],
        // 部屋（家屋）の評価額が0円のままでは確定しない。ただし金額は返す：
        // 計算部分（engine・第11表）は家屋の評価額を0にして呼び、敷地利用権の部分だけの金額を得ているため
        ...(a.buildingFixedAssetValue > 0
          ? {}
          : { needsConsultation: "区分所有建物（部屋）の固定資産税評価額が未入力です。固定資産税の課税明細書を見て入力してください。" }),
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
      // 価格は小数（0.01円単位）、株数は0.001株単位の整数にして掛け、浮動小数点の誤差を持ち込まない（1円未満切捨て）
      const value = mulDiv(Math.round(unit * 100), thou(a.shares), 100_000);
      return {
        value,
        unitPrice: unit,
        quantity: `${a.shares}株`,
        steps: [`4つの価格のうち最も低い ${unit.toLocaleString()}円 × ${a.shares.toLocaleString()}株 = ${value.toLocaleString()}円`],
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
