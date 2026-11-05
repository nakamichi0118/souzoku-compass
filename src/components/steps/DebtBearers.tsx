"use client";

import { Button, Note, Select, YenInput, fmt } from "@/components/ui";
import type { Debt } from "@/domain/types";
import { useCase } from "@/lib/store";

/** 債務・葬式費用ごとに、誰がいくら負担するか（遺産分割協議で決めるので「遺産の分け方」で入れる） */
export function DebtBearers() {
  const { data, update } = useCase();
  if (data.debts.length === 0) return null;
  const living = data.persons.filter((p) => !p.predeceased);
  const isLiving = (id: string) => living.some((p) => p.id === id);
  const patch = (id: string, p: Partial<Debt>) => update((c) => ({ ...c, debts: c.debts.map((d) => (d.id === id ? { ...d, ...p } : d)) }));
  return (
    <section aria-labelledby="debt-bearers" className="space-y-3">
      <h2 id="debt-bearers" className="border-b border-stone-200 pb-1 text-base font-bold text-stone-800">
        債務・葬式費用を負担する人
      </h2>
      {data.undivided && <p className="text-xs text-stone-500">負担する人が決まっていなければ、×で外して空欄にしてください（法定相続分で計算します）。</p>}
      <ol className="space-y-3">
        {data.debts.map((d) => {
          const borne = d.bearers.reduce((a, b) => a + b.amount, 0);
          // 分け方が決まっていないときに負担額を入れなければ、法定相続分で負担したものとして計算する（合計が合わなくてもよい）
          const byLegalShare = !!data.undivided && borne === 0;
          return (
            <li key={d.id} data-focus={`debt-${d.id}`} className="rounded-xl border border-stone-200 bg-white p-3">
              <p className="mb-2 flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="font-bold text-stone-800">
                  <span className="mr-1.5 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-600">{d.kind === "debt" ? "債務" : "葬式費用"}</span>
                  {d.label || "（名称未入力）"}
                </span>
                <span className="tabular-nums text-stone-700">{fmt(d.amount)}円</span>
              </p>
              <div className="space-y-2">
                {d.bearers.map((b, i) => (
                  <div key={i}>
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
                      <Select
                        value={isLiving(b.personId) ? b.personId : ""}
                        onChange={(v) => patch(d.id, { bearers: d.bearers.map((x, j) => (j === i ? { ...x, personId: v } : x)) })}
                        options={[{ value: "", label: "選んでください" }, ...living.map((p) => ({ value: p.id, label: p.name || "（未入力）" }))]}
                      />
                      <YenInput value={b.amount} onChange={(v) => patch(d.id, { bearers: d.bearers.map((x, j) => (j === i ? { ...x, amount: v } : x)) })} />
                      <Button variant="danger" onClick={() => patch(d.id, { bearers: d.bearers.filter((_, j) => j !== i) })}>
                        ×
                      </Button>
                    </div>
                    {!isLiving(b.personId) && <p className="mt-1 text-xs font-medium text-amber-800">負担する人を選んでください（選ぶまで税額を確定できません）。</p>}
                  </div>
                ))}
                {byLegalShare && d.amount > 0 && <p className="text-xs text-stone-500">（法定相続分で負担したものとして計算します）</p>}
                <Button
                  variant="ghost"
                  onClick={() => patch(d.id, { bearers: [...d.bearers, { personId: living[0]?.id ?? "", amount: d.bearers.length === 0 ? d.amount : 0 }] })}
                >
                  ＋ 負担する人を追加
                </Button>
              </div>
              {borne !== d.amount && !byLegalShare && (
                <div className="mt-2">
                  <Note tone="warn">
                    負担額の合計（{fmt(borne)}円）が金額（{fmt(d.amount)}円）と一致していません。
                  </Note>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
