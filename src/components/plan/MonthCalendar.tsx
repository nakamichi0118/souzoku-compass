"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Task } from "@/domain/procedures/rules";

const WEEK = ["月", "火", "水", "木", "金", "土", "日"];
const pad = (n: number) => String(n).padStart(2, "0");

/** 手続きの期限・目安の日を載せた月表示のカレンダー */
export function MonthCalendar({ tasks, done, today, compact }: { tasks: Task[]; done: string[]; today: string; compact?: boolean }) {
  const [ym, setYm] = useState<[number, number]>([Number(today.slice(0, 4)), Number(today.slice(5, 7))]);
  const [sel, setSel] = useState<string | null>(null);
  const [y, m] = ym;
  const byDate = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const t of tasks) map.set(t.date, [...(map.get(t.date) ?? []), t]);
    return map;
  }, [tasks]);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // 月曜はじまり
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${y}-${pad(m)}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  const move = (d: number) => {
    const nm = m + d;
    setYm([y + Math.floor((nm - 1) / 12), ((nm - 1 + 120) % 12) + 1]);
    setSel(null);
  };
  const monthTasks = tasks.filter((t) => t.date.startsWith(`${y}-${pad(m)}`));
  const list = sel ? (byDate.get(sel) ?? []) : monthTasks;

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => move(-1)} className="grid h-10 w-10 place-items-center rounded-full text-stone-500 hover:bg-stone-100" aria-label="前の月">
          ‹
        </button>
        <p className="font-bold text-stone-800">
          {y}年 {m}月
        </p>
        <button type="button" onClick={() => move(1)} className="grid h-10 w-10 place-items-center rounded-full text-stone-500 hover:bg-stone-100" aria-label="次の月">
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 text-center text-xs">
        {WEEK.map((w, i) => (
          <div key={w} className={`py-1 font-semibold ${i === 5 ? "text-sky-600" : i === 6 ? "text-rose-600" : "text-stone-500"}`}>
            {w}
          </div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const ts = byDate.get(d) ?? [];
          const open = ts.filter((t) => !done.includes(t.id));
          const hard = open.some((t) => t.hard);
          const isToday = d === today;
          return (
            <button
              type="button"
              key={d}
              onClick={() => setSel(sel === d ? null : d)}
              className={`relative flex flex-col items-center rounded-lg ${compact ? "py-1" : "min-h-12 p-1 sm:min-h-20"} ${sel === d ? "bg-sky-100" : "hover:bg-stone-50"}`}
            >
              <span
                className={`grid h-7 w-7 place-items-center rounded-full text-sm ${isToday ? "bg-sky-700 font-bold text-white" : open.length ? (hard ? "bg-orange-100 font-bold text-orange-800" : "bg-sky-50 font-bold text-sky-800") : i % 7 === 6 ? "text-rose-600" : i % 7 === 5 ? "text-sky-600" : "text-stone-700"}`}
              >
                {Number(d.slice(8))}
              </span>
              {/* 手続きの名前は、幅のある画面だけに出す（スマホでは1文字しか入らないので、点だけにする） */}
              {!compact && (
                <span className="mt-0.5 hidden w-full space-y-0.5 text-left sm:block">
                  {ts.slice(0, 2).map((t) => (
                    <span key={t.id} className={`block truncate rounded px-1 text-[10px] leading-4 ${done.includes(t.id) ? "bg-stone-100 text-stone-400 line-through" : t.hard ? "bg-orange-100 text-orange-900" : "bg-sky-50 text-sky-900"}`}>
                      {t.title}
                    </span>
                  ))}
                  {ts.length > 2 && <span className="block text-[10px] text-stone-500">ほか{ts.length - 2}件</span>}
                </span>
              )}
              {ts.length > 0 && <span className={`absolute h-1 w-1 rounded-full ${compact ? "bottom-0" : "bottom-1.5 sm:hidden"} ${open.length === 0 ? "bg-stone-300" : hard ? "bg-orange-500" : "bg-sky-500"}`} />}
            </button>
          );
        })}
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {list.length === 0 && <li className="text-stone-500">{sel ? "この日の予定はありません。" : "この月の予定はありません。"}</li>}
        {list.slice(0, compact ? 4 : 50).map((t) => (
          <li key={t.id}>
            <Link href={`/my/tasks?id=${t.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-stone-50">
              <span className={`h-2 w-2 shrink-0 rounded-full ${done.includes(t.id) ? "bg-stone-300" : t.hard ? "bg-orange-500" : "bg-sky-500"}`} />
              <span className="shrink-0 tabular-nums text-stone-500">
                {Number(t.date.slice(5, 7))}月{Number(t.date.slice(8))}日
              </span>
              <span className={`truncate ${done.includes(t.id) ? "text-stone-400 line-through" : "text-stone-800"}`}>
                {t.title}
                {t.hard ? "（期限）" : ""}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
