"use client";

import { useState } from "react";
import { Note, YenInput, fmt } from "@/components/ui";
import { civilHeirIds } from "@/domain/heirs";
import type { Debt, Person } from "@/domain/types";
import { useCase } from "@/lib/store";

type BearMode = "one" | "many" | "undecided";

/** 負担額 amount を people で均等に分ける（1円未満の端数は最初の人に） */
export function evenBearers(amount: number, people: { id: string }[]): Debt["bearers"] {
  if (people.length === 0) return [];
  const each = Math.floor(amount / people.length);
  return people.map((p, i) => ({ personId: p.id, amount: i === 0 ? amount - each * (people.length - 1) : each }));
}

/** 全額を1人が負担しているなら、その人の id（同じ人が何行かに分かれて入っていても合わせて見る） */
export function soleBearer(d: Debt): string | null {
  const ids = new Set(d.bearers.map((b) => b.personId));
  if (ids.size !== 1) return null;
  return d.bearers.reduce((a, b) => a + b.amount, 0) === d.amount ? [...ids][0] : null;
}

/** 保存されている負担者から、いまの選び方（1人・複数人・未定）を読む */
export function bearMode(d: Debt): BearMode {
  if (d.bearers.length === 0) return "undecided";
  return soleBearer(d) != null ? "one" : "many";
}

/**
 * 債務・葬式費用ごとに、誰が負担するか（遺産分割協議で決めるので「遺産の分け方」で入れる）。
 * 財産の分け方と同じく「1人」「複数人」「未定」から選ぶ
 */
export function DebtBearers() {
  const { data } = useCase();
  if (data.debts.length === 0) return null;
  const people = data.persons.filter((p) => !p.predeceased);
  // 「均等に負担する」の対象は、相続放棄をしていない民法上の相続人だけ
  const evenPeople = (() => {
    try {
      const ids = civilHeirIds(data.persons);
      return people.filter((p) => ids.has(p.id));
    } catch {
      return [];
    }
  })();
  return (
    <section aria-labelledby="debt-bearers" className="space-y-3">
      <h2 id="debt-bearers" className="border-b border-stone-200 pb-1 text-base font-bold text-stone-800">
        債務・葬式費用を負担する人
      </h2>
      {data.undivided && <p className="text-xs text-stone-500">負担する人が決まっていない債務は「未定」にしてください（法定相続分で計算します）。</p>}
      <ol className="space-y-4">
        {data.debts.map((d) => (
          <DebtChoice key={d.id} d={d} people={people} evenPeople={evenPeople} />
        ))}
      </ol>
    </section>
  );
}

function DebtChoice({ d, people, evenPeople }: { d: Debt; people: Person[]; evenPeople: Person[] }) {
  const { data, update } = useCase();
  const derived = bearMode(d);
  const [picked, setPicked] = useState<BearMode | null>(null);
  // 選んだ選び方は、保存されている内容と食い違わないときだけ使う（「複数人」は1人分だけ入れた途中も含む）
  const mode = picked && (picked === "many" || d.bearers.length === 0 || picked === derived) ? picked : derived;
  const setBearers = (bearers: Debt["bearers"]) => update((c) => ({ ...c, debts: c.debts.map((x) => (x.id === d.id ? { ...x, bearers } : x)) }));
  const choose = (m: BearMode) => {
    setPicked(m);
    if (m === "undecided") setBearers([]);
    if (m === "one" && derived !== "one") setBearers([]);
  };
  // 以前の入力で同じ人が何行かに分かれていることがあるので、人ごとに合わせて見せる（直すと1行にまとまる）
  const amountOf = (id: string) => d.bearers.filter((b) => b.personId === id).reduce((a, b) => a + b.amount, 0);
  const setAmount = (id: string, v: number) => {
    const others = d.bearers.filter((b) => b.personId !== id);
    // 人の並びどおりに残す
    const next = v > 0 ? [...others, { personId: id, amount: v }] : others;
    setBearers(people.flatMap((p) => next.filter((b) => b.personId === p.id)));
  };
  const borne = d.bearers.reduce((a, b) => a + b.amount, 0);
  // 分け方が決まっていないときに負担額を入れなければ、法定相続分で負担したものとして計算する（合計が合わなくてもよい）
  const byLegalShare = !!data.undivided && borne === 0;
  // 消した人などが負担者に残っているとき
  const unknown = d.bearers.some((b) => !people.some((p) => p.id === b.personId));

  return (
    <li data-focus={`debt-${d.id}`} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-bold text-stone-900">
          <span className="mr-1.5 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-normal">{d.kind === "debt" ? "債務" : "葬式費用"}</span>
          {d.label || "（名称未入力）"}
        </p>
        <p className="tabular-nums text-stone-700">{fmt(d.amount)}円</p>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="負担する人">
        {(
          [
            ["one", "1人"],
            ["many", "複数人"],
            ["undecided", "未定"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" onClick={() => choose(k)} aria-pressed={mode === k} className={`rounded-lg border px-2 py-2 text-sm ${mode === k ? "border-brand bg-brand-soft font-bold text-stone-900" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"}`}>
            {l}
          </button>
        ))}
      </div>

      {mode === "one" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {people.map((h) => {
            const on = soleBearer(d) === h.id;
            return (
              <button key={h.id} type="button" onClick={() => setBearers([{ personId: h.id, amount: d.amount }])} className={`rounded-full border px-4 py-1.5 text-sm ${on ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 hover:border-teal-500"}`}>
                {h.name || "（名前未入力）"}
                <span className={`ml-1 text-xs ${on ? "text-white/80" : "text-stone-500"}`}>{h.relationLabel}</span>
              </button>
            );
          })}
        </div>
      )}

      {mode === "many" && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-stone-500">負担する額を入れます（合計が金額と同じになるように）。</p>
          <ul className="space-y-1.5">
            {people.map((h) => (
              <li key={h.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,11rem)] items-center gap-3">
                <span className="text-sm">
                  {h.name || "（名前未入力）"} <span className="text-xs text-stone-500">{h.relationLabel}</span>
                </span>
                <YenInput value={amountOf(h.id)} onChange={(v) => setAmount(h.id, v)} />
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2">
            <button type="button" onClick={() => setBearers(evenBearers(d.amount, evenPeople))} disabled={evenPeople.length === 0} className="py-2 text-sm text-sky-800 underline disabled:text-stone-400 disabled:no-underline">
              相続人全員で均等に負担する
            </button>
            {!byLegalShare && borne !== d.amount && <span className="text-xs text-red-700">負担額の合計（{fmt(borne)}円）が金額（{fmt(d.amount)}円）と一致していません。</span>}
          </div>
        </div>
      )}

      {mode === "undecided" &&
        (data.undivided ? (
          d.amount > 0 && <p className="mt-3 text-xs text-stone-500">（法定相続分で負担したものとして計算します）</p>
        ) : (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">負担する人を選んでください（選ぶまで税額を確定できません）。</p>
        ))}
      {mode !== "undecided" && byLegalShare && d.amount > 0 && <p className="mt-2 text-xs text-stone-500">（法定相続分で負担したものとして計算します）</p>}
      {unknown && (
        <div className="mt-2">
          <Note tone="warn">登録されていない人が負担する人になっています。選び直してください。</Note>
        </div>
      )}
    </li>
  );
}
