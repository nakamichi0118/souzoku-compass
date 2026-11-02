"use client";

import { useState } from "react";
import { Button, Card, Note, fmt } from "@/components/ui";
import { toString as fracText } from "@/domain/fraction";
import { RATE_TABLE, rateFor } from "@/domain/tax/engine";
import { useCase } from "@/lib/store";
import { summarizeForAssistant } from "@/lib/summary";

function Row({ label, value, sub, strong }: { label: React.ReactNode; value: number | string; sub?: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-stone-100 py-2">
      <div>
        <p className={strong ? "font-bold" : ""}>{label}</p>
        {sub && <p className="text-xs text-stone-500">{sub}</p>}
      </div>
      <p className={`shrink-0 tabular-nums ${strong ? "text-lg font-bold text-teal-800" : ""}`}>{typeof value === "number" ? `${fmt(value)}円` : value}</p>
    </div>
  );
}

export function TaxStep() {
  const { data, result, error } = useCase();
  const [explain, setExplain] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) return <Note tone="stop">計算できませんでした：{error}</Note>;
  if (!result) return <Note tone="info">亡くなった日を入力すると計算できます。</Note>;
  const r = result;

  async function askExplain() {
    setBusy(true);
    try {
      const res = await fetch("/api/assist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          step: "tax",
          question: "この計算結果を、相続税に詳しくない家族にも分かるように説明してください。なぜこの税額になるのか、配偶者の税額軽減などの効果も含めて。",
          context: summarizeForAssistant(data, result),
        }),
      });
      const j = await res.json();
      setExplain(j.answer ?? j.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      {r.blockers.map((b) => (
        <Note key={b} tone="stop">
          {b}
        </Note>
      ))}
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-sm text-stone-600">課税価格の合計額</p>
            <p className="text-2xl font-bold tabular-nums">{fmt(r.totalTaxable)}円</p>
          </div>
          <div>
            <p className="text-sm text-stone-600">相続税の総額</p>
            <p className="text-2xl font-bold tabular-nums">{fmt(r.totalTax)}円</p>
          </div>
          <div>
            <p className="text-sm text-stone-600">納める相続税の合計</p>
            <p className="text-3xl font-bold tabular-nums text-teal-800">{fmt(r.totalPayable)}円</p>
          </div>
        </div>
        <div className="mt-4">
          {r.needsFiling ? <Note tone="warn">相続税の申告が必要です。</Note> : <Note tone="ok">相続税の申告は原則不要です。</Note>}
        </div>
      </Card>

      <Card title="① 相続税の総額（第2表）">
        <Row label="課税価格の合計額" value={r.totalTaxable} sub="各人の課税価格（1,000円未満切捨て）の合計" />
        <Row label={`遺産に係る基礎控除額（法定相続人 ${r.legalHeirCount}人）`} value={-r.basicDeduction} sub="3,000万円＋600万円×法定相続人の数（相続税法15条）" />
        <Row label="課税遺産総額" value={r.taxableEstate} strong />
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-stone-600">
                <th className="py-2">法定相続人</th>
                <th className="py-2 text-center">法定相続分</th>
                <th className="py-2 text-right">取得金額（1,000円未満切捨て）</th>
                <th className="py-2 text-right">税率・控除額</th>
                <th className="py-2 text-right">税額</th>
              </tr>
            </thead>
            <tbody>
              {r.slots.map((s, i) => {
                const rate = rateFor(s.amount);
                return (
                  <tr key={i} className="border-b border-stone-100">
                    <td className="py-2">{s.label}</td>
                    <td className="py-2 text-center tabular-nums">{fracText(s.share)}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(s.amount)}円</td>
                    <td className="py-2 text-right text-stone-600">{s.amount > 0 ? `${rate.rate}% − ${fmt(rate.deduction)}円` : "—"}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(s.tax)}円</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Row label="相続税の総額（100円未満切捨て）" value={r.totalTax} strong />
        <details className="mt-2 text-xs text-stone-600">
          <summary className="cursor-pointer text-teal-800">速算表（相続税法16条）</summary>
          <ul className="mt-2 grid grid-cols-2 gap-1 sm:grid-cols-4">
            {RATE_TABLE.map((t) => (
              <li key={t.rate}>
                {t.upTo === Infinity ? "6億円超" : `${fmt(t.upTo / 10000)}万円以下`}：{t.rate}%・控除{fmt(t.deduction / 10000)}万円
              </li>
            ))}
          </ul>
        </details>
      </Card>

      <Card title="② 各人の納付税額（第1表）">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-right text-stone-600">
                <th className="py-2 text-left">項目</th>
                {r.persons.map((p) => (
                  <th key={p.person.id} className="py-2">
                    {p.person.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {(
                [
                  ["取得財産の価額", (p) => p.acquired],
                  ["債務及び葬式費用", (p) => p.debts],
                  ["暦年課税分の贈与財産価額（3年以内）", (p) => p.gifts],
                  ["課税価格", (p) => p.taxable],
                  ["按分割合", (p) => p.ratioText],
                  ["算出税額", (p) => p.computed],
                  ["2割加算", (p) => p.surcharge],
                  ["暦年課税分の贈与税額控除", (p) => -p.giftTaxCredit],
                  ["配偶者の税額軽減", (p) => -p.spouseCredit],
                  ["未成年者控除", (p) => -p.minorCredit],
                  ["障害者控除", (p) => -p.disabilityCredit],
                  ["納付すべき税額（100円未満切捨て）", (p) => p.payable],
                ] as [string, (p: (typeof r.persons)[number]) => number | string][]
              ).map(([label, f]) => (
                <tr key={label} className={`border-b border-stone-100 ${label.startsWith("納付") ? "font-bold text-teal-800" : ""}`}>
                  <td className="py-2 text-left">{label}</td>
                  {r.persons.map((p) => {
                    const v = f(p);
                    return (
                      <td key={p.person.id} className="py-2 text-right">
                        {typeof v === "number" ? (v === 0 ? "—" : `${fmt(v)}円`) : v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {r.spouse && (
        <Card title="③ 配偶者の税額軽減（第5表）">
          <Row label="課税価格の合計額" value={r.spouse.totalTaxable} />
          <Row label="配偶者の法定相続分相当額" value={r.spouse.legalShareAmount} sub="1億6千万円に満たない場合は1億6千万円" />
          <Row label="配偶者の課税価格" value={r.spouse.spouseTaxable} />
          <Row label="軽減の基となる金額" value={r.spouse.creditBase} sub="相続税の総額 × 上の2つのいずれか少ない方 ÷ 課税価格の合計額" />
          <Row label="配偶者の税額軽減額" value={r.spouse.credit} strong />
        </Card>
      )}

      <Card title="コンパスくんの説明" actions={<Button onClick={askExplain} disabled={busy}>{busy ? "作成中…" : "この結果を説明してもらう"}</Button>}>
        {explain ? <p className="whitespace-pre-wrap text-sm leading-relaxed">{explain}</p> : <p className="text-sm text-stone-500">「この結果を説明してもらう」を押すと、コンパスくんが計算結果をやさしく説明します。</p>}
      </Card>

      {r.warnings.map((w) => (
        <Note key={w} tone="warn">
          {w}
        </Note>
      ))}
    </div>
  );
}
