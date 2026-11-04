"use client";

import { Check, Minus } from "lucide-react";
import Link from "next/link";
import { Fragment, useState } from "react";
import { jpDate, yearOf } from "@/domain/procedures/dates";
import { buildTimeline, type Entry, type EntryState, type Milestone, type Stop } from "@/domain/procedures/milestones";
import type { Task } from "@/domain/procedures/rules";
import { naId, type ItemStatus } from "@/lib/planStore";
import { daysLeftLabel } from "@/lib/taskStatus";
import { RowStatus } from "./StatusButtons";

/** 「11月15日」と曜日（年は別に出す） */
const monthDay = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8))}日`;
const weekday = (d: string) => jpDate(d).match(/（.）$/)?.[0] ?? "";
/** まとまりの区切りと同じ年なら「3月18日」、違う年なら「2027年3月15日」 */
const shortDate = (d: string, year: number) => `${yearOf(d) === year ? "" : `${yearOf(d)}年`}${monthDay(d)}`;
const href = (id: string) => `/my/tasks?id=${id}`;
const isClosed = (s: EntryState | "start") => s === "done" || s === "na";

/** やることリストと同じ記録（完了は手続きの id、不要は na: をつけた id）から、手続きを区切りごとに分ける */
function timeline(tasks: Task[], done: string[], today: string, death: string) {
  const na = tasks.filter((t) => done.includes(naId(t.id))).map((t) => t.id);
  return buildTimeline(tasks, { death, today, done, na });
}
const statusOf = (s: EntryState): ItemStatus => (s === "done" ? "done" : s === "na" ? "na" : "open");

type Mark = (id: string, v: ItemStatus) => void;
type Locked = (id: string) => string | undefined;

/**
 * 期限（マイルストーン）ごとに、その日と、それまでにする手続きを縦に並べる。
 * 手続きごとに、やることリストと同じ「完了」のチェックと「不要」を付けられる
 */
export function MilestoneView({ tasks, done, today, death, onMark, locked }: { tasks: Task[]; done: string[]; today: string; death: string; onMark: Mark; locked?: Locked }) {
  const tl = timeline(tasks, done, today, death);
  const lastYear = yearOf(tl.stops[tl.stops.length - 1].date);
  // 開いたときに済んでいた（不要にした）手続きだけをたたむ。この画面で済ませた手続きは、その場にグレーで残す
  // この画面で付け外しした手続きは、それからはたたまない（チェックし直した行が、閉じたまとまりの中に消えないように）
  const [foldable, setFoldable] = useState(() => new Set(tasks.filter((t) => done.includes(t.id) || done.includes(naId(t.id))).map((t) => t.id)));
  const mark: Mark = (id, v) => {
    if (foldable.has(id))
      setFoldable((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    onMark(id, v);
  };
  const row = { onMark: mark, locked, foldable };
  // 今日より前の区切りで、区切りの手続きもその下の手続きも開いたときに済んでいた（不要にした）ものは、
  // 続いた区切りごと1つの「済んだ手続き（○件）」にたたむ（スマホでも、今日の線が最初の画面に入るように）。亡くなった日はたたまない
  const shut = (id: string, s: EntryState | "start") => isClosed(s) && foldable.has(id);
  const closedStop = (s: Stop, i: number) => i > 0 && i < tl.todayAt && s.milestones.every((m) => shut(m.id, m.state)) && s.tasks.every((e) => shut(e.task.id, e.state));
  const parts: ({ fold: Stop[] } | { stop: Stop; i: number })[] = [];
  tl.stops.forEach((s, i) => {
    const last = parts.at(-1);
    if (!closedStop(s, i)) parts.push({ stop: s, i });
    else if (last && "fold" in last) last.fold.push(s);
    else parts.push({ fold: [s] });
  });

  return (
    <div className="relative">
      <span aria-hidden className="absolute bottom-4 left-[7px] top-4 w-0.5 rounded bg-stone-200" />
      <ol className="relative space-y-1">
        {parts.map((p) =>
          "fold" in p ? (
            <FoldedStops key={`fold-${p.fold[0].date}`} stops={p.fold} today={today} {...row} />
          ) : (
            <Fragment key={p.stop.date}>
              {p.i === tl.todayAt && <TodayRow today={today} />}
              {p.stop.milestones.map((m) => (
                <MilestoneRow key={m.id} m={m} today={today} {...row} />
              ))}
              {p.stop.tasks.length > 0 && <Entries items={p.stop.tasks} caption={p.i === 0 ? undefined : caption(p.stop)} year={yearOf(p.stop.date)} past={p.i < tl.todayAt} {...row} />}
            </Fragment>
          ),
        )}
        {tl.todayAt === tl.stops.length && <TodayRow today={today} />}
        {tl.after.length > 0 && (
          <>
            <li className="relative pl-8">
              <span aria-hidden className="absolute left-[3px] top-3 h-2.5 w-2.5 rounded-full border-2 border-stone-400 bg-white" />
              <p className="py-1.5 font-bold text-stone-700">そのあと</p>
            </li>
            <Entries items={tl.after} year={lastYear} past={tl.todayAt > tl.stops.length} {...row} />
          </>
        )}
        {tl.todayAt > tl.stops.length && <TodayRow today={today} />}
      </ol>
    </div>
  );
}

const caption = (s: Stop) => (s.milestones.every((m) => m.kind === "aim") ? "この日までにすること" : "この期限までにすること");

/** 縦の線の上の点。済んだ・不要にした区切りはグレー */
function Dot({ m }: { m: Milestone }) {
  const color = isClosed(m.state) ? "bg-stone-300" : m.kind === "start" ? "bg-stone-400" : m.kind === "aim" ? "bg-sky-500" : "bg-orange-500";
  return (
    <span aria-hidden className={`absolute left-0 top-3.5 grid h-4 w-4 place-items-center rounded-full ring-4 ${m.next ? "ring-orange-200" : "ring-white"} ${color}`}>
      {m.state === "done" && <Check className="h-3 w-3 text-white" strokeWidth={3} />}
    </span>
  );
}

/** 済んだ・不要にしたことを示す、グレーの小さな印 */
function ClosedChip({ state }: { state: "done" | "na" }) {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-stone-100 px-2 text-xs font-semibold leading-5 text-stone-500">
      {state === "done" ? <Check className="h-3 w-3" aria-hidden strokeWidth={3} /> : <Minus className="h-3 w-3" aria-hidden strokeWidth={3} />}
      {state === "done" ? "完了" : "不要"}
    </span>
  );
}

function State({ m, today }: { m: Milestone; today: string }) {
  if (m.state === "start") return null;
  if (m.state === "done" || m.state === "na") return <ClosedChip state={m.state} />;
  if (m.state === "late") return <span className="rounded-full bg-rose-100 px-2 text-xs font-semibold leading-5 text-rose-800">{m.kind === "aim" ? "目安の日を過ぎています" : "期限を過ぎています"}</span>;
  return (
    <>
      <span className={`text-xs font-semibold ${m.next ? "text-orange-800" : "text-stone-600"}`}>{daysLeftLabel(today, m.date)}</span>
      {m.next && <span className="rounded-full bg-orange-600 px-2 text-xs font-bold leading-5 text-white">いちばん近い期限</span>}
    </>
  );
}

function MilestoneRow({ m, today, onMark, locked }: { m: Milestone; today: string; onMark: Mark; locked?: Locked }) {
  const closed = isClosed(m.state);
  const body = (
    <>
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span className={`font-bold ${closed ? "text-stone-400" : "text-stone-900"}`}>{m.name}</span>
        {m.kind === "aim" && <span className={`rounded-full px-2 text-xs font-semibold ${closed ? "bg-stone-100 text-stone-500" : "bg-sky-100 text-sky-800"}`}>目安</span>}
        {m.period && <span className="text-xs text-stone-500">{m.period}</span>}
      </span>
      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className={`tabular-nums ${closed ? "text-stone-400" : "text-stone-700"}`}>{jpDate(m.date)}</span>
        <State m={m} today={today} />
      </span>
    </>
  );
  if (!m.task)
    return (
      <li className="relative pl-8">
        <Dot m={m} />
        <div className="py-1.5">{body}</div>
      </li>
    );
  return (
    <li className="relative pl-8">
      <Dot m={m} />
      <div className={`-mx-2 flex items-start rounded-xl px-2${m.next ? " bg-orange-50 ring-1 ring-orange-300" : ""}`}>
        <span className="pt-1">
          <RowStatus status={statusOf(m.state as EntryState)} onChange={(v) => onMark(m.id, v)} label={m.task.title} locked={locked?.(m.id)} muted />
        </span>
        <Link href={href(m.id)} className={`-mr-2 block min-w-0 flex-1 rounded-xl py-1.5 pl-1 pr-2 ${m.next ? "" : "hover:bg-stone-50"}`}>
          {body}
        </Link>
      </div>
    </li>
  );
}

/** 今日より前の、すべて済んだ（不要にした）区切りをまとめた1行。開くと、区切りとその下の手続きをいつもどおりに出す */
function FoldedStops({ stops, today, onMark, locked, foldable }: { stops: Stop[]; today: string; onMark: Mark; locked?: Locked; foldable: Set<string> }) {
  const count = stops.reduce((n, s) => n + s.milestones.filter((m) => m.task).length + s.tasks.length, 0);
  const na = stops.some((s) => s.milestones.some((m) => m.state === "na") || s.tasks.some((e) => e.state === "na"));
  return (
    <li className="relative pb-2 pl-8">
      <span aria-hidden className="absolute left-0 top-3 grid h-4 w-4 place-items-center rounded-full bg-stone-300 ring-4 ring-white">
        <Check className="h-3 w-3 text-white" strokeWidth={3} />
      </span>
      <details>
        <summary className="cursor-pointer rounded-xl bg-stone-50 px-3 py-2.5 text-sm text-stone-600 hover:bg-stone-100">
          {na ? "済んだ・不要にした手続き" : "済んだ手続き"}（{count}件）
        </summary>
        <ol className="-ml-8 mt-1 space-y-1">
          {stops.map((s) => (
            <Fragment key={s.date}>
              {s.milestones.map((m) => (
                <MilestoneRow key={m.id} m={m} today={today} onMark={onMark} locked={locked} />
              ))}
              {s.tasks.length > 0 && <Entries items={s.tasks} year={yearOf(s.date)} past={false} onMark={onMark} locked={locked} foldable={foldable} />}
            </Fragment>
          ))}
        </ol>
      </details>
    </li>
  );
}

/**
 * 区切りの下に出す、それまでにする手続き。
 * 今日より前の区切りでは、開いたときに済んでいた（不要にした）手続きを「済んだ手続き（○件）」にたたむ
 * （今日といちばん近い期限が、スマホでも早く見えるように）
 */
function Entries({ items, caption, year, past, onMark, locked, foldable }: { items: Entry[]; caption?: string; year: number; past: boolean; onMark: Mark; locked?: Locked; foldable: Set<string> }) {
  const fold = (e: Entry) => past && isClosed(e.state) && foldable.has(e.task.id);
  const folded = items.filter(fold);
  const shown = items.filter((e) => !fold(e));
  // 年のつく日付があるまとまりだけ、日付の欄を広くする（パソコン・タブレットで、手続きの名前の頭をそろえる）
  const wide = items.some((e) => yearOf(e.task.date) !== year);
  const rows = { year, wide, onMark, locked };
  return (
    <li className="pb-2 pl-8">
      <div className="rounded-xl bg-stone-50 px-3 py-2">
        {caption && shown.length > 0 && <p className="text-xs text-stone-500">{caption}</p>}
        {shown.length > 0 && <Rows items={shown} {...rows} />}
        {folded.length > 0 && (
          <details>
            <summary className="-mx-1.5 cursor-pointer rounded-lg px-1.5 py-2.5 text-sm text-stone-600 hover:bg-white">
              {folded.some((e) => e.state === "na") ? "済んだ・不要にした手続き" : "済んだ手続き"}（{folded.length}件）
            </summary>
            <Rows items={folded} {...rows} />
          </details>
        )}
      </div>
    </li>
  );
}

function Rows({ items, year, wide, onMark, locked }: { items: Entry[]; year: number; wide: boolean; onMark: Mark; locked?: Locked }) {
  return (
    <ul className="mt-0.5 space-y-0.5">
      {items.map(({ task: t, state }) => {
        const closed = isClosed(state);
        return (
          <li key={t.id} className="flex items-start">
            <RowStatus status={statusOf(state)} onChange={(v) => onMark(t.id, v)} label={t.title} locked={locked?.(t.id)} muted />
            <Link href={href(t.id)} className="-mr-1.5 flex min-w-0 flex-1 items-start rounded-lg py-2 pl-1 pr-1.5 text-sm hover:bg-white">
              {/* スマホでは日付を名前の上に小さく出して、名前に幅をとる。広い画面では日付を決まった幅の欄にする */}
              <span className="flex min-w-0 flex-1 flex-col sm:flex-row sm:gap-2">
                <span className={`shrink-0 whitespace-nowrap text-xs tabular-nums sm:text-sm ${wide ? "sm:min-w-[8.5em]" : "sm:min-w-[5em]"} ${state === "late" ? "font-semibold text-rose-700" : closed ? "text-stone-400" : "text-stone-500"}`}>
                  {shortDate(t.date, year)}
                </span>
                <span className={`min-w-0 ${closed ? "text-stone-400 line-through" : "text-stone-800"}`}>
                  {t.title}
                  {state === "done" && <span className="sr-only">（完了）</span>}
                  {state === "na" && <span className="sr-only">（不要）</span>}
                  {state === "late" && <span className="ml-1.5 whitespace-nowrap rounded-full bg-rose-100 px-1.5 text-[11px] font-semibold text-rose-800">過ぎています</span>}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
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

type Col = { m: Milestone } | { today: string };

/**
 * 狭い画面で、今日のまわりだけを出すときの範囲 [from, to)（cols の添え字。today は今日の列）。
 * 今日より前を before 列、あとを after 列。片側が足りなければ、その分をもう片側に回す。
 * いちばん近い期限（must。同じ日に複数あれば最後のもの）が範囲の外なら、列の数は変えずに右へずらす（今日の列は残す）。
 * それでも入らないときだけ、そこまで広げる
 */
export function flowWindow(count: number, today: number, before: number, after: number, must = -1): [number, number] {
  const want = before + after + 1;
  let from = Math.max(0, today - before);
  let to = Math.min(count, today + 1 + after);
  if (to - from < want) {
    if (from === 0) to = Math.min(count, want);
    else from = Math.max(0, to - want);
  }
  if (must >= to) {
    to = must + 1;
    from = Math.min(today, Math.max(from, to - want));
  }
  return [from, to];
}

/**
 * 期限の流れ。亡くなった日から順に1本の線でつなぎ、今日までの線を濃くする。
 * どれだけ区切りがあっても1行に収める（名前は折り返す）。済んだ・不要にした区切りはグレー。
 * around を渡すと、今日のまわりの区切りだけを出し、切った側の線は端で薄くする（スマホなど、狭い画面で横にはみ出さないように）。
 * このときは、今日よりあとの済んだ・不要にした区切りは出さない（これからの期限に列を使う）
 */
export function MilestoneFlow({ tasks, done, today, death, around, dense: denseProp }: { tasks: Task[]; done: string[]; today: string; death: string; around?: { before: number; after: number }; dense?: boolean }) {
  const tl = timeline(tasks, done, today, death);
  const flat = tl.stops.flatMap((s) => s.milestones);
  const at0 = tl.todayAt < tl.stops.length ? flat.indexOf(tl.stops[tl.todayAt].milestones[0]) : flat.length;
  const ahead = flat.slice(at0).filter((m) => !around || !isClosed(m.state));
  const all: Col[] = [...flat.slice(0, at0).map((m) => ({ m })), { today }, ...ahead.map((m) => ({ m }))];
  const [from, to] = around ? flowWindow(all.length, at0, around.before, around.after, all.findLastIndex((c) => "m" in c && c.m.next)) : [0, all.length];
  const cols = all.slice(from, to);
  const at = at0 - from;
  const cutLeft = from > 0;
  const cutRight = to < all.length;
  const dateOf = (c: Col) => ("m" in c ? c.m.date : c.today);
  const dense = denseProp ?? cols.length > 10;
  return (
    <ol className="grid grid-rows-[auto_auto_auto_auto_auto]" style={{ gridTemplateColumns: cols.map((c) => ("m" in c ? "minmax(0,1fr)" : "minmax(4rem,0.5fr)")).join(" ") }}>
      {cols.map((c, i) => {
        // 線は、列のまん中から左右へ半分ずつ引く。今日の列より左は、もう過ぎた道のり。
        // 範囲の外にも区切りがある側は、線を端まで引いて薄くし、流れが続いていることを示す
        const left = i <= at ? "bg-sky-600" : "bg-stone-200";
        const right = i < at ? "bg-sky-600" : "bg-stone-200";
        // 薄くするのは外側の半分だけ（いちばん近い期限の大きな印に隠れても、線が続いて見えるように）
        const fadeIn = i === 0 && cutLeft ? (i <= at ? "bg-linear-to-r from-sky-600/0 to-sky-600 to-50%" : "bg-linear-to-r from-stone-200/0 to-stone-200 to-50%") : null;
        const fadeOut = i === cols.length - 1 && cutRight ? (i < at ? "bg-linear-to-r from-sky-600 from-50% to-sky-600/0" : "bg-linear-to-r from-stone-200 from-50% to-stone-200/0") : null;
        const line = (
          <>
            {(i > 0 || cutLeft) && <span aria-hidden className={`absolute left-0 right-1/2 top-1/2 h-1 -translate-y-1/2 ${fadeIn ?? left}`} />}
            {(i < cols.length - 1 || cutRight) && <span aria-hidden className={`absolute left-1/2 right-0 top-1/2 h-1 -translate-y-1/2 ${fadeOut ?? right}`} />}
          </>
        );
        const year = i === 0 || yearOf(dateOf(cols[i - 1])) !== yearOf(dateOf(c)) ? `${yearOf(dateOf(c))}年` : null;
        if (!("m" in c))
          return (
            <li key="today" className="row-span-5 grid grid-rows-subgrid text-center">
              <span className="relative grid h-10 place-items-center">
                {line}
                <span className="relative rounded-full bg-sky-700 px-2 text-xs font-bold leading-5 text-white">今日</span>
              </span>
              <span />
              <span />
              <span className="px-0.5 pt-1 text-sky-800">
                {year && <span className="block text-[11px] leading-4">{year}</span>}
                <span className="text-xs font-semibold tabular-nums">{monthDay(c.today)}</span>
              </span>
              <span />
            </li>
          );
        return (
          <li key={c.m.id} className="row-span-5 grid grid-rows-subgrid">
            <FlowStep m={c.m} today={today} year={year} line={line} dense={dense} />
          </li>
        );
      })}
    </ol>
  );
}

function Node({ m }: { m: Milestone }) {
  const base = "relative grid place-items-center rounded-full";
  if (m.state === "start") return <span className={`${base} h-3.5 w-3.5 bg-stone-400`} />;
  if (m.state === "done")
    return (
      <span className={`${base} h-6 w-6 bg-stone-300 text-white`}>
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  if (m.state === "na")
    return (
      <span className={`${base} h-6 w-6 bg-stone-200 text-stone-500`}>
        <Minus className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  if (m.state === "late") return <span className={`${base} h-6 w-6 bg-rose-500 text-xs font-bold text-white`}>!</span>;
  if (m.next) return <span className={`${base} h-7 w-7 bg-orange-500 ring-4 ring-orange-200`} />;
  return <span className={`${base} h-5 w-5 border-[3px] bg-white ${m.kind === "aim" ? "border-sky-500" : "border-orange-500"}`} />;
}

/** 流れの中の1つの区切り：線の上の印、名前、期間、日付、残りの日数 */
function FlowStep({ m, today, year, line, dense }: { m: Milestone; today: string; year: string | null; line: React.ReactNode; dense?: boolean }) {
  const closed = isClosed(m.state);
  const state =
    m.state === "start" ? null : m.state === "done" ? (
      <span className="font-semibold text-stone-500">完了</span>
    ) : m.state === "na" ? (
      <span className="font-semibold text-stone-500">不要</span>
    ) : m.state === "late" ? (
      <span className="font-semibold text-rose-700">過ぎています</span>
    ) : (
      <span className={m.next ? "font-bold text-orange-800" : "text-stone-600"}>{daysLeftLabel(today, m.date)}</span>
    );
  const body = (
    <>
      <span className="relative grid h-10 place-items-center">
        {line}
        <Node m={m} />
      </span>
      {/* 区切りが多い（列が狭い）ときは、名前の字を少し小さくして、1文字だけ次の行に回らないようにする */}
      <span className={`pt-1 font-bold leading-snug text-balance [overflow-wrap:anywhere] [word-break:auto-phrase] ${dense ? "px-0.5 text-xs" : "px-1 text-[13px]"} ${closed ? "text-stone-400" : "text-stone-900"}`}>{m.name}</span>
      <span className="px-1 text-[11px] leading-4 text-stone-500">
        {m.kind === "aim" && <span className={`mr-1 font-semibold ${closed ? "" : "text-sky-800"}`}>目安</span>}
        {m.period}
      </span>
      {/* 列が狭くて「11月15日（日）」が1行に入らないときは、どの列も曜日を日付の下に出す（列ごとに折り返し方がばらつかないように） */}
      <span className={`@container px-1 pt-1 ${closed ? "text-stone-400" : "text-stone-800"}`}>
        {year && <span className="block text-[11px] leading-4 text-stone-500">{year}</span>}
        <span className="text-sm font-bold tabular-nums">{monthDay(m.date)}</span>
        <span className="text-[11px] @max-[6.125rem]:block">{weekday(m.date)}</span>
      </span>
      <span className="px-1 pb-1 text-[11px] leading-4">{state}</span>
    </>
  );
  const cls = `row-span-5 grid grid-rows-subgrid rounded-xl text-center${m.next ? " bg-orange-50 ring-1 ring-orange-300" : ""}`;
  return m.task ? (
    <Link href={href(m.id)} className={m.next ? cls : `${cls} hover:bg-stone-50`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}
