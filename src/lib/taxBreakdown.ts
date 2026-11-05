import type { TaxResult } from "@/domain/tax/engine";
import type { Asset, Case } from "@/domain/types";
import { SMALL_LAND_RULE, judgeSmallResidential, smallLandKind } from "@/domain/valuation/smallResidential";
import { smallLandDivisionGap } from "./smallLand";

/**
 * 税額の画面の「財産の合計の内訳」。課税価格の合計（第1表の⑥の合計）が、財産の評価額から
 * 小規模宅地等の特例・保険金と退職金の非課税・債務と葬式費用・生前贈与の加算でどう決まったかを並べる。
 * 計算はエンジンの結果を足し合わせるだけで、新しく計算はしない（小規模宅地等の特例を使っていない理由だけは、土地の画面と同じ判定で調べる）
 */
export interface TaxBreakdown {
  /** 財産の評価額の合計（保険金・退職金を除く。小規模宅地等の特例で減らす前。代償金の受取り・支払いは差し引きで入る） */
  assets: number;
  /** 小規模宅地等の特例を使った土地（部屋） */
  small: SmallLandUsed[];
  /** 特例の欄に答えたのに、特例を使っていない土地（部屋）と、その理由 */
  smallUnused: SmallLandUnused[];
  /** 特例の欄に答えていない宅地・部屋の名前（自宅などなら答えると評価が下がることがある） */
  smallUnanswered: { assetId: string; label: string }[];
  /** 死亡保険金：受け取った額と非課税の額（500万円×法定相続人の数まで。相続税法12条1項5号） */
  insurance: Exempt | null;
  /** 死亡退職金：受け取った額と非課税の額（500万円×法定相続人の数まで。相続税法12条1項6号） */
  retirement: Exempt | null;
  /** 債務・葬式費用（差し引けた額） */
  debts: number;
  /** 生前贈与の加算（暦年課税の3年以内の贈与と、相続時精算課税の贈与） */
  gifts: number;
  /** 課税価格の合計（一人ずつ1,000円未満を切り捨てた合計） */
  total: number;
  /** 債務・葬式費用が受け取った財産より多く、0円として数えた人がいる */
  netFloored: boolean;
  legalHeirCount: number;
}

export interface SmallLandUsed {
  assetId: string;
  label: string;
  /** 特例の種類の名前（特定居住用宅地等など） */
  name: string;
  rate: number;
  /** 特例を使った面積（㎡。何人かで使ったときは合計） */
  area: number;
  reduction: number;
}

export interface SmallLandUnused {
  assetId: string;
  label: string;
  reason: string;
}

export interface Exempt {
  received: number;
  exempt: number;
  /** 非課税の限度額（500万円×法定相続人の数） */
  limit: number;
  /** 相続人でない人・相続を放棄した人が受け取った分があり、その分には非課税を使えない */
  notHeirs: boolean;
}

const labelOf = (a: Asset) => a.label || (a.kind === "condo" ? "名称未入力の部屋" : "名称未入力の土地");

/** 特例の欄に答え始めたか（取得する人を選んだ、または何か答えた） */
const started = (a: Extract<Asset, { kind: "land" | "condo" }>) => {
  const sr = a.smallResidential;
  if (!sr) return false;
  return !!sr.acquirerId || sr.applies || Object.values(sr.check ?? {}).some((v) => v !== undefined && v !== false) || !!sr.others?.length;
};

/** 特例の欄に答えた土地（部屋）に、特例を使っていない理由。土地の画面の判定と同じ順に調べる */
export function smallLandUnusedReason(c: Case, r: TaxResult, a: Extract<Asset, { kind: "land" | "condo" }>): string {
  const sr = a.smallResidential ?? { applies: false };
  const kind = smallLandKind(a);
  const acquirer = c.persons.find((p) => p.id === sr.acquirerId && !p.predeceased);
  const place = a.kind === "condo" ? "部屋" : "土地";
  if (!sr.check) return sr.applies ? "特例の質問に答え直してください。" : "特例の質問に、まだ答えていません。";
  const check = sr.check;
  const j = judgeSmallResidential(check, acquirer, kind, { assetKind: a.kind });
  if (j.result === "incomplete") return acquirer ? "特例の質問に、まだ答えていないものがあります。" : `特例の欄で「この${place}を取得する人」を選んでいません。`;
  if (j.result === "no") return j.reason;
  if (j.result === "consult" && !check.confirmedByAdvisor) return "税理士への確認が必要な判定のため、特例を使わずに計算しています。確認できたら、土地の画面の「税理士に確認し、特例を使えることが分かった」にチェックを入れてください。";
  const gap = smallLandDivisionGap(c, a.id, sr.acquirerId);
  if (gap === "undivided") return `分け方が決まっていない${place}には、特例を使えません。`;
  if (gap === "notAcquirer") return `遺産の分け方で、特例を使う${acquirer?.name ? `${acquirer.name}さん` : "人"}がこの${place}を受け継いでいません。`;
  const area = a.kind === "condo" ? (sr.landShareSqm ?? a.landShareSqm) : a.areaSqm;
  if (!(area > 0)) return a.kind === "condo" ? "敷地権の面積を入れてください。" : "地積を入れてください。";
  const rule = SMALL_LAND_RULE[kind];
  if (r.assets.some((l) => l.asset.id !== a.id && l.reduction > 0))
    return `限度面積（${rule.name}は${rule.limitSqm}㎡など）を、税額がより少なくなるほかの土地に使っています。`;
  return "条件は満たしていますが、今の入力では計算に使えていません。税理士にご確認ください。";
}

export function taxBreakdown(c: Case, r: TaxResult): TaxBreakdown {
  const sum = (f: (p: TaxResult["persons"][number]) => number) => r.persons.reduce((s, p) => s + f(p), 0);
  // 一人ずつの取得額（減額後）に、小規模宅地等の特例で減らした額を足し戻す。財産の評価額をそのまま足すと、
  // 計算に入らない人（亡くなった方より後に亡くなった人など）の分まで入り、下の行の合計と課税価格の合計が合わなくなるため
  const assets = sum((p) => p.inherited) + r.assets.reduce((s, l) => s + l.reduction, 0);

  const small: SmallLandUsed[] = r.assets.flatMap((l) => {
    if (!(l.reduction > 0) || !l.small) return [];
    const rule = SMALL_LAND_RULE[l.small.kind];
    const area = [l.small, ...(l.smallExtra ?? [])].reduce((s, d) => s + d.selectedArea, 0);
    return [{ assetId: l.asset.id, label: labelOf(l.asset), name: rule.name, rate: l.small.rate, area: Math.round(area * 100) / 100, reduction: l.reduction }];
  });

  const smallUnused: SmallLandUnused[] = [];
  const smallUnanswered: { assetId: string; label: string }[] = [];
  for (const a of c.assets) {
    if (a.kind !== "land" && a.kind !== "condo") continue;
    if (a.kind === "land" && a.landUse !== "宅地") continue;
    const line = r.assets.find((l) => l.asset.id === a.id);
    if (!line || line.reduction > 0) continue;
    if (!started(a)) smallUnanswered.push({ assetId: a.id, label: labelOf(a) });
    else smallUnused.push({ assetId: a.id, label: labelOf(a), reason: smallLandUnusedReason(c, r, a) });
  }

  const exempt = (received: number, ex: number, limit: number, by: (p: TaxResult["persons"][number]) => number): Exempt | null =>
    received > 0 ? { received, exempt: ex, limit, notHeirs: r.persons.some((p) => by(p) > 0 && !p.isCivilHeir) } : null;

  return {
    assets,
    small,
    smallUnused,
    smallUnanswered,
    insurance: exempt(sum((p) => p.insurance), sum((p) => p.insuranceExempt), r.insuranceExemptLimit, (p) => p.insurance),
    retirement: exempt(sum((p) => p.retirement), sum((p) => p.retirementExempt), r.retirementExemptLimit, (p) => p.retirement),
    debts: sum((p) => p.debts),
    gifts: sum((p) => p.gifts + p.settlementGifts),
    total: r.totalTaxable,
    netFloored: r.persons.some((p) => p.acquired + p.settlementGifts - p.debts < 0),
    legalHeirCount: r.legalHeirCount,
  };
}
