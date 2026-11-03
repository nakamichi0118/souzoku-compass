"use client";

import { useMemo } from "react";
import { DOCS, type DocCategory } from "@/domain/procedures/documents";
import { isValidDate } from "@/domain/procedures/dates";
import type { Interview, Verdict } from "@/domain/procedures/interview";
import { buildTasks, type Task } from "@/domain/procedures/rules";
import type { Case } from "@/domain/types";
import { naId, usePlan } from "./planStore";
import { filingSteps } from "./progress";
import { useCase } from "./store";

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export interface DocItem {
  id: string;
  used: Task[];
  done: boolean;
  /** 不要にした */
  na: boolean;
}

/** マイページ全体で使う集計（手続き・書類・相続税申告の進み具合） */
export function useOverall() {
  const plan = usePlan();
  const { data: c0 } = useCase();
  // 相続税申告の画面で「次へ」で終えたステップは、やることリストの対応する項目も完了にする
  const done = useMemo(() => {
    const auto = [...(c0.progress?.completed.includes("assets") ? ["asset-valuation"] : []), ...(c0.progress?.completed.includes("division") ? ["division"] : [])];
    return auto.length ? [...new Set([...plan.done, ...auto])] : plan.done;
  }, [plan.done, c0.progress]);
  const iv = useMemo(() => withAssets(plan.iv, c0), [plan.iv, c0]);
  const { data: c, result } = useCase();
  const closed = (id: string) => done.includes(id) || done.includes(naId(id));
  const valid = isValidDate(iv.deathDate);
  // 財産の入力を「次へ」で終えるまでは、途中の金額で判定が変わらないよう聞き取りの目安を使う
  const linked = valid && c.decedent.deathDate === iv.deathDate && c.assets.length > 0 && !!result && !!c.progress?.completed.includes("assets") && result.blockers.length === 0;
  const precise = useMemo(
    () => (linked && result ? { taxable: result.totalTaxable, basic: result.basicDeduction, payable: result.totalPayable, needsFiling: result.needsFiling } : null),
    [linked, result],
  );
  const verdict: Verdict | undefined = precise ? (!precise.needsFiling ? "none" : precise.payable > 0 ? "likely" : "relief") : undefined;
  const built = useMemo(() => (valid ? buildTasks(iv, { verdict }) : null), [iv, valid, verdict]);
  const tasks = built?.tasks ?? [];
  const est = built?.est ?? null;
  const main = tasks.filter((t) => !t.optional);
  const steps = filingSteps(c.decedent.deathDate === iv.deathDate ? c : { ...c, progress: { completed: [] } }, result);
  const filing = main.some((t) => t.id === "inheritance-tax");

  const docs: DocItem[] = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of main) for (const id of t.docs) if (DOCS[id]) m.set(id, [...(m.get(id) ?? []), t]);
    return [...m.entries()].map(([id, used]) => ({ id, used, done: done.includes(`doc:${id}`), na: done.includes(naId(`doc:${id}`)) }));
  }, [main, done]);

  const live = main.filter((t) => !done.includes(naId(t.id)));
  const liveDocs = docs.filter((d) => !d.na);
  const doneTasks = live.filter((t) => done.includes(t.id)).length;
  const doneSteps = filing ? steps.filter((s) => s.done).length : 0;
  const doneDocs = liveDocs.filter((d) => d.done).length;
  const total = live.length + (filing ? steps.length : 0) + liveDocs.length;
  const finished = doneTasks + doneSteps + doneDocs;
  const pct = total ? Math.round((finished / total) * 100) : 0;
  const now = todayISO();
  const next = main.find((t) => !closed(t.id));
  const urgent = main.filter((t) => !closed(t.id) && t.date <= addDaysISO(now, 7));

  const byCategory = useMemo(() => {
    const m = new Map<DocCategory, DocItem[]>();
    for (const d of docs) {
      const k = DOCS[d.id].category;
      m.set(k, [...(m.get(k) ?? []), d]);
    }
    return m;
  }, [docs]);

  return { ...plan, done, iv, closed, live, valid, est, precise, verdict, tasks, main, steps, filing, docs, byCategory, doneTasks, doneSteps, doneDocs, total, finished, pct, now, next, urgent, case: c, result };
}

function addDaysISO(d: string, n: number) {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/**
 * 聞き取りで「ない」と答えた財産でも、あとから相続税申告の画面で登録したら手続き・書類に反映する
 * （聞き取りの答えは書き換えず、手続きの判定にだけ使う）
 */
export function withAssets(iv: Interview, c: Case): Interview {
  if (c.decedent.deathDate !== iv.deathDate || c.assets.length === 0) return iv;
  const sum = (kinds: string[]) => c.assets.filter((a) => kinds.includes(a.kind)).reduce((s, a) => s + ("amount" in a ? a.amount : 1), 0);
  const has = (kinds: string[]) => c.assets.some((a) => kinds.includes(a.kind));
  const next = { ...iv };
  if (!iv.deposits && has(["deposit", "cash"])) next.deposits = Math.max(1, sum(["deposit", "cash"]));
  if (!iv.securities && has(["listedStock", "unlistedStock"])) next.securities = 1;
  if (!iv.insurance && has(["insurance"])) next.insurance = Math.max(1, sum(["insurance"]));
  if (!iv.homeValue && !iv.otherRealEstate && has(["land", "building", "condo"])) next.otherRealEstate = 1;
  return next;
}
