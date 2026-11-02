"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import { AskCompass, useAsk } from "@/components/compass/AskCompass";
import { Bubble, CompassAvatar } from "@/components/compass/CompassKun";
import { isValidDate, jpDate } from "@/domain/procedures/dates";
import { toICS } from "@/domain/procedures/calendar";
import type { Verdict } from "@/domain/procedures/interview";
import { buildTasks, periodOf, type Task } from "@/domain/procedures/rules";
import { encodeInterview } from "@/domain/procedures/share";
import { usePlan } from "@/lib/planStore";
import { filingSteps } from "@/lib/progress";
import { useCase } from "@/lib/store";
import { DocsPanel, collectDocs } from "./DocsPanel";
import { TaskRow } from "./TaskRow";
import { TaxVerdict, type Precise } from "./TaxVerdict";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

type Tab = "list" | "docs" | "calendar";

function Ring({ pct }: { pct: number }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 80 80" className="h-24 w-24 shrink-0" role="img" aria-label={`全体の進み具合 ${pct}%`}>
      <circle cx="40" cy="40" r={r} fill="none" stroke="#e7e5e4" strokeWidth="8" />
      <circle cx="40" cy="40" r={r} fill="none" stroke="#0369a1" strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 40 40)" />
      <text x="40" y="45" textAnchor="middle" className="fill-stone-900 text-[18px] font-bold">
        {pct}%
      </text>
    </svg>
  );
}

export function Dashboard() {
  const { iv, done, toggle, loaded } = usePlan();
  const { data: c, result } = useCase();
  const [tab, setTab] = useState<Tab>("list");
  const [showOptional, setShowOptional] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [focusDoc, setFocusDoc] = useState<string | null>(null);
  const now = today();
  const valid = isValidDate(iv.deathDate);

  // 同じ相続（亡くなった日が同じ）で財産を入力済みなら、相続税の判定は計算エンジンの結果を使う
  const linked = c.decedent.deathDate === iv.deathDate && c.assets.length > 0 && !!result;
  const precise: Precise | null = useMemo(
    () => (linked && result ? { taxable: result.totalTaxable, basic: result.basicDeduction, payable: result.totalPayable, needsFiling: result.needsFiling } : null),
    [linked, result],
  );
  const verdict: Verdict | undefined = precise ? (!precise.needsFiling ? "none" : precise.payable > 0 ? "likely" : "relief") : undefined;

  const { tasks, est } = useMemo(() => (valid ? buildTasks(iv, { verdict }) : { tasks: [] as Task[], est: null }), [iv, valid, verdict]);
  const steps = filingSteps(c.decedent.deathDate === iv.deathDate ? c : { ...c, progress: { completed: [] } }, result);
  const main = tasks.filter((t) => !t.optional);
  const optional = tasks.filter((t) => t.optional);
  const filing = main.some((t) => t.id === "inheritance-tax");
  const doneTasks = main.filter((t) => done.includes(t.id)).length;
  const doneSteps = filing ? steps.filter((s) => s.done).length : 0;
  const docs = collectDocs(main);
  const doneDocs = docs.filter((d) => done.includes(`doc:${d.doc.id}`)).length;
  const total = main.length + (filing ? steps.length : 0) + docs.length;
  const pct = total ? Math.round(((doneTasks + doneSteps + doneDocs) / total) * 100) : 0;
  const next = main.find((t) => !done.includes(t.id));

  const groups = useMemo(() => {
    const g = new Map<string, Task[]>();
    for (const t of main) {
      if (!showDone && done.includes(t.id)) continue;
      const k = periodOf(iv.deathDate, t.date);
      g.set(k, [...(g.get(k) ?? []), t]);
    }
    return [...g.entries()];
  }, [main, iv.deathDate, showDone, done]);

  const context = useCallback(
    () =>
      [
        `亡くなった日：${iv.deathDate}`,
        est ? `相続人の数（相続税法15条）：${est.heirCount}人、基礎控除：${est.basicDeduction}円、相続税の判定：${verdict ?? est.verdict}` : "",
        precise ? `計算エンジンの結果：課税価格の合計 ${precise.taxable}円、納付税額の合計 ${precise.payable}円` : "",
        `相続税申告の進み具合：${steps.map((s) => `${s.title}${s.done ? "（済）" : ""}`).join("、")}`,
        "手続きリスト（期限順）：",
        ...tasks.map((t) => `- ${t.date} ${t.hard ? "期限" : "目安"} ${t.title}${done.includes(t.id) ? "（済）" : ""}`),
      ]
        .filter(Boolean)
        .join("\n"),
    [iv.deathDate, est, verdict, precise, steps, tasks, done],
  );
  const askState = useAsk("plan", context);
  const onAsk = (q: string) => {
    askState.ask(q);
    document.getElementById("ask-compass")?.scrollIntoView({ behavior: "smooth" });
  };
  const showDoc = (id: string) => {
    setTab("docs");
    setFocusDoc(id);
  };

  if (!loaded) return <div className="h-96" />;
  if (!valid || !est)
    return (
      <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center">
        <p>まず、亡くなった日などを教えてください。</p>
        <Link href="/start" className="mt-4 inline-block rounded-lg bg-sky-700 px-6 py-3 font-semibold text-white">
          聞き取りへ
        </Link>
      </div>
    );

  const host = typeof window !== "undefined" ? window.location.host : "";
  const feedPath = `/api/calendar?d=${encodeInterview(iv)}`;
  const googleSubscribe = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(`webcal://${host}${feedPath}`)}`;
  const appleSubscribe = `webcal://${host}${feedPath}`;
  function downloadICS() {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const ics = toICS(main, { name: "相続の手続き（相続コンパス）", stamp, appUrl: `${window.location.origin}/` });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "souzoku-tetsuzuki.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const row = (t: Task) => (
    <TaskRow
      key={t.id}
      t={t}
      done={done.includes(t.id)}
      onToggle={() => toggle(t.id)}
      now={now}
      onAsk={onAsk}
      address={iv.address}
      steps={t.id === "inheritance-tax" && filing ? steps : undefined}
      onShowDoc={showDoc}
    />
  );

  return (
    <div className="space-y-5">
      {/* 全体の進み具合 */}
      <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-5">
          <Ring pct={pct} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-sky-800">{iv.decedentName ? `${iv.decedentName}さんの相続` : "あなたの相続"}</p>
            <h2 className="text-xl font-bold text-stone-900">全体の進み具合</h2>
            <p className="text-sm text-stone-600">亡くなった日：{jpDate(iv.deathDate)}</p>
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
              <Meter label="手続き" done={doneTasks} total={main.length} onClick={() => setTab("list")} />
              <Meter label="書類集め" done={doneDocs} total={docs.length} onClick={() => setTab("docs")} />
              {filing ? <Meter label="相続税の申告書" done={doneSteps} total={steps.length} href={`/case/${steps.find((s) => !s.done)?.slug ?? "documents"}`} /> : <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900">相続税の申告書：不要の見込み</div>}
            </div>
          </div>
          <Link href="/start" className="self-start text-sm text-sky-800 underline">
            聞き取りの答えを直す
          </Link>
        </div>
        {next && (
          <div className="mt-4 flex items-start gap-3">
            <CompassAvatar size={48} />
            <Bubble className="flex-1">
              次は<strong>「{next.title}」</strong>です（{next.hard ? "期限" : "目安"}：{jpDate(next.date)}）。
              {next.docs.length > 0 && <>必要な書類は「書類集め」で確認できます。</>}
            </Bubble>
          </div>
        )}
      </section>

      <TaxVerdict est={est} spouse={iv.spouse} precise={precise} />

      {/* タブ */}
      <div className="sticky top-16 z-20 -mx-1 flex gap-1 rounded-xl bg-stone-100/95 p-1 backdrop-blur" role="tablist">
        {(
          [
            ["list", `手続きリスト（${main.length}）`],
            ["docs", `書類集め（${docs.length}）`],
            ["calendar", "カレンダー"],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${tab === k ? "bg-white text-sky-900 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "list" && (
        <div className="space-y-5">
          {doneTasks > 0 && (
            <button type="button" onClick={() => setShowDone((v) => !v)} className="text-sm text-sky-800 underline">
              {showDone ? "済んだ手続きを隠す" : `済んだ手続き（${doneTasks}件）も表示する`}
            </button>
          )}
          {groups.map(([period, items]) => (
            <section key={period}>
              <h3 className="mb-2 text-sm font-bold text-stone-500">{period}</h3>
              <ul className="space-y-2">{items.map(row)}</ul>
            </section>
          ))}
          {optional.length > 0 && (
            <section>
              <button type="button" onClick={() => setShowOptional((s) => !s)} className="text-sm font-bold text-sky-800">
                {showOptional ? "▲" : "▼"} 該当する場合だけ行う手続き（{optional.length}件）
              </button>
              {showOptional && <ul className="mt-2 space-y-2">{optional.map(row)}</ul>}
            </section>
          )}
          <p className="text-xs leading-relaxed text-stone-500">
            期限は亡くなった日を起算日として計算しています。法律上の期限が土日にあたる場合は翌月曜日にしていますが、祝日・年末年始は考慮していません。法要の日付は仏式の一般的な数え方です。
          </p>
        </div>
      )}

      {tab === "docs" && <DocsPanel tasks={main} done={done} toggle={toggle} address={iv.address} focus={focusDoc} />}

      {tab === "calendar" && (
        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h3 className="font-bold text-stone-900">カレンダーにまとめて入れる</h3>
          <p className="mt-1 text-sm text-stone-600">{main.length}件の手続きを、期限の日の予定として追加します。法律上の期限があるものは1週間前と前日に通知します。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={googleSubscribe} target="_blank" rel="noreferrer" className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800">
              Googleカレンダーにまとめて追加
            </a>
            <a href={appleSubscribe} className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold hover:bg-stone-50">
              iPhone・Macのカレンダーに追加
            </a>
            <button type="button" onClick={downloadICS} className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-semibold hover:bg-stone-50">
              ファイル（.ics）をダウンロード
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-stone-500">
            「まとめて追加」は、相続の手続き専用のカレンダーとして追加されます（不要になったらカレンダーごと削除できます）。追加用のURLには亡くなった日と答えの内容（お名前・住所は除く）が含まれます。
          </p>
        </section>
      )}

      <AskCompass id="ask-compass" state={askState} placeholder="例：四十九日までに何を準備すればいい？" lead="手続きのことで分からないことがあれば、なんでも聞いてくださいね。" />
    </div>
  );
}

function Meter({ label, done, total, onClick, href }: { label: string; done: number; total: number; onClick?: () => void; href?: string }) {
  const inner = (
    <>
      <div className="flex justify-between">
        <span className="font-semibold text-stone-700">{label}</span>
        <span className="tabular-nums text-stone-600">
          {done}/{total}
        </span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-stone-200">
        <div className="h-full bg-sky-600" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
    </>
  );
  const cls = "block rounded-lg border border-stone-200 px-3 py-2 text-left hover:border-sky-400";
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  );
}
