import { Check } from "lucide-react";
import Link from "next/link";
import { Fragment } from "react";
import { jpDate, yearOf } from "@/domain/procedures/dates";
import { buildTimeline, type Entry, type Milestone, type Stop } from "@/domain/procedures/milestones";
import type { Task } from "@/domain/procedures/rules";
import { daysLeftLabel } from "@/lib/taskStatus";

/** 「11月15日（日）」（年は別に出す） */
const monthDay = (d: string) => jpDate(d).replace(/^\d+年/, "");
/** まとまりの区切りと同じ年なら「3月18日」、違う年なら「2027年3月15日」 */
const shortDate = (d: string, year: number) => `${yearOf(d) === year ? "" : `${yearOf(d)}年`}${Number(d.slice(5, 7))}月${Number(d.slice(8))}日`;
const href = (id: string) => `/my/tasks?id=${id}`;

/** 期限（マイルストーン）ごとに、その日と、それまでにする手続きを並べる */
export function MilestoneView({ tasks, done, today, death }: { tasks: Task[]; done: string[]; today: string; death: string }) {
  const tl = buildTimeline(tasks, { death, today, done });
  const flat = tl.stops.flatMap((s) => s.milestones);
  const todayIndex = tl.todayAt < tl.stops.length ? flat.indexOf(tl.stops[tl.todayAt].milestones[0]) : flat.length;
  const lastYear = yearOf(tl.stops[tl.stops.length - 1].date);

  return (
    <div>
      {/* パソコンでは、上に期限を横に並べる（入りきらなければ折り返す） */}
      <ol className="mb-5 hidden flex-wrap gap-2 lg:flex">
        {flat.map((m, i) => (
          <Fragment key={m.id}>
            {i === todayIndex && <TodayMark today={today} />}
            <li className="w-[9.5rem]">
              <Box m={m} today={today} />
            </li>
          </Fragment>
        ))}
        {todayIndex === flat.length && <TodayMark today={today} />}
      </ol>

      <div className="relative">
        <span aria-hidden className="absolute bottom-4 left-[7px] top-4 w-0.5 rounded bg-stone-200" />
        <ol className="relative space-y-1">
          {tl.stops.map((s, i) => (
            <Fragment key={s.date}>
              {i === tl.todayAt && <TodayRow today={today} />}
              {s.milestones.map((m) => (
                <MilestoneRow key={m.id} m={m} today={today} />
              ))}
              {s.tasks.length > 0 && <Entries items={s.tasks} caption={i === 0 ? undefined : caption(s)} year={yearOf(s.date)} past={i < tl.todayAt} />}
            </Fragment>
          ))}
          {tl.todayAt === tl.stops.length && <TodayRow today={today} />}
          {tl.after.length > 0 && (
            <>
              <li className="relative pl-8">
                <span aria-hidden className="absolute left-[3px] top-3 h-2.5 w-2.5 rounded-full border-2 border-stone-400 bg-white" />
                <p className="py-1.5 font-bold text-stone-700">そのあと</p>
              </li>
              <Entries items={tl.after} year={lastYear} past={tl.todayAt > tl.stops.length} />
            </>
          )}
          {tl.todayAt > tl.stops.length && <TodayRow today={today} />}
        </ol>
      </div>
    </div>
  );
}

const caption = (s: Stop) => (s.milestones.every((m) => m.kind === "aim") ? "この日までにすること" : "この期限までにすること");

function Dot({ m }: { m: Milestone }) {
  const color = m.state === "done" ? "bg-emerald-500" : m.kind === "start" ? "bg-stone-400" : m.kind === "aim" ? "bg-sky-500" : "bg-orange-500";
  return (
    <span aria-hidden className={`absolute left-0 top-2.5 grid h-4 w-4 place-items-center rounded-full ring-4 ${m.next ? "ring-orange-200" : "ring-white"} ${color}`}>
      {m.state === "done" && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
    </span>
  );
}

function State({ m, today }: { m: Milestone; today: string }) {
  if (m.state === "start") return null;
  if (m.state === "done")
    return (
      <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-2 text-xs font-semibold leading-5 text-emerald-800">
        <Check className="h-3 w-3" aria-hidden strokeWidth={3} />
        完了
      </span>
    );
  if (m.state === "late") return <span className="rounded-full bg-rose-100 px-2 text-xs font-semibold leading-5 text-rose-800">{m.kind === "aim" ? "目安の日を過ぎています" : "期限を過ぎています"}</span>;
  return (
    <>
      <span className={`text-xs font-semibold ${m.next ? "text-orange-800" : "text-stone-600"}`}>{daysLeftLabel(today, m.date)}</span>
      {m.next && <span className="rounded-full bg-orange-600 px-2 text-xs font-bold leading-5 text-white">いちばん近い期限</span>}
    </>
  );
}

function MilestoneRow({ m, today }: { m: Milestone; today: string }) {
  const body = (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-bold text-stone-900">{m.name}</span>
        {m.kind === "aim" && <span className="rounded-full bg-sky-100 px-2 text-xs font-semibold text-sky-800">目安</span>}
        {m.period && <span className="text-xs text-stone-500">{m.period}</span>}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="tabular-nums text-stone-700">{jpDate(m.date)}</span>
        <State m={m} today={today} />
      </span>
    </>
  );
  return (
    <li className="relative pl-8">
      <Dot m={m} />
      {m.task ? (
        <Link href={href(m.id)} className={`-mx-2 block rounded-xl px-2 py-1.5 ${m.next ? "bg-orange-50 ring-1 ring-orange-300" : "hover:bg-stone-50"}`}>
          {body}
        </Link>
      ) : (
        <div className="py-1.5">{body}</div>
      )}
    </li>
  );
}

/**
 * 区切りの下に出す、それまでにする手続き。
 * 今日より前の区切りでは、済んだ手続きを「済んだ手続き（○件）」にたたむ（今日といちばん近い期限が、スマホでも早く見えるように）
 */
function Entries({ items, caption, year, past }: { items: Entry[]; caption?: string; year: number; past: boolean }) {
  const folded = past ? items.filter((e) => e.state === "done") : [];
  const shown = past ? items.filter((e) => e.state !== "done") : items;
  // 年のつく日付があるまとまりだけ、日付の欄を広くする（パソコン・タブレットで、手続きの名前の頭をそろえる）
  const wide = items.some((e) => yearOf(e.task.date) !== year);
  return (
    <li className="pb-2 pl-8">
      <div className="rounded-xl bg-stone-50 px-3 py-2">
        {caption && shown.length > 0 && <p className="text-xs text-stone-500">{caption}</p>}
        {shown.length > 0 && <Rows items={shown} year={year} wide={wide} />}
        {folded.length > 0 && (
          <details>
            <summary className="-mx-1.5 cursor-pointer rounded-lg px-1.5 py-2.5 text-sm text-stone-600 hover:bg-white">済んだ手続き（{folded.length}件）</summary>
            <Rows items={folded} year={year} wide={wide} />
          </details>
        )}
      </div>
    </li>
  );
}

function Rows({ items, year, wide }: { items: Entry[]; year: number; wide: boolean }) {
  return (
    <ul className="mt-0.5 space-y-1">
      {items.map(({ task: t, state }) => (
        <li key={t.id}>
          <Link href={href(t.id)} className="-mx-1.5 flex items-start gap-2 rounded-lg px-1.5 py-1.5 text-sm hover:bg-white">
            {state === "done" ? (
              <Check className="h-4 w-4 shrink-0 text-emerald-600 sm:mt-0.5" aria-hidden strokeWidth={3} />
            ) : (
              <span aria-hidden className={`mx-1 mt-1 h-2 w-2 shrink-0 rounded-full sm:mt-1.5 ${t.hard ? "bg-orange-500" : "bg-sky-500"}`} />
            )}
            {/* スマホでは日付を名前の上に小さく出して、名前に幅をとる。広い画面では日付を決まった幅の欄にする */}
            <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:gap-2">
              <span className={`shrink-0 whitespace-nowrap text-xs tabular-nums sm:text-sm ${wide ? "sm:min-w-[8.5em]" : "sm:min-w-[5em]"} ${state === "late" ? "font-semibold text-rose-700" : "text-stone-500"}`}>{shortDate(t.date, year)}</span>
              <span className={`min-w-0 ${state === "done" ? "text-stone-400 line-through" : "text-stone-800"}`}>
                {t.title}
                {state === "done" && <span className="sr-only">（完了）</span>}
                {state === "late" && <span className="ml-1.5 whitespace-nowrap rounded-full bg-rose-100 px-1.5 text-[11px] font-semibold text-rose-800">過ぎています</span>}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function TodayRow({ today }: { today: string }) {
  return (
    <li className="relative flex items-center gap-2 py-1 pl-8">
      <span aria-hidden className="absolute left-[3px] h-2.5 w-2.5 rounded-full bg-sky-700 ring-4 ring-sky-100" />
      <span className="shrink-0 rounded-full bg-sky-700 px-2.5 py-0.5 text-xs font-bold text-white">今日 {jpDate(today)}</span>
      <span aria-hidden className="flex-1 border-t-2 border-dashed border-sky-200" />
    </li>
  );
}

/** パソコンの横の並びの、期限の箱 */
function Box({ m, today }: { m: Milestone; today: string }) {
  const top = m.state === "done" ? "border-t-emerald-500" : m.kind === "start" ? "border-t-stone-400" : m.kind === "aim" ? "border-t-sky-500" : "border-t-orange-500";
  const state =
    m.state === "start" ? null : m.state === "done" ? (
      <span className="inline-flex items-center gap-0.5 font-semibold text-emerald-700">
        <Check className="h-3 w-3" aria-hidden strokeWidth={3} />
        完了
      </span>
    ) : m.state === "late" ? (
      <span className="font-semibold text-rose-700">過ぎています</span>
    ) : (
      <span className={m.next ? "font-bold text-orange-800" : "text-stone-600"}>{daysLeftLabel(today, m.date)}</span>
    );
  const body = (
    <>
      <span className="text-sm font-bold leading-snug text-stone-900">{m.name}</span>
      {(m.period || m.kind === "aim") && (
        <span className="text-xs text-stone-500">
          {m.kind === "aim" && <span className="mr-1 font-semibold text-sky-800">目安</span>}
          {m.period}
        </span>
      )}
      <span className="mt-auto pt-1 text-[11px] leading-4 text-stone-500">{yearOf(m.date)}年</span>
      <span className="text-sm font-bold tabular-nums text-stone-800">{monthDay(m.date)}</span>
      {state && <span className="text-[11px] leading-4">{state}</span>}
    </>
  );
  const cls = `flex h-full flex-col rounded-xl border border-t-4 border-stone-200 px-2.5 py-2 ${top} ${m.next ? "bg-orange-50 ring-2 ring-orange-400" : m.state === "done" ? "bg-emerald-50/60" : "bg-white"}`;
  return m.task ? (
    <Link href={href(m.id)} className={m.next ? cls : `${cls} hover:bg-stone-50`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function TodayMark({ today }: { today: string }) {
  return (
    <li className="flex w-8 flex-col items-center gap-1">
      <span className="rounded bg-sky-700 px-1 text-[11px] font-bold leading-4 text-white">
        今日<span className="sr-only"> {jpDate(today)}</span>
      </span>
      <span aria-hidden className="w-0.5 flex-1 rounded bg-sky-700" />
    </li>
  );
}
