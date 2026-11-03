import type { TaxResult } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";
import { STEPS } from "./steps";

/** 遺産分割で分ける財産（保険金・退職金は受取人が受け取るため除く） */
export const divisibleAssets = (c: Case) => c.assets.filter((a) => a.kind !== "insurance" && a.kind !== "retirement");

/** 取得する人が1人でも決まっている財産か */
export const isAllocated = (c: Case, assetId: string) => c.allocations.some((x) => x.assetId === assetId && x.shares.some((s) => s.numerator > 0));

/** 取得する人が決まっていない財産（「分け方がまだ決まっていない」にしたときは、法定相続分で計算される財産） */
export const unallocatedAssets = (c: Case) => divisibleAssets(c).filter((a) => !isAllocated(c, a.id));

/** 遺産の分け方の入力が終わっているか：すべての財産に取得する人が決まっているか、未分割で申告すると選んだ */
export const divisionReady = (c: Case) => c.assets.length > 0 && (!!c.undivided || unallocatedAssets(c).length === 0);

/** 相続税申告の7ステップの進み具合（「次へ」で完了にしたもの＋入力の有無） */
export function filingSteps(c: Case, r: TaxResult | null) {
  const completed = new Set(c.progress?.completed ?? []);
  const has: Record<string, boolean> = {
    decedent: !!(c.decedent.name && c.decedent.deathDate && c.decedent.address),
    heirs: c.persons.length > 0,
    assets: c.assets.length > 0,
    debts: true,
    division: divisionReady(c),
    tax: !!r,
    documents: true,
  };
  return STEPS.map((s) => ({ slug: s.slug, title: s.title, done: completed.has(s.slug) && has[s.slug] }));
}

export const markCompleted = (c: Case, slug: string): Case => {
  const completed = new Set(c.progress?.completed ?? []);
  completed.add(slug);
  return { ...c, progress: { completed: [...completed] } };
};
