"use client";

import Link from "next/link";
import { useState } from "react";
import { MilestoneView } from "@/components/my/MilestoneView";
import { MonthCalendar } from "@/components/plan/MonthCalendar";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { Panel } from "@/components/ui/Panel";
import { icsStamp, toICS } from "@/domain/procedures/calendar";
import { jpDate } from "@/domain/procedures/dates";
import { encodeInterview } from "@/domain/procedures/share";
import { saveBlob } from "@/lib/download";
import { naId } from "@/lib/planStore";
import { useOverall } from "@/lib/overall";
import { daysLeftLabel } from "@/lib/taskStatus";

type View = "steps" | "month";
/** このブラウザだけで覚える（アカウントには保存しない） */
const VIEW_KEY = "souzoku-compass-calendar-view";

/**
 * 「手続きごと」「月ごと」のどちらで見るか。覚えられないブラウザでも「手続きごと」で表示する。
 * 覚えた表示は最初の描画から使う（画面を移ってきたときに、一瞬「手続きごと」が見えないように）。
 * サーバーと最初の描画は記録を読み込むまで中身を出さないので、サーバーとの食い違いは起きない
 */
function useCalendarView(): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem(VIEW_KEY) === "month" ? "month" : "steps";
    } catch {
      // 保存領域が使えないときは「手続きごと」
      return "steps";
    }
  });
  const choose = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // 覚えられなくても、表示は切り替える
    }
  };
  return [view, choose];
}

export function ViewSwitch({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const opts: [View, string][] = [
    ["steps", "手続きごと"],
    ["month", "月ごと"],
  ];
  return (
    <div className="mb-4 inline-flex rounded-full bg-stone-100 p-1" role="group" aria-label="カレンダーの表示">
      {opts.map(([v, label]) => (
        <button
          key={v}
          type="button"
          aria-pressed={view === v}
          onClick={() => onChange(v)}
          className={`min-h-10 touch-manipulation rounded-full px-4 text-sm font-semibold transition ${view === v ? "bg-white text-sky-900 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function CalendarPage() {
  const o = useOverall();
  const [view, setView] = useCalendarView();
  if (!o.loaded) return <AppShell>{null}</AppShell>;
  if (!o.heard || !o.valid)
    return (
      <AppShell>
        <PageHead title="カレンダー" say="まず、質問に答えてくださいね。手続きの期限をカレンダーに並べます。" />
        <Link href="/my/hearing" className="rounded-full bg-sky-700 px-6 py-3 font-bold text-white">
          質問に答える ›
        </Link>
      </AppShell>
    );

  const host = window.location.host;
  // 購読するカレンダーにも画面と同じ手続きが載るよう、評価した結果の判定と「不要」にした手続きも渡す
  const skip = o.main.filter((t) => o.done.includes(naId(t.id))).map((t) => t.id);
  const feedPath = `/api/calendar?d=${encodeInterview(o.iv, { verdict: o.verdict, skip })}`;
  const googleSubscribe = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(`webcal://${host}${feedPath}`)}`;
  const appleSubscribe = `webcal://${host}${feedPath}`;
  function downloadICS() {
    const ics = toICS(o.live, { name: "相続の手続き（相続コンパス）", stamp: icsStamp(), appUrl: `${window.location.origin}/my` });
    saveBlob(new Blob([ics], { type: "text/calendar" }), "souzoku-tetsuzuki.ics");
  }
  const upcoming = o.main.filter((t) => !o.closed(t.id) && t.date >= o.now).slice(0, 6);
  const overdue = o.main.filter((t) => !o.closed(t.id) && t.date < o.now);

  return (
    <AppShell wide>
      <PageHead title="カレンダー" say="手続きの期限と目安の日を、手続きごと・月ごとに並べました。オレンジは法律上の期限がある日です。" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="rounded-2xl border border-sky-100 bg-white p-4 shadow-sm sm:p-5">
          <ViewSwitch view={view} onChange={setView} />
          {view === "month" ? <MonthCalendar tasks={o.live} done={o.done} today={o.now} /> : <MilestoneView tasks={o.live} done={o.done} today={o.now} death={o.iv.deathDate} />}
          <p className="mt-3 flex flex-wrap gap-4 text-xs text-stone-500">
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-orange-500" />
              期限（法律で決まっている）
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-500" />
              目安
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />
              完了
            </span>
          </p>
        </section>
        <div className="space-y-5">
          <Panel title="これからの予定">
            {overdue.length > 0 && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">日付を過ぎた手続きが{overdue.length}件あります。</p>}
            <ul className="space-y-2 text-sm">
              {upcoming.map((t) => (
                <li key={t.id}>
                  <Link href={`/my/tasks?id=${t.id}`} className="block rounded-lg px-2 py-1 hover:bg-stone-50">
                    <span className={`text-xs font-semibold ${t.hard ? "text-orange-700" : "text-stone-500"}`}>
                      {jpDate(t.date)}（{daysLeftLabel(o.now, t.date)}）
                    </span>
                    <span className="block font-semibold text-stone-800">{t.title}</span>
                  </Link>
                </li>
              ))}
              {upcoming.length === 0 && <li className="text-stone-500">これからの予定はありません。</li>}
            </ul>
          </Panel>
          <Panel title="いつものカレンダーに入れる">
            <p className="text-sm text-stone-600">{o.live.length}件の手続きをまとめて追加します。期限のあるものは1週間前と前日に通知します。</p>
            <div className="mt-3 flex flex-col gap-2">
              <a href={googleSubscribe} target="_blank" rel="noreferrer" className="rounded-lg bg-sky-700 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-sky-800">
                Googleカレンダーにまとめて追加
              </a>
              <a href={appleSubscribe} className="rounded-lg border border-stone-300 px-4 py-2 text-center text-sm font-semibold hover:bg-stone-50">
                iPhone・Macのカレンダーに追加
              </a>
              <button type="button" onClick={downloadICS} className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold hover:bg-stone-50">
                Outlookなどほかのカレンダーに追加（ファイルを保存）
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-stone-500">相続の手続き専用のカレンダーとして追加されます。あとから質問の答えを変えたり、手続きを「不要」にしたりしたときは、追加し直してください。</p>
          </Panel>
        </div>
      </div>
      <p className="mt-4 text-xs text-stone-500">期限は亡くなった日を起算日として計算しています。法律上の期限が土日祝日・年末年始にあたる場合は、次の平日にしています。</p>
    </AppShell>
  );
}
