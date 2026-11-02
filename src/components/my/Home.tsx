"use client";

import Link from "next/link";
import { useCallback } from "react";
import { AskCompass, useAsk } from "@/components/compass/AskCompass";
import { Bubble, CompassAvatar } from "@/components/compass/CompassKun";
import { MonthCalendar } from "@/components/plan/MonthCalendar";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { daysBetween, jpDate } from "@/domain/procedures/dates";
import type { Task } from "@/domain/procedures/rules";
import { useOverall } from "@/lib/overall";
import type { ItemStatus } from "@/lib/planStore";
import { CatIcon } from "./icons";

const man = (n: number) => `約${Math.round(n / 10_000).toLocaleString("ja-JP")}万円`;

export function Panel({ title, more, children, className = "" }: { title: string; more?: { href: string; label?: string }; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-sky-100 bg-white p-5 shadow-sm ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-bold text-sky-950">{title}</h2>
        {more && (
          <Link href={more.href} className="text-sm text-sky-700 hover:underline">
            {more.label ?? "詳しく見る"} ›
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

export function taskStatus(t: Task, st: ItemStatus, now: string) {
  if (st === "na") return { label: "不要", cls: "bg-stone-200 text-stone-600" };
  if (st === "done") return { label: "✓ 完了", cls: "bg-emerald-100 text-emerald-800" };
  const left = daysBetween(now, t.date);
  if (left < 0) return { label: `${-left}日超過`, cls: "bg-rose-100 text-rose-800" };
  if (t.hard) return { label: "期限あり", cls: "bg-orange-100 text-orange-800" };
  return { label: "未着手", cls: "bg-stone-100 text-stone-600" };
}

export function Home() {
  const o = useOverall();
  const context = useCallback(
    () =>
      [`亡くなった日：${o.iv.deathDate}`, `全体の進捗：${o.pct}%`, ...o.main.map((t) => `- ${t.date} ${t.hard ? "期限" : "目安"} ${t.title}${o.done.includes(t.id) ? "（済）" : ""}`)].join("\n"),
    [o.iv.deathDate, o.pct, o.main, o.done],
  );
  const ask = useAsk("home", context);
  if (!o.loaded) return <AppShell>{null}</AppShell>;

  if (!o.heard || !o.valid || !o.est)
    return (
      <AppShell>
        <PageHead title={`ようこそ、${o.account?.name ?? ""}さん`} say="マイページができました！まずは、亡くなった方とご家族のことを教えてください。" />
        <div className="rounded-2xl border-2 border-sky-300 bg-white p-8 text-center shadow-sm">
          <p className="text-lg font-bold text-sky-950">最初に、状況を教えてください（約3分）</p>
          <p className="mt-2 text-stone-600">答えにあわせて、あなたに必要な手続き・集める書類・期限をこのマイページに並べます。</p>
          <Link href="/my/hearing" className="mt-5 inline-block rounded-full bg-sky-700 px-8 py-3 font-bold text-white hover:bg-sky-800">
            質問に答える ›
          </Link>
        </div>
      </AppShell>
    );

  // ホームには、まだ済んでいない手続きを期限の近い順に（全体はやることリストで）
  const upcoming = o.main.filter((t) => !o.closed(t.id)).slice(0, 6);
  const nextStep = o.steps.find((s) => !s.done);
  const verdict = o.verdict ?? o.est.verdict;
  const taxNeeded = verdict === "likely" || verdict === "relief";
  const cats = [...o.byCategory.entries()].filter(([k]) => k !== "その他" && k !== "年金・税金");

  return (
    <AppShell wide>
      <PageHead
        title={`ようこそ、${o.account?.name ?? ""}さん`}
        say={o.next ? <>まずは、次にやることを確認しましょう。次は「{o.next.title}」です。</> : "すべての手続きが終わりました。おつかれさまでした！"}
      />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="やることリスト" more={{ href: "/my/tasks", label: "すべてのタスクを見る" }}>
            <p className="-mt-2 mb-3 text-sm text-stone-500">期限の近いものから進めましょう。</p>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {upcoming.map((t) => {
                const d = false;
                const st = taskStatus(t, o.statusOf(t.id), o.now);
                return (
                  <li key={t.id}>
                    <Link href={`/my/tasks?id=${t.id}`} className={`flex h-full flex-col rounded-xl border p-3 hover:border-sky-400 ${d ? "border-emerald-200 bg-emerald-50/50" : "border-stone-200 bg-white"}`}>
                      <span className={`self-start rounded-full px-2 py-0.5 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                      <span className={`mt-2 line-clamp-2 text-sm font-bold ${d ? "text-stone-500" : "text-stone-900"}`}>{t.title}</span>
                      <span className="mt-auto pt-2 text-xs text-stone-500">{t.hard ? "期限" : "目安"} {jpDate(t.date)}（{daysBetween(o.now, t.date) >= 0 ? `あと${daysBetween(o.now, t.date)}日` : "過ぎています"}）</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="資料集めの進み具合" more={{ href: "/my/docs" }}>
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {cats.map(([k, all]) => {
                const items = all.filter((d) => !d.na);
                const n = items.filter((d) => d.done).length;
                const pct = items.length ? Math.round((n / items.length) * 100) : 100;
                return (
                  <li key={k}>
                    <Link href="/my/docs" className="block rounded-xl bg-sky-50/60 p-3 text-center hover:bg-sky-100/60">
                      <CatIcon k={k} className="mx-auto h-6 w-6" />
                      <p className="text-sm font-semibold text-stone-800">{k}</p>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white">
                        <div className={`h-full ${pct === 100 ? "bg-emerald-500" : "bg-sky-500"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <p className="mt-0.5 text-xs tabular-nums text-stone-500">{pct === 100 ? "✓ そろった" : `${n}/${items.length}`}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>

          {o.filing && (
            <Panel title="相続税申告の進捗（7ステップ）" more={{ href: `/case/${nextStep?.slug ?? "documents"}`, label: "申告書づくりへ" }}>
              <ol className="flex items-start justify-between">
                {o.steps.map((s, i) => (
                  <li key={s.slug} className="flex flex-1 flex-col items-center text-center">
                    <div className="flex w-full items-center">
                      <span className={`h-0.5 flex-1 ${i === 0 ? "bg-transparent" : o.steps[i - 1].done ? "bg-emerald-400" : "bg-stone-200"}`} />
                      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${s.done ? "bg-emerald-500 text-white" : s === nextStep ? "bg-sky-700 text-white" : "border-2 border-stone-300 bg-white text-stone-500"}`}>
                        {s.done ? "✓" : i + 1}
                      </span>
                      <span className={`h-0.5 flex-1 ${i === o.steps.length - 1 ? "bg-transparent" : s.done ? "bg-emerald-400" : "bg-stone-200"}`} />
                    </div>
                    <span className={`mt-1 text-[11px] ${s === nextStep ? "font-bold text-sky-800" : "text-stone-600"}`}>{s.title}</span>
                  </li>
                ))}
              </ol>
              {nextStep && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <CompassAvatar size={40} />
                  <Bubble className="min-w-0 flex-1">続いて「{nextStep.title}」へ進みましょう。</Bubble>
                  <Link href={`/case/${nextStep.slug}`} className="rounded-full bg-sky-700 px-5 py-2 text-sm font-bold text-white hover:bg-sky-800">
                    次へ（{nextStep.title}） ›
                  </Link>
                </div>
              )}
            </Panel>
          )}

          <AskCompass state={ask} placeholder="例：この手続きは何をするの？" lead="困ったときは、なんでも聞いてくださいね。" />
          <div className="-mt-3 flex flex-wrap gap-2">
            {["四十九日までに何を準備すればいい？", "必要な書類を知りたい", "相続税の計算方法を知りたい"].map((q) => (
              <button key={q} type="button" onClick={() => ask.ask(q)} className="rounded-full border border-sky-200 bg-white px-3 py-1 text-sm text-sky-900 hover:bg-sky-50">
                ？ {q}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <Panel title="相続税の見込み" more={{ href: o.precise ? "/case/tax" : "/case/assets", label: "詳しく確認" }}>
            <p className="text-lg font-bold leading-snug text-stone-900">
              {verdict === "none" ? (
                <>
                  相続税は<span className="text-emerald-700">かからない見込み</span>です
                </>
              ) : verdict === "relief" ? (
                <>
                  特例で0円の見込み。<span className="text-orange-600">申告は必要</span>です
                </>
              ) : verdict === "likely" ? (
                <>
                  <span className="text-orange-600">相続税申告が必要</span>そうです
                </>
              ) : (
                <>基礎控除に近いので、財産を確定して確認しましょう</>
              )}
            </p>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <dt className="text-stone-500">{o.precise ? "課税価格の合計" : "財産の合計（目安）"}</dt>
              <dd className="text-right font-semibold tabular-nums">{man(o.precise ? o.precise.taxable : o.est.taxableTotal)}</dd>
              <dt className="text-stone-500">基礎控除</dt>
              <dd className="text-right font-semibold tabular-nums">{man(o.precise ? o.precise.basic : o.est.basicDeduction)}</dd>
              {taxNeeded && (
                <>
                  <dt className="text-stone-500">{o.precise ? "納める相続税の合計" : "相続税の目安"}</dt>
                  <dd className="text-right font-bold tabular-nums text-orange-700">{man(o.precise ? o.precise.payable : o.est.roughTaxAfterSpouse)}</dd>
                </>
              )}
            </dl>
            <p className="mt-2 text-xs text-stone-500">{o.precise ? "財産を評価した計算結果です。" : "聞き取りの金額による目安です。財産を評価すると正確になります。"}</p>
          </Panel>

          <Panel title="スケジュール" more={{ href: "/my/calendar", label: "すべて見る" }}>
            <MonthCalendar tasks={o.live} done={o.done} today={o.now} compact />
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
