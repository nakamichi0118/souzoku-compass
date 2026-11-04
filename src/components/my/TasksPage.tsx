"use client";

import { Building2, FileText, MapPin, NotebookPen, Phone } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AskCompass, useAsk } from "@/components/compass/AskCompass";
import { OfficeLookup } from "@/components/plan/OfficeLookup";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { googleEventUrl, icsStamp, toICS } from "@/domain/procedures/calendar";
import { daysBetween, jpDate } from "@/domain/procedures/dates";
import { DOCS } from "@/domain/procedures/documents";
import { OFFICE_LABEL, cityOf } from "@/domain/procedures/offices";
import type { Category, Task } from "@/domain/procedures/rules";
import { isRealEstate } from "@/domain/realEstate";
import type { Asset } from "@/domain/types";
import { saveBlob } from "@/lib/download";
import { useOverall, useRequireHearing } from "@/lib/overall";
import type { ItemStatus } from "@/lib/planStore";
import { daysLeftLabel, taskStatus } from "@/lib/taskStatus";
import { showBelowHeader } from "./scroll";
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

/** ワンポイント：手続きの性質にあわせた一言 */
function tip(t: Task) {
  if (t.category === "葬儀・法要") return "日付は一般的な目安です。無理に予定を詰めず、ご家族の気持ちと体調を優先してください。";
  if (t.hard) return "期限がある手続きです。書類がそろわなくても、まず窓口に相談すると次にやることが分かります。";
  return "期限はありませんが、ほかの手続きでこの書類や結果を使うことがあるので、落ち着いたら進めましょう。";
}

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
    // 一覧に出したばかり（必要に応じてやる手続きを表示にした直後など）で、まだ描かれていなければ次の描画で探す
    if (!row) return void (tries > 1 && showInList(list, id, tries - 1));
    const head = row.parentElement?.closest("li")?.querySelector<HTMLElement>(":scope > p");
    list.scrollTop = listScrollFor(list.scrollTop, row.getBoundingClientRect().top, list.getBoundingClientRect().top, head?.offsetHeight ?? 0);
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
  const badge = taskStatus(task, status, now);
  return (
    <li data-task={task.id} className={`flex items-center gap-3 rounded-xl border bg-white p-3 ${selected ? "border-sky-500 ring-2 ring-sky-100" : "border-stone-200"}`}>
      <RowStatus status={status} onChange={(v) => onMark(task.id, v)} label={task.title} locked={locked} />
      <button type="button" onClick={() => onSelect(task.id)} className="min-w-0 flex-1 text-left">
        <p className={`line-clamp-2 font-semibold ${closed ? "text-stone-400 line-through" : "text-stone-900"}`}>{task.title}</p>
        <p className="truncate text-xs text-stone-500">
          {showDept && task.dept ? `${task.dept}・` : `${task.category}・`}
          {task.hard ? "期限" : "目安"} {jpDate(task.date)}
          {hasMemo ? "・メモあり" : ""}
        </p>
      </button>
      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}>{badge.label}</span>
    </li>
  );
}

export function TasksPage() {
  const o = useOverall();
  const params = useSearchParams();
  const router = useRouter();
  const [cat, setCat] = useState<(typeof CATS)[number]>("すべて");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [optional, setOptional] = useState(false);
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<View>("date");
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
  // チェックを付けたら、残っている手続きが見えるようにリストを先頭へ戻す
  const [bump, setBump] = useState(0);
  useEffect(() => {
    if (bump) listRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [bump]);
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
  useEffect(() => {
    if (!ready || !urlId || shownFor.current === urlId) return;
    if (urlOptional) setOptional(true);
    showDetail(urlId, false);
    showInList(listRef.current, urlId);
  }, [ready, urlId, urlOptional, showDetail]);
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
    if (v !== "open") setBump((n) => n + 1);
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
  const ask = useAsk("tasks", context);

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

  return (
    <AppShell wide>
      <PageHead title="やることリスト" say="まだの手続きを期限の近い順に上から並べています。「窓口ごと」にすると、役所でまとめてできる手続きが分かります。" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {CATS.map((c) => (
          <button key={c} type="button" onClick={() => setCat(c)} className={`rounded-full px-3 py-1 text-sm ${cat === c ? "bg-sky-700 font-semibold text-white" : "bg-white text-stone-700 ring-1 ring-stone-200 hover:bg-sky-50"}`}>
            {c}
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
        <div className="flex min-h-0 flex-col rounded-2xl border border-sky-100 bg-sky-50/40 p-2">
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
              ? list.map((x) => row(x))
              : groups.map(([g, xs]) => (
                  <li key={g}>
                    <p className="sticky top-0 z-10 flex items-center justify-between bg-sky-50 px-1 py-1.5 text-sm font-bold text-sky-950">
                      <span className="flex items-center gap-1.5"><Building2 className="h-4 w-4 text-brand" aria-hidden />{g}</span>
                      <span className="text-xs font-normal text-stone-500">あと{xs.filter((x) => !closed(x.id)).length}件</span>
                    </p>
                    <ul className="space-y-2">
                      {xs.map((x) => row(x, true))}
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

            <div className={`rounded-xl px-4 py-3 ${isDone ? "bg-emerald-50" : t.hard ? "bg-orange-50" : "bg-sky-50"}`}>
              <p className="text-sm font-bold">
                {t.hard ? "期限" : "目安"}：{jpDate(t.date)}
                {!isDone && <span className={`ml-2 ${left < 0 ? "text-rose-700" : left <= 7 ? "text-orange-700" : "text-stone-600"}`}>{daysLeftLabel(o.now, t.date)}</span>}
              </p>
              {t.limit && <p className="mt-1 text-sm text-rose-800">注意：{t.limit.text}（{jpDate(t.limit.date)}まで）</p>}
            </div>

            <p className="leading-relaxed text-stone-800">{t.what}</p>

            {t.id === "inheritance-tax" && o.filing && (
              <div className="rounded-xl border border-sky-100 p-4">
                <p className="text-sm font-bold text-stone-700">申告書づくり {o.steps.filter((s) => s.done).length}/{o.steps.length} ステップ</p>
                <ol className="mt-2 flex flex-wrap gap-1.5">
                  {o.steps.map((s, i) => (
                    <li key={s.slug}>
                      <Link href={`/case/${s.slug}`} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs ${s.done ? "bg-emerald-100 text-emerald-800" : s === nextStep ? "bg-sky-700 font-bold text-white" : "bg-stone-100 text-stone-600"}`}>
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
                  <p className="text-xs text-stone-500">窓口の決まり：{t.where}</p>
                  {city && (
                    <a
                      href={`https://www.google.com/maps/search/${encodeURIComponent(`${pref}${city} ${OFFICE_LABEL[t.office]}`)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-sm text-sky-800 underline"
                    >
                      <MapPin className="mr-1 inline h-4 w-4 text-brand" aria-hidden />
                      地図で見る（Googleマップ）
                    </a>
                  )}
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
                          <RowStatus status={ds} onChange={(v) => o.setStatus(k, v)} label={DOCS[id].name} />
                          <span className={ok ? "text-stone-400 line-through" : "text-stone-800"}>{DOCS[id].name}</span>
                          <Link href={`/my/docs?id=${id}`} className="ml-auto shrink-0 py-2 text-xs text-sky-700 hover:underline">
                            {DOCS[id].readable ? "取り方・読み取り" : "取り方"} ›
                          </Link>
                        </li>
                      );
                    })}
                </ul>
                {t.bring.length > 0 && <p className="mt-2 text-xs text-stone-500">ほかに持っていくもの：{t.bring.join("、")}</p>}
              </section>
            )}

            {t.office && (
              <section className="rounded-xl bg-stone-50 p-4">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-1.5 font-bold text-stone-700"><Phone className="h-4 w-4 text-brand" aria-hidden />連絡するときの伝え方</h3>
                  <button
                    type="button"
                    className="-my-2 -mr-2 px-2 py-2 text-xs text-sky-700 hover:underline"
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
                <p className="mt-2 text-sm leading-relaxed text-stone-800">「{script(t, o.iv.myRelation, o.iv.decedentName)}」</p>
              </section>
            )}

            <section>
              <h3 className="mb-2 flex items-center gap-1.5 font-bold text-stone-700"><NotebookPen className="h-4 w-4 text-brand" aria-hidden />メモ</h3>
              <MemoBox key={t.id} value={o.memos[t.id] ?? ""} onSave={(v) => o.setMemo(t.id, v)} />
            </section>

            <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/compass-kun-main.png" alt="" className="h-12 w-auto" />
              <p className="text-sm text-amber-950">
                <span className="font-bold">ワンポイント：</span>
                {tip(t)}
                {t.law ? `（根拠：${t.law}）` : ""}
              </p>
            </div>

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

            <AskCompass state={ask} placeholder={`「${t.title}」について聞いてみる`} />
          </article>
        )}
      </div>
      {prompt && <UploadPrompt docs={prompt.docs} open={prompt.open} onOpen={() => setPrompt({ ...prompt, open: true })} onClose={() => setPrompt(null)} onRegistered={(d) => o.setStatus(`doc:${d}`, "done")} />}
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
        placeholder="例：みほん銀行 相続センター 0120-000-000、担当 見本さん。○日に書類を郵送済み。"
        className="w-full rounded-lg border border-stone-300 p-2 text-base focus:border-sky-500 focus:outline-none sm:text-sm"
      />
      <p className="h-4 text-xs text-emerald-700">{saved ? "保存しました" : ""}</p>
    </div>
  );
}
