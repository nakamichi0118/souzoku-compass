"use client";

import { Building2, FileText, MapPin, Phone } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { AskCompass, useAsk } from "@/components/compass/AskCompass";
import { OfficeLookup } from "@/components/plan/OfficeLookup";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { googleEventUrl, toICS } from "@/domain/procedures/calendar";
import { daysBetween, jpDate } from "@/domain/procedures/dates";
import { DOCS } from "@/domain/procedures/documents";
import { OFFICE_LABEL, cityOf } from "@/domain/procedures/offices";
import type { Category, Task } from "@/domain/procedures/rules";
import { useOverall } from "@/lib/overall";
import { taskStatus } from "./Home";
import { DetailStatus, RowStatus } from "./StatusButtons";

const CATS: (Category | "すべて")[] = ["すべて", "届出", "葬儀・法要", "調べる・決める", "お金の受け取り", "税金", "名義変更・解約", "不動産"];
type StatusFilter = "open" | "done" | "all";

/** 窓口に電話するときの伝え方の文例 */
function script(t: Task, rel: string, name: string) {
  const who = rel && rel !== "その他" ? `${rel}${name ? `（${name}）` : ""}` : name ? `家族の${name}` : "家族";
  return `${who}が亡くなりました。「${t.title}」の手続きをしたいのですが、必要な書類と受付時間、予約が必要かどうかを教えていただけますか？`;
}

function downloadOne(t: Task) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const ics = toICS([t], { name: t.title, stamp, appUrl: `${window.location.origin}/my/tasks?id=${t.id}` });
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${t.id}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TasksPage() {
  const o = useOverall();
  const params = useSearchParams();
  const router = useRouter();
  const [cat, setCat] = useState<(typeof CATS)[number]>("すべて");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [optional, setOptional] = useState(false);
  const [copied, setCopied] = useState(false);

  const { closed } = o;
  const list = useMemo(
    () =>
      o.tasks.filter(
        (t) =>
          (optional || !t.optional) &&
          (cat === "すべて" || t.category === cat) &&
          (status === "all" || (status === "done" ? closed(t.id) : !closed(t.id))),
      ),
    [o.tasks, closed, cat, status, optional],
  );
  const selId = params.get("id") ?? list.find((t) => !o.closed(t.id))?.id ?? list[0]?.id;
  const t = o.tasks.find((x) => x.id === selId) ?? null;

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

  if (!o.loaded) return <AppShell>{null}</AppShell>;
  if (!o.heard || !o.valid) {
    router.replace("/my");
    return <AppShell>{null}</AppShell>;
  }
  const select = (id: string) => router.replace(`/my/tasks?id=${id}`, { scroll: false });
  const left = t ? daysBetween(o.now, t.date) : 0;
  const st = t ? o.statusOf(t.id) : "open";
  const isDone = st !== "open";
  const nextStep = o.steps.find((s) => !s.done);
  const { pref, city } = cityOf(o.iv.address);

  return (
    <AppShell wide>
      <PageHead title="やることリスト" say="期限の近いものから順に並べています。手続きを選ぶと、提出先や必要な書類が見られます。" />
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <ul className="space-y-2 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto lg:pr-1">
          {list.length === 0 && <li className="rounded-xl bg-white p-6 text-center text-sm text-stone-500">該当する手続きはありません。</li>}
          {list.map((x) => {
            const xs = o.statusOf(x.id);
            const d = xs !== "open";
            const badge = taskStatus(x, xs, o.now);
            return (
              <li key={x.id} className={`flex items-center gap-3 rounded-xl border bg-white p-3 ${x.id === selId ? "border-sky-500 ring-2 ring-sky-100" : "border-stone-200"}`}>
                <RowStatus status={xs} onChange={(v) => o.setStatus(x.id, v)} label={x.title} />
                <button type="button" onClick={() => select(x.id)} className="min-w-0 flex-1 text-left">
                  <p className={`truncate font-semibold ${d ? "text-stone-400 line-through" : "text-stone-900"}`}>{x.title}</p>
                  <p className="text-xs text-stone-500">
                    {x.category}・{x.hard ? "期限" : "目安"} {jpDate(x.date)}
                  </p>
                </button>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${badge.cls}`}>{badge.label}</span>
              </li>
            );
          })}
        </ul>

        {t && (
          <article className="space-y-4 rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs text-stone-500">{t.category}</p>
                <h2 className="text-xl font-bold text-sky-950">{t.title}</h2>
              </div>
              <DetailStatus status={st} onChange={(v) => o.setStatus(t.id, v)} />
            </div>

            <div className={`rounded-xl px-4 py-3 ${isDone ? "bg-emerald-50" : t.hard ? "bg-orange-50" : "bg-sky-50"}`}>
              <p className="text-sm font-bold">
                {t.hard ? "期限" : "目安"}：{jpDate(t.date)}
                {!isDone && <span className={`ml-2 ${left < 0 ? "text-rose-700" : left <= 7 ? "text-orange-700" : "text-stone-600"}`}>{left < 0 ? `${-left}日過ぎています` : left === 0 ? "今日です" : `あと${left}日`}</span>}
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
              <h3 className="mb-2 flex items-center gap-1.5 font-bold text-stone-700"><Building2 className="h-4 w-4 text-sky-700" aria-hidden />提出先・連絡先</h3>
              {t.office ? (
                <div className="space-y-2">
                  <OfficeLookup kind={t.office} dept={t.dept} address={o.iv.address} />
                  <p className="text-xs text-stone-500">窓口の決まり：{t.where}</p>
                  {city && (
                    <a
                      href={`https://www.google.com/maps/search/${encodeURIComponent(`${pref}${city} ${OFFICE_LABEL[t.office]}`)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-block text-sm text-sky-800 underline"
                    >
                      <MapPin className="mr-1 inline h-4 w-4" aria-hidden />
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
                <h3 className="mb-2 flex items-center gap-1.5 font-bold text-stone-700"><FileText className="h-4 w-4 text-sky-700" aria-hidden />必要な書類</h3>
                <ul className="space-y-1.5">
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
                          <Link href={`/my/docs?id=${id}`} className="ml-auto shrink-0 text-xs text-sky-700 hover:underline">
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
                  <h3 className="flex items-center gap-1.5 font-bold text-stone-700"><Phone className="h-4 w-4 text-sky-700" aria-hidden />連絡するときの伝え方</h3>
                  <button
                    type="button"
                    className="text-xs text-sky-700 hover:underline"
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

            <div className="flex items-start gap-3 rounded-xl bg-amber-50 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/brand/compass-kun-main.png" alt="" className="h-12 w-auto" />
              <p className="text-sm text-amber-950">
                <span className="font-bold">ワンポイント：</span>
                {t.hard ? "期限がある手続きです。書類がそろわなくても、まず窓口に相談すると次にやることが分かります。" : "期限はありませんが、この時期に済ませておくと後の手続きがスムーズです。"}
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
                .ics で保存
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
    </AppShell>
  );
}
