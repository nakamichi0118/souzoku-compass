"use client";

import Link from "next/link";
import { MonthCalendar } from "@/components/plan/MonthCalendar";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { toICS } from "@/domain/procedures/calendar";
import { daysBetween, jpDate } from "@/domain/procedures/dates";
import { encodeInterview } from "@/domain/procedures/share";
import { useOverall } from "@/lib/overall";
import { Panel } from "./Home";

export function CalendarPage() {
  const o = useOverall();
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
  const feedPath = `/api/calendar?d=${encodeInterview(o.iv)}`;
  const googleSubscribe = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(`webcal://${host}${feedPath}`)}`;
  const appleSubscribe = `webcal://${host}${feedPath}`;
  function downloadICS() {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const ics = toICS(o.live, { name: "相続の手続き（相続コンパス）", stamp, appUrl: `${window.location.origin}/my` });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "souzoku-tetsuzuki.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const upcoming = o.main.filter((t) => !o.closed(t.id) && t.date >= o.now).slice(0, 6);
  const overdue = o.main.filter((t) => !o.closed(t.id) && t.date < o.now);

  return (
    <AppShell wide>
      <PageHead title="カレンダー" say="手続きの期限と目安の日を、月ごとに並べました。オレンジは法律上の期限がある日です。" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="rounded-2xl border border-sky-100 bg-white p-4 shadow-sm sm:p-5">
          <MonthCalendar tasks={o.live} done={o.done} today={o.now} />
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
                      {jpDate(t.date)}（あと{daysBetween(o.now, t.date)}日）
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
                ファイル（.ics）をダウンロード
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-stone-500">相続の手続き専用のカレンダーとして追加されます。追加用のURLには亡くなった日と答えの内容（お名前・住所は除く）が含まれます。</p>
          </Panel>
        </div>
      </div>
      <p className="mt-4 text-xs text-stone-500">期限は亡くなった日を起算日として計算しています。法律上の期限が土日祝日・年末年始にあたる場合は、次の平日にしています。</p>
    </AppShell>
  );
}
