import type { TaxResult } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";
import { civilHeirIds } from "@/domain/heirs";
import { reviewSummary } from "@/domain/review/topics";
import { STEPS } from "./steps";

/** 遺産分割で分ける財産（保険金・退職金は受取人が受け取るため除く） */
export const divisibleAssets = (c: Case) => c.assets.filter((a) => a.kind !== "insurance" && a.kind !== "retirement");

/**
 * 財産を受け取る人が1人だけのとき、その人の id（遺産分割は要らない）。
 * 民法上の相続人が1人で、ほかに受け取る人（放棄していない受遺者など）もいないときだけ。入力途中・2人以上なら null
 */
export function soleHeirId(c: Case): string | null {
  let ids: Set<string>;
  try {
    ids = civilHeirIds(c.persons);
  } catch {
    return null;
  }
  if (ids.size !== 1) return null;
  const takers = c.persons.filter((p) => !p.predeceased && !p.renounced);
  const [id] = [...ids];
  return takers.length === 1 && takers[0].id === id ? id : null;
}

/** 画面の帯・前後のボタンに出すステップ（相続人が1人なら「遺産の分け方」は飛ばす。放棄した人が葬式費用を払っているかもしれないときは残す） */
export const visibleSteps = (c: Case) => (soleHeirId(c) && !(hasRenounced(c) && c.debts.some((d) => d.kind === "funeral")) ? STEPS.filter((s) => s.slug !== "division") : [...STEPS]);

/** 相続人が1人なら、分ける財産をすべてその人が受け取り、債務・葬式費用もその人が負担することにする（分け方の入力を省く）。それ以外はそのまま */
export function withSoleHeir(c: Case): Case {
  const id = soleHeirId(c);
  if (!id) return c;
  const assets = divisibleAssets(c);
  const whole = (a: { id: string }) => {
    const al = c.allocations.find((x) => x.assetId === a.id);
    return al?.shares.length === 1 && al.shares[0].personId === id && al.shares[0].numerator === al.shares[0].denominator && al.shares[0].numerator > 0;
  };
  // 債務・葬式費用もその人が全額負担する。ただし葬式費用は、相続を放棄した人（保険金を受け取った人など）が
  // 実際に払っていれば、その人の負担のまま残す（その人は葬式費用を引ける）
  const renouncedPaid = (d: Case["debts"][number]) =>
    d.kind === "funeral" && d.bearers.some((b) => c.persons.some((p) => p.id === b.personId && p.renounced && !p.predeceased));
  const borne = (d: Case["debts"][number]) =>
    renouncedPaid(d) || (d.bearers.length === 1 && d.bearers[0].personId === id && d.bearers[0].amount === d.amount);
  // 代償金は2人以上で分けるときのものなので、1人なら残さない（消した人との代償金が残って計算が止まらないように）
  if (!c.undivided && !c.compensation?.length && c.allocations.length === assets.length && assets.every(whole) && c.debts.every(borne)) return c;
  return {
    ...c,
    undivided: undefined,
    compensation: undefined,
    allocations: assets.map((a) => ({ assetId: a.id, shares: [{ personId: id, numerator: 1, denominator: 1 }] })),
    debts: c.debts.map((d) => (borne(d) ? d : { ...d, bearers: [{ personId: id, amount: d.amount }] })),
  };
}

/** 相続を放棄した人（亡くなっていない）がいるか。いれば葬式費用を負担していることがあるので、負担者の欄を残す */
export const hasRenounced = (c: Case) => c.persons.some((p) => p.renounced && !p.predeceased);

/** 取得する人が1人でも決まっている財産か */
export const isAllocated = (c: Case, assetId: string) => c.allocations.some((x) => x.assetId === assetId && x.shares.some((s) => s.numerator > 0));

/** 取得する人が決まっていない財産（「分け方がまだ決まっていない」にしたときは、法定相続分で計算される財産） */
export const unallocatedAssets = (c: Case) => divisibleAssets(c).filter((a) => !isAllocated(c, a.id));

/**
 * 取得する人が決まっていないため、税額の計算に入っていない財産。
 * 「分け方がまだ決まっていない」にしていないのに、取得者がいない・割合の合計が100%でない財産と、
 * 未分割にしていても割合の合計が100%を超える財産（どちらも計算エンジンは止めて案内を出す）
 */
export function unsettledAssets(c: Case) {
  return divisibleAssets(c).filter((a) => {
    const shares = c.allocations.find((x) => x.assetId === a.id)?.shares.filter((s) => s.numerator > 0 && s.denominator > 0) ?? [];
    const total = shares.reduce((acc, s) => acc + s.numerator / s.denominator, 0);
    if (total > 1 + 1e-9) return true;
    return !c.undivided && total < 1 - 1e-9;
  });
}

/** 申告書を作ったときの入力の目印。財産・分け方などを変えると変わる（作り直しが必要と分かる） */
export function formsKey(c: Case): string {
  // 進み具合と、ダウンロード前の同意のチェックは申告書の中身に関係しないので除く
  const { progress: _p, review, ...rest } = c;
  const { consent: _c, ...answers } = review ?? {};
  const text = JSON.stringify({ ...rest, review: Object.keys(answers).length ? answers : undefined });
  // FNV-1a（32ビット）。同じ入力かどうかを見分けるだけなので、これで足りる
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${text.length.toString(36)}-${h.toString(36)}`;
}

/** 申告書PDFを作ったあとに入力が変わっていないか（作っていなければ false） */
export const formsUpToDate = (c: Case) => !!c.progress?.formsKey && c.progress.formsKey === formsKey(c);

/** 遺産の分け方の入力が終わっているか：すべての財産に取得する人が決まっているか、未分割で申告すると選んだ */
export const divisionReady = (c: Case) => c.assets.length > 0 && (!!c.undivided || unallocatedAssets(c).length === 0);

/** 相続税申告の各ステップの進み具合（「次へ」で完了にしたもの＋入力の有無） */
export function filingSteps(c: Case, r: TaxResult | null) {
  const completed = new Set(c.progress?.completed ?? []);
  // 相続人が1人なら分け方は決めなくてよいので、財産があれば済みにする
  if (soleHeirId(c) && c.assets.length > 0) completed.add("division");
  const has: Record<string, boolean> = {
    decedent: !!(c.decedent.name && c.decedent.deathDate && c.decedent.address),
    heirs: c.persons.length > 0,
    assets: c.assets.length > 0,
    debts: true,
    review: (() => {
      const s = reviewSummary(c.review);
      return s.answered === s.total;
    })(),
    division: divisionReady(c),
    // 取得する人が決まっていない財産があるなど、計算を止める事項があるうちは完了にしない
    tax: !!r && r.blockers.length === 0,
    // 申告書PDFを作り、そのあと入力を変えていないとき（遺産分割協議書を作っただけでは完了にしない）
    documents: !!r && r.blockers.length === 0 && formsUpToDate(c),
  };
  return STEPS.map((s) => ({ slug: s.slug, title: s.title, done: completed.has(s.slug) && has[s.slug] }));
}

export const markCompleted = (c: Case, slug: string): Case => {
  const completed = new Set(c.progress?.completed ?? []);
  completed.add(slug);
  return { ...c, progress: { ...c.progress, completed: [...completed] } };
};

/** 申告書PDFを作った：書類のステップを完了にし、そのときの入力の目印を残す */
export const markFormsCreated = (c: Case): Case => {
  const done = markCompleted(c, "documents");
  return { ...done, progress: { completed: done.progress?.completed ?? [], formsKey: formsKey(c) } };
};
