"use client";

import Link from "next/link";
import { useCallback } from "react";
import { AskCompass, useAsk } from "@/components/compass/AskCompass";
import { MonthCalendar } from "@/components/plan/MonthCalendar";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { Panel } from "@/components/ui/Panel";
import { jpDate } from "@/domain/procedures/dates";
import { useOverall } from "@/lib/overall";
import { daysLeftLabel, lateBadge } from "@/lib/taskStatus";
import { CatIcon } from "./icons";
import { MilestoneFlow } from "./MilestoneView";

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
        <PageHead title={`ようこそ、${o.account?.name ?? ""}さん`} say="まずは状況を教えてください（約3分）。" />
        <Link href="/my/hearing" className="inline-block rounded-full bg-sky-700 px-8 py-3 font-bold text-white hover:bg-sky-800">
          質問に答える ›
        </Link>
      </AppShell>
    );

  // ホームには、まだ済んでいない手続きを期限の近い順に3件だけ（全体はやることリストで）
  const upcoming = o.main.filter((t) => !o.closed(t.id) && t.id !== o.next?.id).slice(0, 3);
  const nextStep = o.steps.find((s) => !s.done);
  const verdict = o.verdict ?? o.est.verdict;
  const taxNeeded = verdict === "likely" || verdict === "relief";
  const cats = [...o.byCategory.entries()].filter(([k]) => k !== "その他" && k !== "年金・税金");
  const flow = { tasks: o.main, done: o.done, today: o.now, death: o.iv.deathDate };

  return (
    <AppShell wide>
      <PageHead
        title={`ようこそ、${o.account?.name ?? ""}さん`}
        say={o.next ? "今日はここから始めましょう。" : "すべての手続きが終わりました、おつかれさまでした。"}
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
      <Panel title="手続きの流れ" more={{ href: "/my/calendar", label: "カレンダーで見る" }}>
        {/* 横にはみ出さないように、狭い画面では今日のまわりの区切りだけを出す。スマホでは枠の内側の余白を少し使って、名前の幅をとる */}
        <div className="-mx-2 sm:hidden">
          <MilestoneFlow {...flow} around={{ before: 1, after: 2 }} dense />
        </div>
        <div className="hidden sm:block lg:hidden">
          <MilestoneFlow {...flow} around={{ before: 1, after: 4 }} />
        </div>
        <div className="hidden lg:block">
          <MilestoneFlow {...flow} />
        </div>
      </Panel>
      {/* grid-cols-1：スマホで、長い手続きの名前に合わせて列が広がり、横にはみ出さないように */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Panel title="このあとの手続き" more={{ href: "/my/tasks", label: "すべて見る" }}>
            <ul className="grid gap-3 md:grid-cols-3">
              {upcoming.map((t) => {
                // 札は期限を過ぎたときの「3日超過」だけ。期限があるかは日付の色で分かる
                const late = lateBadge(t, o.statusOf(t.id), o.now);
                return (
                  <li key={t.id}>
                    <Link href={`/my/tasks?id=${t.id}`} className="flex h-full flex-col rounded-xl border border-stone-200 bg-white p-3 hover:border-sky-400">
                      {late && <span className={`mb-2 self-start rounded-full px-2 py-0.5 text-[11px] font-bold ${late.cls}`}>{late.label}</span>}
                      <span className="line-clamp-2 text-sm font-bold text-stone-900">{t.title}</span>
                      <span className={`mt-auto pt-2 text-xs ${t.hard ? "font-semibold text-orange-700" : "text-stone-500"}`}>
                        {t.hard ? "期限" : "目安"} {jpDate(t.date)}（{daysLeftLabel(o.now, t.date)}）
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <Panel title="資料集め" more={{ href: "/my/docs" }}>
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
            // 次のステップがあるときは、下の「次へ」と同じ先なので右上のリンクは出さない
            <Panel title="相続税申告の進み具合" more={nextStep ? undefined : { href: "/case/documents", label: "申告書づくりへ" }}>
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
              {/* 吹き出しは出さず、ボタンだけ（スマホで吹き出しが押しつぶされて1文字ずつ折れないように） */}
              {nextStep && (
                <div className="mt-4 flex justify-end">
                  <Link href={`/case/${nextStep.slug}`} className="rounded-full bg-sky-700 px-5 py-2 text-sm font-bold text-white hover:bg-sky-800">
                    次へ（{nextStep.title}） ›
                  </Link>
                </div>
              )}
            </Panel>
          )}

          {/* 吹き出しは答えが出てから出す（見出しと質問ボタンで、何ができるかは分かる） */}
          <AskCompass state={ask} placeholder="例：この手続きは何をするの？" lead={null} />
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
            <p className="mt-2 text-xs text-stone-500">{o.precise ? "財産を評価した結果です。" : "聞き取りからの目安です。"}</p>
          </Panel>

          <Panel title="スケジュール" more={{ href: "/my/calendar", label: "すべて見る" }}>
            <MonthCalendar tasks={o.live} done={o.done} today={o.now} compact />
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
