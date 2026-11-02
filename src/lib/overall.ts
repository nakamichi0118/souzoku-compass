"use client";

import { useMemo } from "react";
import { DOCS, type DocCategory } from "@/domain/procedures/documents";
import { isValidDate } from "@/domain/procedures/dates";
import type { Verdict } from "@/domain/procedures/interview";
import { buildTasks, type Task } from "@/domain/procedures/rules";
import { usePlan } from "./planStore";
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
}

/** マイページ全体で使う集計（手続き・書類・相続税申告の進み具合） */
export function useOverall() {
  const plan = usePlan();
  const { iv, done } = plan;
  const { data: c, result } = useCase();
  const valid = isValidDate(iv.deathDate);
  const linked = valid && c.decedent.deathDate === iv.deathDate && c.assets.length > 0 && !!result;
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
    return [...m.entries()].map(([id, used]) => ({ id, used, done: done.includes(`doc:${id}`) }));
  }, [main, done]);

  const doneTasks = main.filter((t) => done.includes(t.id)).length;
  const doneSteps = filing ? steps.filter((s) => s.done).length : 0;
  const doneDocs = docs.filter((d) => d.done).length;
  const total = main.length + (filing ? steps.length : 0) + docs.length;
  const finished = doneTasks + doneSteps + doneDocs;
  const pct = total ? Math.round((finished / total) * 100) : 0;
  const now = todayISO();
  const next = main.find((t) => !done.includes(t.id));
  const urgent = main.filter((t) => !done.includes(t.id) && t.date <= addDaysISO(now, 7));

  const byCategory = useMemo(() => {
    const m = new Map<DocCategory, DocItem[]>();
    for (const d of docs) {
      const k = DOCS[d.id].category;
      m.set(k, [...(m.get(k) ?? []), d]);
    }
    return m;
  }, [docs]);

  return { ...plan, valid, est, precise, verdict, tasks, main, steps, filing, docs, byCategory, doneTasks, doneSteps, doneDocs, total, finished, pct, now, next, urgent, case: c, result };
}

function addDaysISO(d: string, n: number) {
  const x = new Date(d + "T00:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
