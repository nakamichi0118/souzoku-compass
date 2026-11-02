"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TaxVerdict } from "@/components/plan/TaxVerdict";
import { daysBetween, isValidDate, jpDate } from "@/domain/procedures/dates";
import { googleEventUrl, toICS } from "@/domain/procedures/calendar";
import { buildTasks, periodOf, type Task } from "@/domain/procedures/rules";
import { encodeInterview } from "@/domain/procedures/share";
import { usePlan } from "@/lib/planStore";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function TaskRow({ t, done, onToggle, now, onAsk }: { t: Task; done: boolean; onToggle: () => void; now: string; onAsk: (q: string) => void }) {
  const [open, setOpen] = useState(false);
  const left = daysBetween(now, t.date);
  const state = done ? "done" : left < 0 ? "over" : left <= 7 ? "soon" : "later";
  return (
    <li className={`rounded-xl border bg-white ${state === "over" && t.hard ? "border-rose-300" : t.important && !done ? "border-amber-300" : "border-stone-200"}`}>
      <div className="flex items-start gap-3 p-4">
        <input type="checkbox" checked={done} onChange={onToggle} className="mt-1 h-5 w-5 shrink-0 accent-teal-700" aria-label={`${t.title}を済みにする`} />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded px-1.5 py-0.5 font-bold ${t.hard ? "bg-rose-100 text-rose-800" : "bg-stone-100 text-stone-600"}`}>{t.hard ? "期限" : "目安"}</span>
            <span className={`font-semibold tabular-nums ${state === "over" ? "text-rose-700" : state === "soon" ? "text-amber-700" : "text-stone-600"}`}>
              {jpDate(t.date)}
              {!done && (left < 0 ? `（${-left}日過ぎています）` : left === 0 ? "（今日）" : left <= 60 ? `（あと${left}日）` : "")}
            </span>
            <span className="text-stone-400">{t.category}</span>
            {t.important && !done && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800">重要</span>}
          </div>
          <p className={`mt-1 font-bold ${done ? "text-stone-400 line-through" : "text-stone-900"}`}>{t.title}</p>
        </button>
        <span className="mt-1 text-stone-400" aria-hidden>
          {open ? "▲" : "▼"}
        </span>
      </div>
      {open && (
        <div className="space-y-3 border-t border-stone-100 px-4 py-4 pl-12 text-sm leading-relaxed text-stone-700">
          <p>{t.what}</p>
          {t.limit && <p className="text-rose-800">⚠ {t.limit.text}（{jpDate(t.limit.date)}まで）</p>}
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[6rem_1fr]">
            <dt className="font-semibold text-stone-500">どこで</dt>
            <dd>{t.where}</dd>
            {t.bring.length > 0 && (
              <>
                <dt className="font-semibold text-stone-500">持ち物</dt>
                <dd>{t.bring.join("、")}</dd>
              </>
            )}
            {t.law && (
              <>
                <dt className="font-semibold text-stone-500">根拠</dt>
                <dd>{t.law}</dd>
              </>
            )}
            {t.source && (
              <>
                <dt className="font-semibold text-stone-500">参考</dt>
                <dd>
                  {t.source.url ? (
                    <a href={t.source.url} target="_blank" rel="noreferrer" className="text-teal-800 underline">
                      {t.source.label}
                    </a>
                  ) : (
                    t.source.label
                  )}
                </dd>
              </>
            )}
          </dl>
          <div className="flex flex-wrap gap-2 pt-1">
            {t.link && (
              <Link href={t.link.href} className="rounded-lg bg-teal-700 px-3 py-1.5 font-semibold text-white hover:bg-teal-800">
                {t.link.label} →
              </Link>
            )}
            <a href={googleEventUrl(t)} target="_blank" rel="noreferrer" className="rounded-lg border border-stone-300 px-3 py-1.5 hover:bg-stone-50">
              この予定だけGoogleカレンダーに追加
            </a>
            <button type="button" onClick={() => onAsk(`「${t.title}」について、具体的に何をすればいいか教えてください。`)} className="rounded-lg border border-teal-300 px-3 py-1.5 text-teal-800 hover:bg-teal-50">
              Claudeに聞く
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function PlanPage() {
  const { iv, done, toggle, loaded } = usePlan();
  const [showOptional, setShowOptional] = useState(false);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = today();
  const valid = isValidDate(iv.deathDate);
  const { tasks, est } = useMemo(() => (valid ? buildTasks(iv) : { tasks: [], est: null }), [iv, valid]);
  const main = tasks.filter((t) => !t.optional);
  const optional = tasks.filter((t) => t.optional);
  const doneCount = main.filter((t) => done.includes(t.id)).length;
  const next = main.find((t) => !done.includes(t.id));

  const groups = useMemo(() => {
    const g = new Map<string, Task[]>();
    for (const t of main) {
      const k = periodOf(iv.deathDate, t.date);
      g.set(k, [...(g.get(k) ?? []), t]);
    }
    return [...g.entries()];
  }, [main, iv.deathDate]);

  if (!loaded) return null;
  if (!valid || !est)
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p>まず、亡くなった日などを教えてください。</p>
        <Link href="/start" className="mt-4 inline-block rounded-lg bg-teal-700 px-6 py-3 font-semibold text-white">
          聞き取りへ
        </Link>
      </main>
    );

  const enc = encodeInterview(iv);
  const feedPath = `/api/calendar?d=${enc}`;
  const host = typeof window !== "undefined" ? window.location.host : "";
  const googleSubscribe = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(`webcal://${host}${feedPath}`)}`;
  const appleSubscribe = `webcal://${host}${feedPath}`;

  function downloadICS() {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const ics = toICS(main, { name: "相続の手続き（相続コンパス）", stamp, appUrl: `${window.location.origin}/plan` });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "souzoku-tetsuzuki.ics";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function ask(question: string) {
    if (!question.trim()) return;
    setQ(question);
    setBusy(true);
    setAnswer(null);
    const context = [
      `亡くなった日：${iv.deathDate}`,
      `相続人の数（相続税法15条）：${est!.heirCount}人、基礎控除：${est!.basicDeduction}円、財産の合計の目安：${est!.taxableTotal}円、判定：${est!.verdict}`,
      `手続きリスト（期限順）：`,
      ...tasks.map((t) => `- ${t.date} ${t.hard ? "期限" : "目安"} ${t.title}${done.includes(t.id) ? "（済）" : ""}`),
    ].join("\n");
    try {
      const res = await fetch("/api/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "plan", question, context: context.slice(0, 6000) }),
      });
      const json = await res.json();
      setAnswer(json.answer ?? json.error ?? "回答を取得できませんでした。");
    } catch {
      setAnswer("通信に失敗しました。時間をおいてお試しください。");
    } finally {
      setBusy(false);
    }
    document.getElementById("ask-box")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-20 pt-8">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-sm font-bold text-teal-800">
          ← 相続コンパス
        </Link>
        <Link href="/start" className="text-sm text-teal-800 underline">
          答えを直す
        </Link>
      </div>
      <h1 className="mt-4 text-2xl font-bold text-stone-900">{iv.decedentName ? `${iv.decedentName}さんの` : ""}相続の手続きリスト</h1>
      <p className="mt-1 text-sm text-stone-600">
        亡くなった日：{jpDate(iv.deathDate)}　／　あなたの家族に必要な手続きは <strong>{main.length}件</strong>（済み {doneCount}件）
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-stone-200" aria-hidden>
        <div className="h-full bg-teal-600" style={{ width: `${main.length ? (doneCount / main.length) * 100 : 0}%` }} />
      </div>

      <div className="mt-6 space-y-5">
        <TaxVerdict est={est} spouse={iv.spouse} />

        {next && (
          <section className="rounded-2xl border border-teal-300 bg-teal-50 p-5">
            <p className="text-xs font-bold text-teal-800">次にやること</p>
            <p className="mt-1 text-lg font-bold text-stone-900">{next.title}</p>
            <p className="text-sm text-stone-600">
              {next.hard ? "期限" : "目安"}：{jpDate(next.date)}
            </p>
          </section>
        )}

        <section className="rounded-2xl border border-stone-200 bg-white p-5">
          <h2 className="font-bold text-stone-900">カレンダーに入れる</h2>
          <p className="mt-1 text-sm text-stone-600">下の{main.length}件の手続きを、期限の日の予定としてまとめて追加します。期限のあるものは1週間前と前日に通知します。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={googleSubscribe} target="_blank" rel="noreferrer" className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">
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
            「まとめて追加」は、相続の手続き専用のカレンダーとして追加されます（不要になったらカレンダーごと削除できます）。追加用のURLには亡くなった日と答えの内容（お名前は除く）が含まれます。
          </p>
        </section>

        {groups.map(([period, items]) => (
          <section key={period}>
            <h2 className="mb-2 mt-2 text-sm font-bold text-stone-500">{period}</h2>
            <ul className="space-y-2">
              {items.map((t) => (
                <TaskRow key={t.id} t={t} done={done.includes(t.id)} onToggle={() => toggle(t.id)} now={now} onAsk={ask} />
              ))}
            </ul>
          </section>
        ))}

        {optional.length > 0 && (
          <section>
            <button type="button" onClick={() => setShowOptional((s) => !s)} className="text-sm font-bold text-teal-800">
              {showOptional ? "▲" : "▼"} 該当する場合だけ行う手続き（{optional.length}件）
            </button>
            {showOptional && (
              <ul className="mt-2 space-y-2">
                {optional.map((t) => (
                  <TaskRow key={t.id} t={t} done={done.includes(t.id)} onToggle={() => toggle(t.id)} now={now} onAsk={ask} />
                ))}
              </ul>
            )}
          </section>
        )}

        <section id="ask-box" className="space-y-2 rounded-2xl border border-teal-200 bg-teal-50/60 p-5">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-teal-700 text-xs font-bold text-white">C</span>
            <p className="font-bold text-teal-900">分からないことはClaudeに</p>
          </div>
          <textarea
            rows={2}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="例：四十九日までに何を準備すればいい？"
            className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
          />
          <button type="button" onClick={() => ask(q)} disabled={busy || !q.trim()} className="w-full rounded-lg bg-teal-700 px-3 py-2 text-sm font-semibold text-white disabled:bg-stone-300">
            {busy ? "考えています…" : "Claudeに聞く"}
          </button>
          {answer && <div className="whitespace-pre-wrap rounded-lg bg-white p-3 text-sm leading-relaxed text-stone-800">{answer}</div>}
          <p className="text-xs text-stone-500">手続きの期限と相続税の判定は、決まったルールで計算しています。Claudeは説明だけを担当します。</p>
        </section>

        <p className="text-xs leading-relaxed text-stone-500">
          期限は亡くなった日を起算日として計算した目安です。法律上の期限が土日にあたる場合は翌月曜日にしていますが、祝日・年末年始は考慮していません。法要の日付は仏式の一般的な数え方です。
        </p>
      </div>
    </main>
  );
}
