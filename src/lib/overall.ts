"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo } from "react";
import { DOCS, type DocCategory } from "@/domain/procedures/documents";
import { isValidDate, todayISO } from "@/domain/procedures/dates";
import type { Interview, Verdict } from "@/domain/procedures/interview";
import { buildTasks, type Task } from "@/domain/procedures/rules";
import { hasRealEstate } from "@/domain/realEstate";
import type { Case } from "@/domain/types";
import { naId, usePlan, type ItemStatus } from "./planStore";
import { filingSteps } from "./progress";
import { assetsMissingDoc } from "./assetDocs";
import { useCase } from "./store";


export interface DocItem {
  id: string;
  used: Task[];
  done: boolean;
  /** 不要にした */
  na: boolean;
}

/** 相続税申告の画面で「次へ」で終えたステップと、それで完了にするやることリストの項目 */
const AUTO_DONE: [step: string, task: string][] = [
  ["assets", "asset-valuation"],
  ["division", "division"],
];

const NO_TASKS: Task[] = [];

/** マイページ全体で使う集計（手続き・書類・相続税申告の進み具合） */
export function useOverall() {
  const plan = usePlan();
  const { data: c, result } = useCase();
  // 相続税申告の記録が、聞き取りと同じ相続（同じ亡くなった日）のものか
  const sameCase = c.decedent.deathDate === plan.iv.deathDate;
  const completed = c.progress?.completed;
  // 相続税申告の画面で「次へ」で終えたステップは、やることリストの対応する項目も完了にする
  const autoDone = useMemo(() => (sameCase && completed ? AUTO_DONE.filter(([step]) => completed.includes(step)).map(([, task]) => task) : []), [sameCase, completed]);
  const done = useMemo(() => (autoDone.length ? [...new Set([...plan.done, ...autoDone])] : plan.done), [plan.done, autoDone]);
  const statusOf = useCallback((id: string): ItemStatus => (done.includes(id) ? "done" : done.includes(naId(id)) ? "na" : "open"), [done]);
  const closed = useCallback((id: string) => done.includes(id) || done.includes(naId(id)), [done]);
  const iv = useMemo(() => withAssets(plan.iv, c), [plan.iv, c]);
  const valid = isValidDate(iv.deathDate);
  // 財産の入力を「次へ」で終えるまでは、途中の金額で判定が変わらないよう聞き取りの目安を使う
  const linked = valid && sameCase && c.assets.length > 0 && !!result && !!completed?.includes("assets") && result.blockers.length === 0;
  const precise = useMemo(
    () => (linked && result ? { taxable: result.totalTaxable, basic: result.basicDeduction, payable: result.totalPayable, needsFiling: result.needsFiling } : null),
    [linked, result],
  );
  const verdict: Verdict | undefined = precise ? (!precise.needsFiling ? "none" : precise.payable > 0 ? "likely" : "relief") : undefined;
  const built = useMemo(() => (valid ? buildTasks(iv, { verdict }) : null), [iv, valid, verdict]);
  const tasks = built?.tasks ?? NO_TASKS;
  const est = built?.est ?? null;
  const main = useMemo(() => tasks.filter((t) => !t.optional), [tasks]);
  // 「不要」にした手続きを除いたもの。進み具合・書類・カレンダーはこれで数える
  const live = useMemo(() => main.filter((t) => !done.includes(naId(t.id))), [main, done]);
  const steps = useMemo(() => filingSteps(sameCase ? c : { ...c, progress: { completed: [] } }, result), [sameCase, c, result]);
  const filing = live.some((t) => t.id === "inheritance-tax");

  const docs: DocItem[] = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of live) for (const id of t.docs) if (DOCS[id]) m.set(id, [...(m.get(id) ?? []), t]);
    // 口座・土地ごとの書類：同じ種類の財産が2件以上あるときは、全部に書類がそろうまで「そろった」にしない
    // （2行のうち1行だけ読み取ったときに、もう1行が収集案内から消えないように）
    const assets = sameCase ? c.assets : [];
    return [...m.entries()].map(([id, used]) => ({
      id,
      used,
      done: done.includes(`doc:${id}`) && assetsMissingDoc(id, assets, done).length === 0,
      na: done.includes(naId(`doc:${id}`)),
    }));
  }, [live, done, sameCase, c.assets]);

  const liveDocs = docs.filter((d) => !d.na);
  const doneTasks = live.filter((t) => done.includes(t.id)).length;
  const doneSteps = filing ? steps.filter((s) => s.done).length : 0;
  const doneDocs = liveDocs.filter((d) => d.done).length;
  const total = live.length + (filing ? steps.length : 0) + liveDocs.length;
  const finished = doneTasks + doneSteps + doneDocs;
  const pct = total ? Math.round((finished / total) * 100) : 0;
  const now = todayISO();
  const next = main.find((t) => !closed(t.id));

  const byCategory = useMemo(() => {
    const m = new Map<DocCategory, DocItem[]>();
    for (const d of docs) {
      const k = DOCS[d.id].category;
      m.set(k, [...(m.get(k) ?? []), d]);
    }
    return m;
  }, [docs]);

  return { ...plan, done, autoDone, statusOf, iv, closed, live, valid, est, precise, verdict, tasks, main, steps, filing, docs, byCategory, doneTasks, doneSteps, doneDocs, total, finished, pct, now, next, case: c, result };
}

/**
 * 聞き取りが済んでいない（または亡くなった日がない）ときは、マイページのトップへ戻す。
 * 描画中に画面を移動しないよう、移動は effect で行う。戻り値が true のときだけ中身を表示する。
 */
export function useRequireHearing(o: { loaded: boolean; heard: boolean; valid: boolean }): boolean {
  const router = useRouter();
  const ready = o.loaded && o.heard && o.valid;
  const leave = o.loaded && !ready;
  useEffect(() => {
    if (leave) router.replace("/my");
  }, [leave, router]);
  return ready;
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
  if (!iv.homeValue && !iv.otherRealEstate && hasRealEstate(c.assets)) next.otherRealEstate = 1;
  return next;
}
