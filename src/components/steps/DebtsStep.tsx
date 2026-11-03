"use client";

import { Button, Card, Field, Note, Select, TextInput, YenInput, fmt } from "@/components/ui";
import type { Debt } from "@/domain/types";
import { newId, useCase } from "@/lib/store";

export function DebtsStep() {
  const { data, update, result } = useCase();
  const living = data.persons.filter((p) => !p.predeceased);
  const add = (kind: Debt["kind"]) =>
    update((c) => ({ ...c, debts: [...c.debts, { id: newId(), kind, label: "", amount: 0, bearers: living[0] ? [{ personId: living[0].id, amount: 0 }] : [] }] }));
  const patch = (id: string, p: Partial<Debt>) => update((c) => ({ ...c, debts: c.debts.map((d) => (d.id === id ? { ...d, ...p } : d)) }));

  return (
    <div className="space-y-5">
      <Card title="追加する">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => add("debt")}>
            ＋ 債務（借入金・未払金・未納の税金）
          </Button>
          <Button variant="secondary" onClick={() => add("funeral")}>
            ＋ 葬式費用
          </Button>
        </div>
      </Card>
      {data.debts.map((d) => {
        const borne = d.bearers.reduce((a, b) => a + b.amount, 0);
        return (
          <Card
            key={d.id}
            title={`${d.kind === "debt" ? "債務" : "葬式費用"}：${d.label || "（未入力）"}`}
            actions={
              <Button variant="danger" onClick={() => update((c) => ({ ...c, debts: c.debts.filter((x) => x.id !== d.id) }))}>
                削除
              </Button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="内容">
                <TextInput value={d.label} onChange={(e) => patch(d.id, { label: e.target.value })} />
              </Field>
              <Field label={d.kind === "debt" ? "債権者（支払先）" : "支払先"} hint="申告書（第13表）に記載します">
                <TextInput value={d.creditor ?? ""} onChange={(e) => patch(d.id, { creditor: e.target.value })} placeholder={d.kind === "debt" ? "〇〇銀行、〇〇市役所など" : "〇〇斎場など"} />
              </Field>
              <Field label="債権者・支払先の住所">
                <TextInput value={d.creditorAddress ?? ""} onChange={(e) => patch(d.id, { creditorAddress: e.target.value })} />
              </Field>
              <Field label="金額">
                <YenInput value={d.amount} onChange={(v) => patch(d.id, { amount: v, bearers: d.bearers.length === 1 ? [{ ...d.bearers[0], amount: v }] : d.bearers })} />
              </Field>
            </div>
            <h3 className="mb-2 mt-4 text-sm font-bold text-stone-700">誰が負担しますか</h3>
            <div className="space-y-2">
              {d.bearers.map((b, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                  <Select
                    value={b.personId}
                    onChange={(v) => patch(d.id, { bearers: d.bearers.map((x, j) => (j === i ? { ...x, personId: v } : x)) })}
                    options={living.map((p) => ({ value: p.id, label: p.name || "（未入力）" }))}
                  />
                  <YenInput value={b.amount} onChange={(v) => patch(d.id, { bearers: d.bearers.map((x, j) => (j === i ? { ...x, amount: v } : x)) })} />
                  <Button variant="danger" onClick={() => patch(d.id, { bearers: d.bearers.filter((_, j) => j !== i) })}>
                    ×
                  </Button>
                </div>
              ))}
              <Button variant="ghost" onClick={() => patch(d.id, { bearers: [...d.bearers, { personId: living[0]?.id ?? "", amount: 0 }] })}>
                ＋ 負担する人を追加
              </Button>
            </div>
            {borne !== d.amount && (
              <div className="mt-2">
                <Note tone="warn">
                  負担額の合計（{fmt(borne)}円）が金額（{fmt(d.amount)}円）と一致していません。
                </Note>
              </div>
            )}
          </Card>
        );
      })}
      {result && result.totalDebts > 0 && <Note tone="ok">差し引く債務・葬式費用の合計：{fmt(result.totalDebts)}円</Note>}

      <Card title="亡くなる前3年以内に贈与した財産">
        <p className="mb-3 text-sm text-stone-600">
          亡くなる前3年以内に、相続や遺贈で財産を受け取る人へ贈与したお金や物は、相続財産に足して計算します（納めた贈与税は差し引けます）。
        </p>
        <div className="space-y-2">
          {data.priorGifts.map((g, i) => {
            const set = (p: Partial<typeof g>) => update((c) => ({ ...c, priorGifts: c.priorGifts.map((x, j) => (j === i ? { ...x, ...p } : x)) }));
            return (
              <div key={i} className="grid items-end gap-2 rounded-lg border border-stone-200 p-2 sm:grid-cols-[1fr_10rem_1fr_1fr_auto]">
                <Field label="受け取った人">
                  <Select value={g.personId} onChange={(v) => set({ personId: v })} options={[{ value: "", label: "選んでください" }, ...living.map((p) => ({ value: p.id, label: p.name || "（未入力）" }))]} />
                </Field>
                <Field label="贈与の日">
                  <TextInput type="date" value={g.date} onChange={(e) => set({ date: e.target.value })} />
                </Field>
                <Field label="贈与した額">
                  <YenInput value={g.amount} onChange={(v) => set({ amount: v })} />
                </Field>
                <Field label="納めた贈与税">
                  <YenInput value={g.giftTaxPaid} onChange={(v) => set({ giftTaxPaid: v })} />
                </Field>
                <Button variant="danger" onClick={() => update((c) => ({ ...c, priorGifts: c.priorGifts.filter((_, j) => j !== i) }))}>
                  削除
                </Button>
              </div>
            );
          })}
          <Button variant="secondary" onClick={() => update((c) => ({ ...c, priorGifts: [...c.priorGifts, { personId: living[0]?.id ?? "", date: "", amount: 0, giftTaxPaid: 0 }] }))}>
            ＋ 贈与を追加
          </Button>
          {data.priorGifts.some((g) => !g.personId || !g.date) && <Note tone="warn">受け取った人と贈与の日を入れてください。入れるまで計算に入りません。</Note>}
        </div>
      </Card>
    </div>
  );
}
