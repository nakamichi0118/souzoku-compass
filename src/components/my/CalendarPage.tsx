"use client";

import Link from "next/link";
import { useState } from "react";
import { MilestoneFlow, MilestoneView } from "@/components/my/MilestoneView";
import { AUTO_DONE_NOTE } from "@/components/my/StatusButtons";
import { docsToUpload, UploadPrompt } from "@/components/my/UploadPrompt";
import { MonthCalendar } from "@/components/plan/MonthCalendar";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { Panel } from "@/components/ui/Panel";
import { icsStamp, toICS } from "@/domain/procedures/calendar";
import { encodeInterview } from "@/domain/procedures/share";
import { saveBlob } from "@/lib/download";
import { naId, type ItemStatus } from "@/lib/planStore";
import { useOverall } from "@/lib/overall";

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
  // 手続きを済ませたときに出す、届いた書類のアップロードの案内（やることリストと同じ）
  const [prompt, setPrompt] = useState<{ docs: string[]; open: boolean } | null>(null);
  if (!o.loaded) return <AppShell>{null}</AppShell>;
  if (!o.heard || !o.valid)
    return (
      <AppShell>
        <PageHead title="カレンダー" say="質問に答えると、期限がここに並びます。" />
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
  const mark = (id: string, v: ItemStatus) => {
    o.setStatus(id, v);
    const task = o.main.find((t) => t.id === id);
    const docs = v === "done" && task ? docsToUpload(task, o.done) : [];
    setPrompt(docs.length ? { docs, open: false } : null);
  };
  const locked = (id: string) => (o.autoDone.includes(id) ? AUTO_DONE_NOTE : undefined);
  const overdue = o.main.filter((t) => !o.closed(t.id) && t.date < o.now);

  return (
    <AppShell wide>
      <PageHead title="カレンダー" say="オレンジは法律で決まった期限です。" />
      {/* パソコンでは、亡くなった日からの期限の流れを上に出す（どちらの表示でも同じ） */}
      <section aria-label="手続きの流れ" className="mb-5 hidden rounded-2xl border border-sky-100 bg-white px-3 pb-2 pt-3 shadow-sm lg:block">
        <h2 className="mb-1 px-1 text-sm font-bold text-stone-700">手続きの流れ</h2>
        <MilestoneFlow tasks={o.main} done={o.done} today={o.now} death={o.iv.deathDate} />
      </section>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="rounded-2xl border border-sky-100 bg-white p-4 shadow-sm sm:p-5">
          <ViewSwitch view={view} onChange={setView} />
          {/* これからの予定は下のリストと同じなので、日付を過ぎた手続きの知らせだけをリストの上に出す */}
          {overdue.length > 0 && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">日付を過ぎた手続きが{overdue.length}件あります。</p>}
          {view === "month" ? <MonthCalendar tasks={o.live} done={o.done} today={o.now} /> : <MilestoneView tasks={o.main} done={o.done} today={o.now} death={o.iv.deathDate} onMark={mark} locked={locked} />}
          <p className="mt-3 flex flex-wrap gap-4 text-xs text-stone-500">
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-orange-500" />
              期限（法律）
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-500" />
              目安
            </span>
            <span>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-stone-300" />
              完了・不要
            </span>
          </p>
        </section>
        <div className="space-y-5">
          <Panel title="いつものカレンダーに入れる">
            <p className="text-sm text-stone-600">{o.live.length}件をまとめて追加し、期限の1週間前と前日に通知します。</p>
            <div className="mt-3 flex flex-col gap-2">
              <a href={googleSubscribe} target="_blank" rel="noreferrer" className="rounded-lg bg-sky-700 px-4 py-2 text-center text-sm font-semibold text-white hover:bg-sky-800">
                Googleカレンダーに追加
              </a>
              <a href={appleSubscribe} className="rounded-lg border border-stone-300 px-4 py-2 text-center text-sm font-semibold hover:bg-stone-50">
                iPhone・Macに追加
              </a>
              <button type="button" onClick={downloadICS} className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold hover:bg-stone-50">
                Outlook・その他（ファイルを保存）
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-stone-500">答えを変えたり「不要」にしたりしたら、追加し直してください。</p>
          </Panel>
        </div>
      </div>
      <p className="mt-4 text-xs text-stone-500">期限は亡くなった日から数えています（土日祝・年末年始なら次の平日）。</p>
      {prompt && <UploadPrompt docs={prompt.docs} open={prompt.open} onOpen={() => setPrompt({ ...prompt, open: true })} onClose={() => setPrompt(null)} onRegistered={(d) => o.setStatus(`doc:${d}`, "done")} />}
    </AppShell>
  );
}
