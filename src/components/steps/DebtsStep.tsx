"use client";

import { Button, Card, Check, Field, Note, Select, TextInput, YenInput, fmt } from "@/components/ui";
import type { Case, Debt } from "@/domain/types";
import { newId, useCase } from "@/lib/store";

/** 申告書（第13表）の「種類」。値は申告書の表記、表示は分かりやすい説明つき */
const DEBT_TYPES: { value: NonNullable<Debt["debtType"]>; label: string }[] = [
  { value: "公租公課", label: "公租公課（まだ納めていない税金・保険料）" },
  { value: "銀行借入金", label: "銀行借入金（銀行などからの借入れ）" },
  { value: "未払金", label: "未払金（医療費・公共料金などの支払い残り）" },
  { value: "その他", label: "その他" },
];

/**
 * 新しい債務・葬式費用。ふだんは最初の人を負担する人にしておく。
 * 「分け方がまだ決まっていない」ときは負担する人を空けておく（空けたままなら法定相続分で負担したものとして計算する）
 */
export function newDebt(c: Case, kind: Debt["kind"], id: string): Debt {
  const first = c.persons.find((p) => !p.predeceased);
  return { id, kind, label: "", amount: 0, bearers: !c.undivided && first ? [{ personId: first.id, amount: 0 }] : [] };
}

/** 金額を変える。負担する人が1人だけなら、その人の負担額も合わせる（「分け方がまだ決まっていない」ときは合わせない） */
export function withDebtAmount(d: Debt, amount: number, undivided: boolean | undefined): Pick<Debt, "amount" | "bearers"> {
  return { amount, bearers: !undivided && d.bearers.length === 1 ? [{ ...d.bearers[0], amount }] : d.bearers };
}

export function DebtsStep() {
  const { data, update, result } = useCase();
  const living = data.persons.filter((p) => !p.predeceased);
  const isLiving = (id: string) => living.some((p) => p.id === id);
  const add = (kind: Debt["kind"]) => update((c) => ({ ...c, debts: [...c.debts, newDebt(c, kind, newId())] }));
  const patch = (id: string, p: Partial<Debt>) => update((c) => ({ ...c, debts: c.debts.map((d) => (d.id === id ? { ...d, ...p } : d)) }));
  // 相続時精算課税を選んだ贈与があるときだけ、贈与ごとの「相続時精算課税」の印を出す（印を付けた贈与があるときも出したままにする）
  const settlement = !!data.decedent.settlementGift || data.priorGifts.some((g) => g.settlement);

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
        // 分け方が決まっていないときに負担額を入れなければ、法定相続分で負担したものとして計算する（合計が合わなくてもよい）
        const byLegalShare = !!data.undivided && borne === 0;
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
                <YenInput value={d.amount} onChange={(v) => patch(d.id, withDebtAmount(d, v, data.undivided))} />
              </Field>
              {d.kind === "debt" && (
                <Field label="種類" hint="申告書（第13表）に記載します">
                  <Select
                    value={d.debtType ?? ""}
                    onChange={(v) => patch(d.id, { debtType: (v || undefined) as Debt["debtType"] })}
                    options={[{ value: "", label: "選んでください" }, ...DEBT_TYPES]}
                  />
                </Field>
              )}
            </div>
            <h3 className="mb-2 mt-4 text-sm font-bold text-stone-700">誰が負担しますか</h3>
            {data.undivided && <p className="mb-2 text-xs text-stone-500">負担する人が決まっていなければ、空欄のままにしてください（法定相続分で負担したものとして計算します）。</p>}
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
                  {!isLiving(b.personId) && <p className="mt-1 text-xs font-medium text-amber-800">負担する人を選んでください。選ぶまで相続税の計算を確定できません。</p>}
                </div>
              ))}
              <Button variant="ghost" onClick={() => patch(d.id, { bearers: [...d.bearers, { personId: living[0]?.id ?? "", amount: 0 }] })}>
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
          </Card>
        );
      })}
      {result && result.totalDebts > 0 && <Note tone="ok">差し引く債務・葬式費用の合計：{fmt(result.totalDebts)}円</Note>}

      <Card title={settlement ? "亡くなる前3年以内の贈与・相続時精算課税の贈与" : "亡くなる前3年以内に贈与した財産"}>
        <p className="mb-3 text-sm text-stone-600">
          亡くなる前3年以内に、相続や遺贈で財産を受け取る人へ贈与したお金や物は、相続財産に足して計算します（納めた贈与税は差し引けます）。
          {settlement && <span className="mt-1 block">相続時精算課税を選んだ後の贈与は、3年より前のものも含めて全部入れ、「相続時精算課税」に印を付けてください。</span>}
        </p>
        <details className="mb-3 text-xs text-stone-600">
          <summary className="cursor-pointer font-medium text-teal-800">Tips：入れない贈与</summary>
          <p className="mt-2 leading-relaxed">
            贈与税の配偶者控除（2,000万円まで）を受けた分と、住宅取得等資金の非課税を受けた分は、相続財産に足さないので入れません。配偶者控除を受けた贈与は、控除を受けた額を引いた残りだけを入れてください。
          </p>
        </details>
        <div className="space-y-2">
          {data.priorGifts.map((g, i) => {
            const set = (p: Partial<typeof g>) => update((c) => ({ ...c, priorGifts: c.priorGifts.map((x, j) => (j === i ? { ...x, ...p } : x)) }));
            return (
              <div key={i} className="grid items-end gap-2 rounded-lg border border-stone-200 p-2 sm:grid-cols-[1fr_10rem_1fr_1fr_auto]">
                <Field label="受け取った人" hint={g.personId && !isLiving(g.personId) ? "選ばれていた人は一覧にいないか、先に亡くなっています。選び直してください" : undefined}>
                  <Select value={isLiving(g.personId) ? g.personId : ""} onChange={(v) => set({ personId: v })} options={[{ value: "", label: "選んでください" }, ...living.map((p) => ({ value: p.id, label: p.name || "（未入力）" }))]} />
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
                {settlement && (
                  <div className="sm:col-span-5">
                    <Check checked={!!g.settlement} onChange={(v) => set({ settlement: v || undefined })} label="相続時精算課税" />
                  </div>
                )}
              </div>
            );
          })}
          <Button variant="secondary" onClick={() => update((c) => ({ ...c, priorGifts: [...c.priorGifts, { personId: living[0]?.id ?? "", date: "", amount: 0, giftTaxPaid: 0 }] }))}>
            ＋ 贈与を追加
          </Button>
          {data.priorGifts.some((g) => !isLiving(g.personId) || !g.date) && (
            <Note tone="warn">受け取った人と贈与の日を入れてください。入れるまで相続税の計算を確定できず、申告書も作れません。</Note>
          )}
        </div>
      </Card>
    </div>
  );
}
