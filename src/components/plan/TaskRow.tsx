"use client";

import Link from "next/link";
import { useState } from "react";
import { daysBetween, jpDate } from "@/domain/procedures/dates";
import { googleEventUrl } from "@/domain/procedures/calendar";
import { DOCS } from "@/domain/procedures/documents";
import type { Task } from "@/domain/procedures/rules";
import { OfficeLookup } from "./OfficeLookup";

export interface StepState {
  slug: string;
  title: string;
  done: boolean;
}

export function TaskRow({
  t,
  done,
  onToggle,
  now,
  onAsk,
  address,
  steps,
  onShowDoc,
}: {
  t: Task;
  done: boolean;
  onToggle: () => void;
  now: string;
  onAsk: (q: string) => void;
  address: string;
  /** 相続税申告の行に表示する7ステップの進み具合 */
  steps?: StepState[];
  onShowDoc: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const left = daysBetween(now, t.date);
  const state = done ? "done" : left < 0 ? "over" : left <= 7 ? "soon" : "later";
  const nextStep = steps?.find((s) => !s.done);
  return (
    <li className={`rounded-xl border bg-white ${state === "over" && t.hard ? "border-rose-300" : t.important && !done ? "border-amber-300" : "border-stone-200"}`}>
      <div className="flex items-start gap-3 p-4">
        <input type="checkbox" checked={done} onChange={onToggle} className="mt-1 h-5 w-5 shrink-0 accent-sky-700" aria-label={`${t.title}を済みにする`} />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className={`rounded px-1.5 py-0.5 font-bold ${t.hard ? "bg-rose-100 text-rose-800" : "bg-stone-100 text-stone-600"}`}>{t.hard ? "期限" : "目安"}</span>
            <span className={`font-semibold tabular-nums ${state === "over" ? "text-rose-700" : state === "soon" ? "text-amber-700" : "text-stone-600"}`}>
              {jpDate(t.date)}
              {!done && (left < 0 ? `（${-left}日過ぎています）` : left === 0 ? "（今日）" : left <= 90 ? `（あと${left}日）` : "")}
            </span>
            <span className="text-stone-400">{t.category}</span>
            {t.important && !done && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800">重要</span>}
          </div>
          <p className={`mt-1 font-bold ${done ? "text-stone-400 line-through" : "text-stone-900"}`}>{t.title}</p>
          {steps && (
            <div className="mt-2">
              <ol className="flex items-center gap-1" aria-label="相続税申告の進み具合">
                {steps.map((s, i) => (
                  <li key={s.slug} className="flex items-center gap-1">
                    <span
                      title={s.title}
                      className={`grid h-6 w-6 place-items-center rounded-full text-[11px] font-bold ${s.done ? "bg-emerald-500 text-white" : s === nextStep ? "bg-sky-700 text-white" : "bg-stone-200 text-stone-500"}`}
                    >
                      {s.done ? "✓" : i + 1}
                    </span>
                    {i < steps.length - 1 && <span className={`h-0.5 w-3 sm:w-5 ${s.done ? "bg-emerald-400" : "bg-stone-200"}`} />}
                  </li>
                ))}
              </ol>
              <p className="mt-1 text-xs text-stone-500">
                申告書づくり {steps.filter((s) => s.done).length}/{steps.length} ステップ完了{nextStep ? `・次は「${nextStep.title}」` : ""}
              </p>
            </div>
          )}
        </button>
        <span className="mt-1 text-stone-400" aria-hidden>
          {open ? "▲" : "▼"}
        </span>
      </div>
      {steps && nextStep && t.link && (
        <div className="-mt-2 px-4 pb-3 pl-12">
          <Link href={`/case/${nextStep.slug}`} className="inline-block rounded-lg bg-sky-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-800">
            「{nextStep.title}」から続ける →
          </Link>
        </div>
      )}
      {open && (
        <div className="space-y-3 border-t border-stone-100 px-4 py-4 pl-12 text-sm leading-relaxed text-stone-700">
          <p>{t.what}</p>
          {t.limit && <p className="text-rose-800">⚠ {t.limit.text}（{jpDate(t.limit.date)}まで）</p>}
          {t.office ? (
            <OfficeLookup kind={t.office} dept={t.dept} address={address} />
          ) : (
            <p>
              <span className="font-semibold text-stone-500">どこで：</span>
              {t.where}
            </p>
          )}
          {t.office && <p className="text-xs text-stone-500">窓口の決まり：{t.where}</p>}
          {t.docs.length > 0 && (
            <div>
              <p className="font-semibold text-stone-500">集める書類</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {t.docs.map((id) => (
                  <li key={id}>
                    <button type="button" onClick={() => onShowDoc(id)} className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs text-sky-900 hover:bg-sky-100">
                      📄 {DOCS[id]?.name ?? id}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[6rem_1fr]">
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
                    <a href={t.source.url} target="_blank" rel="noreferrer" className="text-sky-800 underline">
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
            {t.link && !steps && (
              <Link href={t.link.href} className="rounded-lg bg-sky-700 px-3 py-1.5 font-semibold text-white hover:bg-sky-800">
                {t.link.label} →
              </Link>
            )}
            <a href={googleEventUrl(t)} target="_blank" rel="noreferrer" className="rounded-lg border border-stone-300 px-3 py-1.5 hover:bg-stone-50">
              この予定だけGoogleカレンダーに追加
            </a>
            <button type="button" onClick={() => onAsk(`「${t.title}」について、具体的に何をすればいいか教えてください。`)} className="rounded-lg border border-sky-300 px-3 py-1.5 text-sky-800 hover:bg-sky-50">
              コンパスくんに聞く
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
