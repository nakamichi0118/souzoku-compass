import { daysBetween } from "@/domain/procedures/dates";
import type { Task } from "@/domain/procedures/rules";
import type { ItemStatus } from "./planStore";

/** 一覧の行につける状態の札（完了・不要・超過・期限あり・未着手） */
export function taskStatus(t: Task, st: ItemStatus, now: string) {
  if (st === "na") return { label: "不要", cls: "bg-stone-200 text-stone-600" };
  // 済んだものは緑ではなくグレーで見せる
  if (st === "done") return { label: "✓ 完了", cls: "bg-stone-100 text-stone-500" };
  const left = daysBetween(now, t.date);
  if (left < 0) return { label: `${-left}日超過`, cls: "bg-rose-100 text-rose-800" };
  if (t.hard) return { label: "期限あり", cls: "bg-orange-100 text-orange-800" };
  return { label: "未着手", cls: "bg-stone-100 text-stone-600" };
}

/**
 * やることリストの行に出す札。期限を過ぎたときの「3日超過」だけを出し、それ以外は null
 * （済んだかどうかはチェックと取り消し線、期限があるかは日付で分かるので、札は出さない）
 */
export function lateBadge(t: Task, st: ItemStatus, now: string) {
  return st === "open" && daysBetween(now, t.date) < 0 ? taskStatus(t, st, now) : null;
}

/** 「あと3日」「今日です」「2日過ぎています」 */
export function daysLeftLabel(now: string, date: string): string {
  const left = daysBetween(now, date);
  return left < 0 ? `${-left}日過ぎています` : left === 0 ? "今日です" : `あと${left}日`;
}
