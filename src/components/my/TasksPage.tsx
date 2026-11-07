"use client";

import { Building2, FileText, MapPin, NotebookPen, Phone } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCompassTopic } from "@/lib/compassChat";
import { OfficeLookup } from "@/components/plan/OfficeLookup";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { googleEventUrl, icsStamp, toICS } from "@/domain/procedures/calendar";
import { daysBetween, jpDate, yearOf } from "@/domain/procedures/dates";
import { DOCS } from "@/domain/procedures/documents";
import { OFFICE_LABEL, cityOf } from "@/domain/procedures/offices";
import type { Category, Task } from "@/domain/procedures/rules";
import { isRealEstate } from "@/domain/realEstate";
import type { Asset } from "@/domain/types";
import { useDocFiles } from "@/lib/docFiles";
import { saveBlob } from "@/lib/download";
import { useOverall, useRequireHearing } from "@/lib/overall";
import type { ItemStatus } from "@/lib/planStore";
import { daysLeftLabel, lateBadge } from "@/lib/taskStatus";
import { isWide, showBelowHeader } from "./scroll";
import { AUTO_DONE_NOTE, DetailStatus, RowStatus } from "./StatusButtons";
import { docsToUpload, UploadPrompt } from "./UploadPrompt";

export { UploadPrompt };

/** 不動産の登記は、亡くなった方の住所ではなく不動産のある場所の法務局が窓口 */
const realEstateLocation = (assets: Asset[]) =>
  assets
    .filter(isRealEstate)
    .map((a) => a.location)
    .find((l) => l.trim()) || undefined;


const CATS: (Category | "すべて")[] = ["すべて", "届出", "葬儀・法要", "調べる・決める", "お金の受け取り", "税金", "名義変更・解約", "不動産"];
type StatusFilter = "open" | "done" | "all";
type View = "date" | "office";

/**
 * ワンポイント：その手続きならではの一言があるときだけ出す（いまは葬儀・法要の日付が一般的な目安であること）。
 * どの手続きにも同じ決まり文句を出すと、目安の日がある手続きに「期限はありません」と出るなど、日付の欄と食い違うため
 */
export function tip(t: Task): string | null {
  if (t.category === "葬儀・法要") return "日付は一般的な目安なので、ご家族の気持ちと体調を優先してください。";
  return null;
}

/** 説明文を、最初の1文とそのあとに分ける（かっこの中の「。」では切らない）。あとの部分は「詳しく」に畳む */
export function splitLead(s: string): [string, string] {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "（" || c === "「" || c === "(") depth++;
    else if (c === "）" || c === "」" || c === ")") depth = Math.max(0, depth - 1);
    else if (c === "。" && depth === 0) return [s.slice(0, i + 1), s.slice(i + 1).trim()];
  }
  return [s, ""];
}

/** 期限・できなくなること・過料など、知らないと困る内容。これを含む説明は畳まない */
const MUST_SEE = /期限|以内|できなくなる|過料|までに|日まで|延長/;

/**
 * 詳細に見せる説明。最初の1文だけを見せ、残りを「詳しく」に畳む。
 * ただし、法律で期限が決まった手続きと、続きに期限や「できなくなる」ことが書いてある手続きは全部見せる
 */
export function detailText(t: { what: string; hard?: boolean }): [string, string] {
  const [lead, more] = splitLead(t.what);
  if (!more || t.hard || MUST_SEE.test(more)) return [t.what, ""];
  return [lead, more];
}

/** 一覧の行の日付。今年の日付は年を省く（「11月15日（日）」）。来年以降は年もつける */
export const rowDate = (date: string, now: string) => (yearOf(date) === yearOf(now) ? jpDate(date).replace(/^\d+年/, "") : jpDate(date));

/** 済んだ・不要にした手続きをたたんだ1行の名前 */
const foldLabel = (xs: Task[], statusOf: (id: string) => ItemStatus) => `${xs.some((x) => statusOf(x.id) === "na") ? "済んだ・不要にした手続き" : "済んだ手続き"}（${xs.length}件）`;

/** 窓口ごとに見るときのまとまり */
const officeGroup = (t: Task) => (t.office ? OFFICE_LABEL[t.office] : t.category === "葬儀・法要" ? "葬儀社・お寺など" : "銀行・保険会社・勤務先など");
const OFFICE_ORDER = ["市区町村役場", "年金事務所", "税務署", "法務局", "家庭裁判所", "公証役場", "都税事務所", "銀行・保険会社・勤務先など", "葬儀社・お寺など"];

/** 窓口に電話するときの伝え方の文例 */
function script(t: Task, rel: string, name: string) {
  const who = rel && rel !== "その他" ? `${rel}${name ? `（${name}）` : ""}` : name ? `家族の${name}` : "家族";
  return `${who}が亡くなりました。「${t.title}」の手続きをしたいのですが、必要な書類と受付時間、予約が必要かどうかを教えていただけますか？`;
}

function downloadOne(t: Task) {
  const ics = toICS([t], { name: t.title, stamp: icsStamp(), appUrl: `${window.location.origin}/my/tasks?id=${t.id}` });
  saveBlob(new Blob([ics], { type: "text/calendar" }), `${t.id}.ics`);
}

/**
 * 手続きを選ばずに開いたとき、詳細には先頭のまだの手続きが出る。それを済ませたら、その手続きを選んだままにする
 * （そうしないと詳細が次の手続きに入れ替わり、同じ場所の「完了にする」をもう一度押すと別の手続きが完了になる）
 */
export const keepShown = (urlId: string | null, shownId: string | undefined, markedId: string) => !urlId && shownId === markedId;

/**
 * 一覧（中だけ上下に動く欄）を、その手続きの行が上の端のすこし下に来るまで送る。
 * 窓口ごとの表示では、上に貼りついた窓口の見出しに隠れないよう、その高さもあける。描画が終わってから測る
 */
export function showInList(list: HTMLElement | null, id: string, tries = 3) {
  if (!list || typeof window === "undefined") return;
  requestAnimationFrame(() => {
    const row = list.querySelector<HTMLElement>(`[data-task="${CSS.escape(id)}"]`);
    // 一覧に出したばかり（必要に応じてやる手続きを表示にした直後や、済んだ手続きのたたみを開いた直後など）で、
    // まだ描かれていなければ次の描画で探す
    if (!row || row.closest("details:not([open])")) return void (tries > 1 && showInList(list, id, tries - 1));
    // 窓口の見出しは、窓口のまとまり（data-group）のすぐ下の p（済んだ手続きのたたみの中の行でも同じ見出し）
    const head = row.closest("[data-group]")?.querySelector<HTMLElement>(":scope > p");
    list.scrollTop = listScrollFor(list.scrollTop, row.getBoundingClientRect().top, list.getBoundingClientRect().top, head?.offsetHeight ?? 0);
    // パソコンでは一覧の下の端が画面の外に出ることがあるので、いちばん下の行のときは画面も送って行を見せる
    // （スマホは詳細の先頭まで画面を送るので、ここでは送らない）
    const below = row.getBoundingClientRect().bottom - window.innerHeight;
    if (isWide() && below > 0) window.scrollBy({ top: Math.ceil(below + 8) });
  });
}

/** 行の上の端を、一覧の上の端（と貼りついた見出し）から gap だけあけたところに出すときの、一覧の送り先 */
export const listScrollFor = (scrollTop: number, rowTop: number, listTop: number, stickyHead = 0, gap = 8) => Math.max(0, Math.round(scrollTop + rowTop - listTop - stickyHead - gap));

/** やることリストの1行 */
export function TaskRow({
  task,
  status,
  selected,
  hasMemo,
  now,
  showDept,
  locked,
  onMark,
  onSelect,
}: {
  task: Task;
  status: ItemStatus;
  selected: boolean;
  hasMemo: boolean;
  now: string;
  showDept?: boolean;
  locked?: string;
  onMark: (id: string, v: ItemStatus) => void;
  onSelect: (id: string) => void;
}) {
  const closed = status !== "open";
  // 札は期限を過ぎたときの「3日超過」だけ。済んだかどうかはチェックと取り消し線、期限があるかは日付の色で分かる
  const badge = lateBadge(task, status, now);
  return (
    <li data-task={task.id} className={`flex items-center gap-3 rounded-xl border bg-white p-3 ${selected ? "border-sky-500 ring-2 ring-sky-100" : "border-stone-200"}`}>
      <RowStatus status={status} onChange={(v) => onMark(task.id, v)} label={task.title} locked={locked} muted />
      <button type="button" onClick={() => onSelect(task.id)} className="min-w-0 flex-1 text-left">
        <p className={`line-clamp-2 font-semibold ${closed ? "text-stone-400 line-through" : "text-stone-900"}`}>{task.title}</p>
        <p className="truncate text-xs text-stone-500">
          {showDept && task.dept ? `${task.dept}・` : ""}
          <span className={task.hard && !closed ? "font-semibold text-orange-700" : ""}>
            {task.hard ? "期限" : "目安"} {rowDate(task.date, now)}
          </span>
          {hasMemo ? "・メモあり" : ""}
        </p>
      </button>
      {badge && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}>{badge.label}</span>}
    </li>
  );
}

export function TasksPage() {
  const o = useOverall();
  const files = useDocFiles();
  const params = useSearchParams();
  const router = useRouter();
  const [cat, setCat] = useState<(typeof CATS)[number]>("すべて");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [optional, setOptional] = useState(false);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<View>("date");
  /** 開いている「済んだ手続き（N件）」のたたみ（期限の順は "date"、窓口ごとは窓口の名前） */
  const [unfolded, setUnfolded] = useState<string[]>([]);
  const listRef = useRef<HTMLUListElement>(null);

  const { closed } = o;
  // まだ済んでいない手続きを上に、済んだ・不要にしたものは下へ（それぞれ期限の順）
  const list = useMemo(() => {
    const xs = o.tasks.filter(
      (t) =>
        (optional || !t.optional) &&
        (cat === "すべて" || t.category === cat) &&
        (status === "all" || (status === "done" ? closed(t.id) : !closed(t.id))),
    );
    return [...xs.filter((t) => !closed(t.id)), ...xs.filter((t) => closed(t.id))];
  }, [o.tasks, closed, cat, status, optional]);
  const groups = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of list) m.set(officeGroup(t), [...(m.get(officeGroup(t)) ?? []), t]);
    return [...m.entries()].sort((a, b) => OFFICE_ORDER.indexOf(a[0]) - OFFICE_ORDER.indexOf(b[0]));
  }, [list]);
  // 分類ごとの進み具合（済んだ・不要 / 全部）。リボンに「1/10」のように出す
  const counts = useMemo(() => {
    const m = new Map<string, { done: number; all: number }>();
    for (const t of o.tasks) {
      if (!optional && t.optional) continue;
      for (const k of ["すべて", t.category]) {
        const c = m.get(k) ?? { done: 0, all: 0 };
        c.all++;
        if (closed(t.id)) c.done++;
        m.set(k, c);
      }
    }
    return m;
  }, [o.tasks, closed, optional]);
  const urlId = params.get("id");
  // 選ばずに開いて済ませた手続き。URLが変わるまでのあいだも詳細に出したままにする（keepShown）
  const [pinned, setPinned] = useState<string | null>(null);
  if (pinned && urlId) setPinned(null);
  const selId = urlId ?? pinned ?? list.find((t) => !o.closed(t.id))?.id ?? list[0]?.id;
  const t = o.tasks.find((x) => x.id === selId) ?? null;
  // スマホでは詳細が一覧の下にあるので、手続きを選んだら詳細の先頭まで画面を送る（パソコンでは横に並ぶので送らない）
  const articleRef = useRef<HTMLElement>(null);
  /** 詳細の先頭まで送った手続き（同じ手続きで送り直さないため） */
  const shownFor = useRef<string | null>(null);
  const showDetail = useCallback((id: string, smooth: boolean) => {
    shownFor.current = id;
    showBelowHeader(() => articleRef.current, { smooth, phoneOnly: true });
  }, []);
  // 聞き取りが済んでいなければトップへ戻す（移動は描画のあとに行う）
  const ready = useRequireHearing(o);
  // ホーム・カレンダー・お知らせから手続きを選んで開いたときも、詳細の先頭を出し、一覧もその手続きの行まで送る
  // （「必要に応じてやる手続き」を開いたときは、一覧にも出す）
  const urlOptional = !!o.tasks.find((x) => x.id === urlId)?.optional;
  // 済んだ手続きを開いたときは、その手続きの行が見えるよう、たたみも開く
  const urlTask = o.tasks.find((x) => x.id === urlId);
  const urlFold = urlTask && closed(urlTask.id) ? officeGroup(urlTask) : null;
  useEffect(() => {
    if (!ready || !urlId || shownFor.current === urlId) return;
    if (urlOptional) setOptional(true);
    if (urlFold) setUnfolded((xs) => [...new Set([...xs, "date", urlFold])]);
    showDetail(urlId, false);
    showInList(listRef.current, urlId);
  }, [ready, urlId, urlOptional, urlFold, showDetail]);
  // パソコンでは詳細だけが動くので、別の手続きに替わったら詳細を先頭から見せる
  useEffect(() => {
    if (articleRef.current) articleRef.current.scrollTop = 0;
  }, [selId]);
  // 手続きを済ませたら、読み取りできる書類（残高証明書など）のアップロードをその場で案内する
  const [prompt, setPrompt] = useState<{ taskId: string; docs: string[]; open: boolean } | null>(null);
  const mark = (id: string, v: Parameters<typeof o.setStatus>[1]) => {
    if (keepShown(urlId, selId, id)) {
      setPinned(id);
      shownFor.current = id;
      router.replace(`/my/tasks?id=${id}`, { scroll: false });
    }
    o.setStatus(id, v);
    const task = o.tasks.find((x) => x.id === id);
    const docs = v === "done" && task ? docsToUpload(task, o.done) : [];
    setPrompt(docs.length ? { taskId: id, docs, open: false } : null);
  };

  const context = useCallback(
    () =>
      [
        `亡くなった日：${o.iv.deathDate}`,
        t ? `いま見ている手続き：${t.title}（${t.hard ? "期限" : "目安"} ${t.date}）${t.what}` : "",
        "手続きリスト：",
        ...o.main.map((x) => `- ${x.date} ${x.title}${o.done.includes(x.id) ? "（済）" : ""}`),
      ].join("\n"),
    [o.iv.deathDate, o.main, o.done, t],
  );
  useCompassTopic("tasks", context, t ? `「${t.title}」について聞いてみる` : undefined);

  if (!ready) return <AppShell>{null}</AppShell>;
  const select = (id: string) => {
    router.replace(`/my/tasks?id=${id}`, { scroll: false });
    showDetail(id, true);
  };
  const lockedNote = (id: string) => (o.autoDone.includes(id) ? AUTO_DONE_NOTE : undefined);
  const left = t ? daysBetween(o.now, t.date) : 0;
  const st = t ? o.statusOf(t.id) : "open";
  const isDone = st !== "open";
  const nextStep = o.steps.find((s) => !s.done);
  const { pref, city } = cityOf(o.iv.address);
  // 「完了」だけを選んだときはたたまずに並べる。それ以外は、済んだ・不要にした手続きを1行にたたむ
  const foldDone = status !== "done";
  const [lead, more] = t ? detailText(t) : ["", ""];
  const extraBring = t ? t.bring.filter((b) => !t.docs.some((id) => DOCS[id]?.name === b)) : [];
  const oneTip = t ? tip(t) : null;

  const row = (x: Task, showDept?: boolean) => (
    <TaskRow
      key={x.id}
      task={x}
      status={o.statusOf(x.id)}
      selected={x.id === selId}
      hasMemo={!!o.memos[x.id]}
      now={o.now}
      showDept={showDept}
      locked={lockedNote(x.id)}
      onMark={mark}
      onSelect={select}
    />
  );

  /** 済んだ・不要にした手続きを「済んだ手続き（N件）」の1行にたたむ。押すと開く */
  const rows = (xs: Task[], key: string, showDept?: boolean) => {
    const done = foldDone ? xs.filter((x) => closed(x.id)) : [];
    const shown = foldDone ? xs.filter((x) => !closed(x.id)) : xs;
    const isOpen = unfolded.includes(key);
    return (
      <>
        {shown.map((x) => row(x, showDept))}
        {done.length > 0 && (
          <li>
            <details
              open={isOpen}
              onToggle={(e) => {
                const v = e.currentTarget.open;
                if (v !== isOpen) setUnfolded((ks) => (v ? [...ks, key] : ks.filter((k) => k !== key)));
              }}
            >
              <summary className="cursor-pointer rounded-lg px-2 py-2.5 text-sm text-stone-600 hover:bg-white">{foldLabel(done, o.statusOf)}</summary>
              <ul className="mt-1 space-y-2">{done.map((x) => row(x, showDept))}</ul>
            </details>
          </li>
        )}
      </>
    );
  };

  return (
    <AppShell wide>
      <PageHead title="やることリスト" say="「窓口ごと」なら、役所でまとめて済む手続きが分かります。" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {CATS.map((c) => (
          <button key={c} type="button" onClick={() => setCat(c)} className={`rounded-full px-3 py-1 text-sm ${cat === c ? "bg-sky-700 font-semibold text-white" : "bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-sky-50"}`}>
            {c}
            {counts.get(c) && (
              <span className={`ml-1.5 text-xs tabular-nums ${cat === c ? "text-sky-100" : "text-stone-500"}`} aria-label={`${counts.get(c)!.all}件中${counts.get(c)!.done}件済み`}>
                {counts.get(c)!.done}/{counts.get(c)!.all}
              </span>
            )}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-stone-300" />
        {(
          [
            ["all", "すべて"],
            ["open", "未完了"],
            ["done", "完了"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(k)} className={`rounded-full px-3 py-1 text-sm ${status === k ? "bg-stone-800 font-semibold text-white" : "bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-stone-50"}`}>
            {l}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-sm text-stone-600">
          <input type="checkbox" checked={optional} onChange={(e) => setOptional(e.target.checked)} className="accent-sky-700" />
          必要に応じてやる手続きも表示
        </label>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:h-[calc(100vh-13rem)] lg:min-h-[32rem] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div data-tour="tasks-list" className="flex min-h-0 flex-col rounded-2xl border border-sky-100 bg-sky-50/40 p-2">
          <div className="mb-2 flex gap-1 rounded-full bg-white p-1 text-sm ring-1 ring-stone-200">
            {(
              [
                ["date", "期限の順"],
                ["office", "窓口ごと"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setView(k)} className={`flex-1 rounded-full px-3 py-1 ${view === k ? "bg-sky-700 font-semibold text-white" : "text-stone-700 hover:bg-sky-50"}`}>
                {l}
              </button>
            ))}
          </div>
          <ul ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 max-lg:max-h-[60vh]">
            {list.length === 0 && <li className="rounded-xl bg-white p-6 text-center text-sm text-stone-500">該当する手続きはありません。</li>}
            {view === "date"
              ? rows(list, "date")
              : groups.map(([g, xs]) => (
                  <li key={g} data-group>
                    <p className="sticky top-0 z-10 flex items-center justify-between bg-sky-50 px-1 py-1.5 text-sm font-bold text-sky-950">
                      <span className="flex items-center gap-1.5"><Building2 className="h-4 w-4 text-brand" aria-hidden />{g}</span>
                      <span className="text-xs font-normal text-stone-500">あと{xs.filter((x) => !closed(x.id)).length}件</span>
                    </p>
                    <ul className="space-y-2">
                      {rows(xs, g, true)}
                    </ul>
                  </li>
                ))}
          </ul>
        </div>

        {t && (
          <article ref={articleRef} className="min-h-0 space-y-4 overflow-y-auto rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-stone-500">{t.category}</p>
                <h2 className="text-xl font-bold text-sky-950">{t.title}</h2>
              </div>
              <DetailStatus status={st} onChange={(v) => mark(t.id, v)} locked={lockedNote(t.id)} />
            </div>

            <div className={`rounded-xl px-4 py-3 ${isDone ? "bg-stone-50 text-stone-500" : t.hard ? "bg-orange-50" : "bg-sky-50"}`}>
              <p className="text-sm font-bold">
                {t.hard ? "期限" : "目安"}：{jpDate(t.date)}
                {!isDone && <span className={`ml-2 ${left < 0 ? "text-rose-700" : left <= 7 ? "text-orange-700" : "text-stone-600"}`}>{daysLeftLabel(o.now, t.date)}</span>}
              </p>
              {t.limit && <p className="mt-1 text-sm text-rose-800">注意：{t.limit.text}（{jpDate(t.limit.date)}まで）</p>}
            </div>

            <div>
              <p className="leading-relaxed text-stone-800">{lead}</p>
              {/* 説明の続きと法律の根拠は「詳しく」に畳む（開けばいままでと同じ内容が読める） */}
              {(more || t.law) && (
                <details key={t.id} className="mt-1 text-sm text-stone-600">
                  <summary className="cursor-pointer py-2 font-medium text-teal-800">詳しく</summary>
                  <div className="space-y-1.5 leading-relaxed">
                    {more && <p>{more}</p>}
                    {t.law && <p className="text-xs text-stone-500">根拠：{t.law}</p>}
                  </div>
                </details>
              )}
            </div>

            {t.id === "inheritance-tax" && o.filing && (
              <div className="rounded-xl border border-sky-100 p-4">
                <p className="text-sm font-bold text-stone-700">申告書づくり {o.steps.filter((s) => s.done).length}/{o.steps.length} ステップ</p>
                <ol className="mt-2 flex flex-wrap gap-1.5">
                  {o.steps.map((s, i) => (
                    <li key={s.slug}>
                      <Link href={`/case/${s.slug}`} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${s.done ? "bg-stone-100 text-stone-400" : s === nextStep ? "bg-sky-700 font-bold text-white" : "bg-white text-stone-700 ring-1 ring-stone-200"}`}>
                        {s.done ? "✓" : i + 1} {s.title}
                      </Link>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 font-bold text-stone-700"><Building2 className="h-4 w-4 text-brand" aria-hidden />提出先・連絡先</h3>
              {t.office ? (
                <div className="space-y-2">
                  <OfficeLookup key={`${t.id}|${t.office}`} kind={t.office} dept={t.dept} address={t.office === "legalAffairs" ? (realEstateLocation(o.case.assets) ?? o.iv.address) : o.iv.address} />
                  {/* 窓口が亡くなった方の住所で決まらない手続き（子の住所地の家庭裁判所など）もあるので、決まりは畳まずに見せる */}
                  {t.where && <p className="text-xs text-stone-500">窓口の決まり：{t.where}</p>}
                  {city && (
                    <a
                      href={`https://www.google.com/maps/search/${encodeURIComponent(`${pref}${city} ${OFFICE_LABEL[t.office]}`)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-sm text-sky-800 underline"
                    >
                      <MapPin className="mr-1 inline h-4 w-4 text-brand" aria-hidden />
                      地図で見る
                    </a>
                  )}
                  {/* 窓口に電話するときの文例。開くとコピーできる */}
                  <details key={t.id} className="text-sm text-stone-600">
                    <summary className="cursor-pointer py-2 font-medium text-teal-800">
                      <Phone className="mr-1 inline h-4 w-4 text-brand" aria-hidden />
                      電話で聞くときの文例
                    </summary>
                    <div className="rounded-xl bg-stone-50 p-3">
                      <p className="leading-relaxed text-stone-800">「{script(t, o.iv.myRelation, o.iv.decedentName)}」</p>
                      <button
                        type="button"
                        className="-mb-2 -ml-2 px-2 py-2 text-xs text-sky-700 hover:underline"
                        onClick={() => {
                          navigator.clipboard?.writeText(script(t, o.iv.myRelation, o.iv.decedentName)).then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                          });
                        }}
                      >
                        {copied ? "コピーしました" : "コピー"}
                      </button>
                    </div>
                  </details>
                </div>
              ) : (
                <p className="text-sm text-stone-700">{t.where}</p>
              )}
            </section>

            {t.docs.length > 0 && (
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 font-bold text-stone-700"><FileText className="h-4 w-4 text-brand" aria-hidden />必要な書類</h3>
                <ul className="space-y-0.5">
                  {t.docs
                    .filter((id) => DOCS[id])
                    .map((id) => {
                      const k = `doc:${id}`;
                      const ds = o.statusOf(k);
                      const ok = ds !== "open";
                      return (
                        <li key={id} className="flex items-center gap-2 text-sm">
                          <RowStatus status={ds} onChange={(v) => o.setStatus(k, v)} label={DOCS[id].name} muted />
                          <span className={ok ? "text-stone-400 line-through" : "text-stone-800"}>{DOCS[id].name}</span>
                          {files.of(id).length > 0 && <span className="shrink-0 text-xs text-stone-500">アップロード済み {files.of(id).length}枚</span>}
                          <Link href={`/my/docs?id=${id}`} className="ml-auto shrink-0 py-2 text-xs text-sky-700 hover:underline">
                            {DOCS[id].readable ? "取り方・読み取り" : "取り方"} ›
                          </Link>
                        </li>
                      );
                    })}
                </ul>
                {/* 「必要な書類」と同じものは出さない */}
                {extraBring.length > 0 && <p className="mt-2 text-xs text-stone-500">ほかに持っていくもの：{extraBring.join("、")}</p>}
              </section>
            )}

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 font-bold text-stone-700"><NotebookPen className="h-4 w-4 text-brand" aria-hidden />メモ</h3>
              <MemoBox key={t.id} value={o.memos[t.id] ?? ""} onSave={(v) => o.setMemo(t.id, v)} />
            </section>

            {oneTip && (
              <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/compass-kun-main.png" alt="" className="h-12 w-auto" />
                <p className="text-sm text-amber-950">
                  <span className="font-bold">ワンポイント：</span>
                  {oneTip}
                </p>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {t.link && t.id !== "inheritance-tax" && (
                <Link href={t.link.href} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800">
                  {t.link.label} →
                </Link>
              )}
              {t.id === "inheritance-tax" && nextStep && (
                <Link href={`/case/${nextStep.slug}`} className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800">
                  「{nextStep.title}」から続ける →
                </Link>
              )}
              <a href={googleEventUrl(t)} target="_blank" rel="noreferrer" className="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50">
                Googleカレンダーに追加
              </a>
              <button type="button" onClick={() => downloadOne(t)} className="rounded-lg border border-stone-300 px-4 py-2 text-sm hover:bg-stone-50">
                iPhone・Outlookなどのカレンダーに追加
              </button>
              {t.source?.url && (
                <a href={t.source.url} target="_blank" rel="noreferrer" className="rounded-lg px-2 py-2 text-sm text-sky-800 underline">
                  {t.source.label}
                </a>
              )}
            </div>
          </article>
        )}
      </div>
      {prompt && <UploadPrompt docs={prompt.docs} open={prompt.open} onOpen={() => setPrompt({ ...prompt, open: true })} onClose={() => setPrompt(null)} onRegistered={(d, all = true) => o.setStatus(`doc:${d}`, all ? "done" : "open")} />}
    </AppShell>
  );
}

/** 手続きごとのメモ。入力をやめたら保存する */
export function MemoBox({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  // このタブで入力して、まだ保存していない
  const [typing, setTyping] = useState(false);
  // 別のタブで保存されたメモは、このタブで入力中でなければそのまま映す
  // （古いままの欄を保存して、別のタブのメモを消さないため）
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    if (!typing) setV(value);
  }
  const [saved, setSaved] = useState(false);
  // 親の描画のたびに変わる関数を effect の依存に入れないよう、最新の関数を ref に持つ
  const save = useRef(onSave);
  useEffect(() => {
    save.current = onSave;
  }, [onSave]);
  useEffect(() => {
    // 保存するのは、このタブで入力したときだけ
    if (!typing) return;
    const id = setTimeout(() => {
      setTyping(false);
      // 空白だけのメモは保存されない（空として扱われる）ので、前後の空白を除いて比べる
      if (v.trim() === value.trim()) return;
      save.current(v);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }, 600);
    return () => clearTimeout(id);
  }, [v, value, typing]);
  return (
    <div>
      <textarea
        value={v}
        onChange={(e) => {
          setV(e.target.value);
          setTyping(true);
        }}
        rows={3}
        placeholder="例：担当者・電話番号・郵送した日"
        className="w-full rounded-lg border border-stone-300 p-2 text-base focus:border-sky-500 focus:outline-none sm:text-sm"
      />
      <p className="h-4 text-xs text-emerald-700">{saved ? "保存しました" : ""}</p>
    </div>
  );
}
