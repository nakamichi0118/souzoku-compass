"use client";

import Link from "next/link";
import { useCallback } from "react";
import { AskCompass, useAsk } from "@/components/compass/AskCompass";
import { Bubble, CompassAvatar } from "@/components/compass/CompassKun";
import { MonthCalendar } from "@/components/plan/MonthCalendar";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { Panel } from "@/components/ui/Panel";
import { daysBetween, jpDate } from "@/domain/procedures/dates";
import { useOverall } from "@/lib/overall";
import { daysLeftLabel, taskStatus } from "@/lib/taskStatus";
import { CatIcon } from "./icons";
import { STEPS } from "@/lib/steps";

const man = (n: number) => `約${Math.round(n / 10_000).toLocaleString("ja-JP")}万円`;

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
  const upcoming = o.main.filter((t) => !o.closed(t.id) && t.id !== o.next?.id).slice(0, 6);
  const nextStep = o.steps.find((s) => !s.done);
  const verdict = o.verdict ?? o.est.verdict;
  const taxNeeded = verdict === "likely" || verdict === "relief";
  const cats = [...o.byCategory.entries()].filter(([k]) => k !== "その他" && k !== "年金・税金");

  return (
    <AppShell wide>
      <PageHead
        title={`ようこそ、${o.account?.name ?? ""}さん`}
        say={o.next ? "今日はここから始めましょう。終わったら、やることリストでチェックを付けてくださいね。" : "すべての手続きが終わりました。おつかれさまでした！"}
      />
      {o.next && (
        <section className="mb-5 flex flex-wrap items-center gap-4 rounded-2xl border-2 border-brand/40 bg-brand-soft p-5">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-brand">次にすること</p>
            <p className="mt-1 text-xl font-bold text-stone-900">{o.next.title}</p>
            <p className="mt-1 text-sm text-stone-600">
              {o.next.hard ? "期限" : "目安"} {jpDate(o.next.date)}（{daysLeftLabel(o.now, o.next.date)}）
              {o.next.office && o.next.dept ? `・${o.next.dept}` : ""}
            </p>
          </div>
          <Link href={o.next.id === "inheritance-tax" && nextStep ? `/case/${nextStep.slug}` : `/my/tasks?id=${o.next.id}`} className="rounded-full bg-brand px-7 py-3 font-bold text-white shadow hover:brightness-95">
            続きを進める ›
          </Link>
        </section>
      )}
      {taxNeeded && <Journey o={o} />}
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="このあとの手続き" more={{ href: "/my/tasks", label: "すべてのタスクを見る" }}>
            <p className="-mt-2 mb-3 text-sm text-stone-500">期限の近いものから進めましょう。</p>
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {upcoming.map((t) => {
                const st = taskStatus(t, o.statusOf(t.id), o.now);
                return (
                  <li key={t.id}>
                    <Link href={`/my/tasks?id=${t.id}`} className="flex h-full flex-col rounded-xl border border-stone-200 bg-white p-3 hover:border-sky-400">
                      <span className={`self-start rounded-full px-2 py-0.5 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                      <span className="mt-2 line-clamp-2 text-sm font-bold text-stone-900">{t.title}</span>
                      <span className="mt-auto pt-2 text-xs text-stone-500">{t.hard ? "期限" : "目安"} {jpDate(t.date)}（{daysLeftLabel(o.now, t.date)}）</span>
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
            <Panel title={`相続税申告の進捗（${STEPS.length}ステップ）`} more={{ href: `/case/${nextStep?.slug ?? "documents"}`, label: "申告書づくりへ" }}>
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
                  納める税額は0円の見込み。<span className="text-orange-600">申告は必要</span>です
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

/** 相続税の申告までの全体の流れ。いまどの段階で、どの画面を見ればよいかを示す */
function Journey({ o }: { o: ReturnType<typeof useOverall> }) {
  const completed = o.case.progress?.completed ?? [];
  const docs = o.docs.filter((d) => !d.na);
  const docsDone = docs.length > 0 && docs.every((d) => d.done);
  const days = daysBetween(o.iv.deathDate, o.now);
  const phase = completed.includes("division") ? 3 : completed.includes("assets") ? 2 : docsDone ? 2 : days < 30 ? 0 : 1;
  const steps = [
    { title: "手続き", when: "亡くなってすぐ〜3か月", text: "役所・年金・保険などの届出", href: "/my/tasks", go: "やることリスト" },
    { title: "資料集め", when: "1〜3か月ごろ（1〜2か月かかります）", text: "残高証明書・名寄帳などを取り寄せる", href: "/my/docs", go: "資料集め" },
    { title: "財産の評価と分け方", when: "資料がそろったら〜8か月", text: "財産を登録して評価し、誰が受け取るか決める", href: "/case/assets", go: "財産と相続税" },
    { title: "申告と納付", when: "10か月以内", text: "申告書を作って税務署へ出し、納める", href: "/case/tax", go: "相続税の申告" },
  ];
  return (
    <section className="mb-5 rounded-2xl border border-stone-200 bg-white p-4">
      <p className="mb-3 font-bold text-stone-800">相続税の申告までの流れ</p>
      <ol className="grid gap-2 sm:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Link
              href={s.href}
              className={`flex h-full flex-col rounded-xl border p-3 ${i === phase ? "border-brand bg-brand-soft" : i < phase ? "border-emerald-200 bg-emerald-50/40" : "border-stone-200 hover:border-sky-300"}`}
            >
              <span className={`text-xs font-bold ${i === phase ? "text-brand" : i < phase ? "text-emerald-700" : "text-stone-500"}`}>
                {i < phase ? "✓ " : `${i + 1}. `}
                {i === phase ? "いまここ" : s.when}
              </span>
              <span className="mt-1 font-bold text-stone-900">{s.title}</span>
              <span className="mt-0.5 text-xs text-stone-600">{s.text}</span>
              <span className="mt-auto pt-2 text-xs font-semibold text-sky-800">{s.go} ›</span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
