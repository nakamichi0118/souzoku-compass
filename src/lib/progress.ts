import type { TaxResult } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";
import { STEPS } from "./steps";

/** 相続税申告の7ステップの進み具合（「次へ」で完了にしたもの＋入力の有無） */
export function filingSteps(c: Case, r: TaxResult | null) {
  const completed = new Set(c.progress?.completed ?? []);
  const has: Record<string, boolean> = {
    decedent: !!(c.decedent.name && c.decedent.deathDate && c.decedent.address),
    heirs: c.persons.length > 0,
    assets: c.assets.length > 0,
    debts: true,
    // 保険金・退職金（受取人が取得）以外のすべての財産に、取得する人が決まっていること
    division:
      c.assets.length > 0 &&
      c.assets.filter((a) => a.kind !== "insurance" && a.kind !== "retirement").every((a) => c.allocations.some((x) => x.assetId === a.id && x.shares.some((s) => s.numerator > 0))),
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
