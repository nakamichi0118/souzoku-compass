import { daysBetween } from "@/domain/procedures/dates";
import type { Task } from "@/domain/procedures/rules";
import type { ItemStatus } from "./planStore";

/** 一覧の行につける状態の札（完了・不要・超過・期限あり・未着手） */
export function taskStatus(t: Task, st: ItemStatus, now: string) {
  if (st === "na") return { label: "不要", cls: "bg-stone-200 text-stone-600" };
  if (st === "done") return { label: "✓ 完了", cls: "bg-emerald-100 text-emerald-800" };
  const left = daysBetween(now, t.date);
  if (left < 0) return { label: `${-left}日超過`, cls: "bg-rose-100 text-rose-800" };
  if (t.hard) return { label: "期限あり", cls: "bg-orange-100 text-orange-800" };
  return { label: "未着手", cls: "bg-stone-100 text-stone-600" };
}

/** 「あと3日」「今日です」「2日過ぎています」 */
export function daysLeftLabel(now: string, date: string): string {
  const left = daysBetween(now, date);
  return left < 0 ? `${-left}日過ぎています` : left === 0 ? "今日です" : `あと${left}日`;
}
