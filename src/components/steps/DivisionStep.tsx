"use client";

import { useState } from "react";
import { Button, Card, Note, fmt } from "@/components/ui";
import { determineHeirs } from "@/domain/heirs";
import type { Allocation } from "@/domain/types";
import { useCase } from "@/lib/store";
import { kindLabel } from "./AssetsStep";

function parseShare(s: string): { n: number; d: number } | null {
  const t = s.trim().replace(/[／]/g, "/");
  if (!t) return null;
  const m = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m && Number(m[2]) > 0) return { n: Number(m[1]), d: Number(m[2]) };
  if (/^\d+$/.test(t)) return { n: Number(t), d: 1 };
  return null;
}
const shareText = (s?: { numerator: number; denominator: number }) => (!s ? "" : s.denominator === 1 ? `${s.numerator}` : `${s.numerator}/${s.denominator}`);

function ShareCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [t, setT] = useState(value);
  const bad = t.trim() !== "" && !parseShare(t);
  return (
    <input
      value={t}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => onCommit(t)}
      placeholder="—"
      className={`w-20 rounded border px-2 py-1 text-center tabular-nums ${bad ? "border-red-400 bg-red-50" : "border-stone-300"}`}
    />
  );
}

export function DivisionStep() {
  const { data, update, result } = useCase();
  const heirs = data.persons.filter((p) => !p.predeceased);
  const divisible = data.assets.filter((a) => a.kind !== "insurance" && a.kind !== "retirement");

  const setAlloc = (assetId: string, shares: Allocation["shares"]) =>
    update((c) => ({ ...c, allocations: [...c.allocations.filter((a) => a.assetId !== assetId), { assetId, shares }] }));

  const setCell = (assetId: string, personId: string, text: string) => {
    const cur = data.allocations.find((a) => a.assetId === assetId)?.shares ?? [];
    const p = parseShare(text);
    const others = cur.filter((s) => s.personId !== personId);
    setAlloc(assetId, p && p.n > 0 ? [...others, { personId, numerator: p.n, denominator: p.d }] : others);
  };

  const byLegalShare = () => {
    const civil = determineHeirs(data.persons, "civil");
    const shares = [...civil.byPerson].map(([personId, f]) => ({ personId, numerator: Number(f.n), denominator: Number(f.d) }));
    update((c) => ({ ...c, allocations: divisible.map((a) => ({ assetId: a.id, shares })) }));
  };

  return (
    <div className="space-y-5">
      <Card
        title="財産ごとの取得割合"
        actions={
          <Button variant="secondary" onClick={byLegalShare}>
            すべて法定相続分どおりにする
          </Button>
        }
      >
        <p className="mb-3 text-sm text-stone-600">各財産を誰がどれだけ受け継ぐかを、「1」（全部）や「1/2」のような割合で入力してください。</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-stone-600">
                <th className="py-2 pr-3">財産</th>
                <th className="py-2 pr-3 text-right">評価額</th>
                {heirs.map((h) => (
                  <th key={h.id} className="px-1 py-2 text-center">
                    {h.name || "（未入力）"}
                    <div className="text-xs font-normal">{h.relationLabel}</div>
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {divisible.map((a) => {
                const alloc = data.allocations.find((x) => x.assetId === a.id);
                const total = (alloc?.shares ?? []).reduce((s, x) => s + x.numerator / x.denominator, 0);
                const line = result?.assets.find((l) => l.asset.id === a.id);
                return (
                  <tr key={a.id} className="border-b border-stone-100">
                    <td className="py-2 pr-3">
                      <span className="mr-1 rounded bg-stone-100 px-1.5 py-0.5 text-xs">{kindLabel(a.kind)}</span>
                      {a.label}
                      {Math.abs(total - 1) > 1e-9 && <div className="text-xs text-red-700">{total === 0 ? "未分割" : `合計が1になっていません（${total.toFixed(3)}）`}</div>}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{line ? fmt(line.valuation.value) : ""}</td>
                    {heirs.map((h) => (
                      <td key={h.id} className="px-1 py-2 text-center">
                        <ShareCell
                          key={`${a.id}:${h.id}:${shareText(alloc?.shares.find((s) => s.personId === h.id))}`}
                          value={shareText(alloc?.shares.find((s) => s.personId === h.id))}
                          onCommit={(v) => setCell(a.id, h.id, v)}
                        />
                      </td>
                    ))}
                    <td className="py-2">
                      <select
                        className="rounded border border-stone-300 px-1 py-1 text-xs"
                        value=""
                        onChange={(e) => e.target.value && setAlloc(a.id, [{ personId: e.target.value, numerator: 1, denominator: 1 }])}
                      >
                        <option value="">全部を…</option>
                        {heirs.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {result && (
        <Card title="この分け方での各人の取得額と相続税">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-stone-200 text-left text-stone-600">
                  <th className="py-2">氏名</th>
                  <th className="py-2 text-right">取得財産</th>
                  <th className="py-2 text-right">課税価格</th>
                  <th className="py-2 text-right">納付税額</th>
                </tr>
              </thead>
              <tbody>
                {result.persons.map((p) => (
                  <tr key={p.person.id} className="border-b border-stone-100">
                    <td className="py-2">
                      {p.person.name} <span className="text-xs text-stone-500">{p.person.relationLabel}</span>
                    </td>
                    <td className="py-2 text-right tabular-nums">{fmt(p.acquired)}円</td>
                    <td className="py-2 text-right tabular-nums">{fmt(p.taxable)}円</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{fmt(p.payable)}円</td>
                  </tr>
                ))}
                <tr>
                  <td className="py-2 font-bold">合計</td>
                  <td />
                  <td className="py-2 text-right tabular-nums">{fmt(result.totalTaxable)}円</td>
                  <td className="py-2 text-right text-lg font-bold tabular-nums text-teal-800">{fmt(result.totalPayable)}円</td>
                </tr>
              </tbody>
            </table>
          </div>
          {data.assets.some((a) => a.kind === "insurance" || a.kind === "retirement") && (
            <p className="mt-2 text-xs text-stone-500">生命保険金・死亡退職金は受取人が取得し、非課税枠を差し引いて取得財産に含めています。</p>
          )}
        </Card>
      )}
      {result?.warnings.map((w) => (
        <Note key={w} tone="warn">
          {w}
        </Note>
      ))}
    </div>
  );
}
