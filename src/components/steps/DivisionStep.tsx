"use client";

import { useState } from "react";
import { Button, Card, Note, fmt } from "@/components/ui";
import { determineHeirs } from "@/domain/heirs";
import type { Allocation, Person } from "@/domain/types";
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

  const byLegalShare = () => {
    const civil = determineHeirs(data.persons, "civil");
    const shares = [...civil.byPerson].map(([personId, f]) => ({ personId, numerator: Number(f.n), denominator: Number(f.d) }));
    update((c) => ({ ...c, allocations: divisible.map((a) => ({ assetId: a.id, shares })) }));
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-600">財産を1件ずつ、誰が受け取るかを選んでください。</p>
        <Button variant="secondary" onClick={byLegalShare}>
          すべて法定相続分どおりにする
        </Button>
      </div>
      {heirs.length === 0 && <Note tone="warn">先に「相続人」で家族を登録してください。</Note>}
      <ol className="space-y-4">
        {divisible.map((a, i) => (
          <AssetChoice key={a.id} no={i + 1} assetId={a.id} heirs={heirs} />
        ))}
      </ol>

      {result && (
        <Card title="この分け方での各人の取得額と相続税">
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {result.persons.map((p) => (
              <li key={p.person.id} className="rounded-lg border border-stone-200 p-3 text-sm">
                <p className="font-bold">
                  {p.person.name} <span className="text-xs font-normal text-stone-500">{p.person.relationLabel}</span>
                </p>
                <p className="mt-1 flex justify-between tabular-nums"><span className="text-stone-500">受け取る財産</span>{fmt(p.acquired)}円</p>
                <p className="flex justify-between tabular-nums"><span className="text-stone-500">課税価格</span>{fmt(p.taxable)}円</p>
                <p className="flex justify-between font-bold tabular-nums text-teal-800"><span>納める相続税</span>{fmt(p.payable)}円</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-right text-sm">
            家族全体で納める相続税 <span className="text-lg font-bold tabular-nums text-teal-800">{fmt(result.totalPayable)}円</span>
          </p>
          {data.assets.some((a) => a.kind === "insurance" || a.kind === "retirement") && (
            <p className="mt-2 text-xs text-stone-500">生命保険金・死亡退職金は受取人が受け取るため、ここでは分けません（非課税枠を差し引いて計算に入れています）。</p>
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

type ChoiceMode = "one" | "many" | "undecided";

/** 財産1件の分け方：「1人が全部」「複数人で分ける」「まだ決まっていない」から選ぶ */
function AssetChoice({ no, assetId, heirs }: { no: number; assetId: string; heirs: Person[] }) {
  const { data, update, result } = useCase();
  const a = data.assets.find((x) => x.id === assetId)!;
  const alloc = data.allocations.find((x) => x.assetId === assetId);
  const shares = alloc?.shares ?? [];
  const derived: ChoiceMode | null = shares.length === 0 ? (alloc ? "undecided" : null) : shares.length === 1 && shares[0].numerator === shares[0].denominator ? "one" : "many";
  const [picked, setPicked] = useState<ChoiceMode | null>(null);
  const mode = picked ?? derived;
  const total = shares.reduce((s, x) => s + x.numerator / x.denominator, 0);
  const line = result?.assets.find((l) => l.asset.id === assetId);

  const setAlloc = (next: Allocation["shares"]) =>
    update((c) => ({ ...c, allocations: [...c.allocations.filter((x) => x.assetId !== assetId), { assetId, shares: next }] }));
  const setOne = (personId: string, text: string) => {
    const p = parseShare(text);
    const others = shares.filter((s) => s.personId !== personId);
    setAlloc(p && p.n > 0 ? [...others, { personId, numerator: p.n, denominator: p.d }] : others);
  };
  const even = () => setAlloc(heirs.map((h) => ({ personId: h.id, numerator: 1, denominator: heirs.length })));

  const choose = (m: ChoiceMode) => {
    setPicked(m);
    if (m === "undecided") setAlloc([]);
    if (m === "one" && derived !== "one") setAlloc([]);
  };

  return (
    <li className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-bold text-stone-900">
          <span className="mr-2 text-sm text-stone-400">{no}</span>
          <span className="mr-1.5 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-normal">{kindLabel(a.kind)}</span>
          {a.label || "（名称未入力）"}
        </p>
        {line && <p className="tabular-nums text-stone-700">{fmt(line.valuation.value)}円</p>}
      </div>
      <p className="mt-3 text-sm font-semibold text-stone-700">誰が受け取りますか？</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {(
          [
            ["one", "1人が全部"],
            ["many", "複数人で分ける"],
            ["undecided", "まだ決まっていない"],
          ] as const
        ).map(([k, l]) => (
          <button key={k} type="button" onClick={() => choose(k)} className={`rounded-lg border px-2 py-2 text-sm ${mode === k ? "border-brand bg-brand-soft font-bold text-stone-900" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50"}`}>
            {l}
          </button>
        ))}
      </div>

      {mode === "one" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {heirs.map((h) => {
            const on = shares.length === 1 && shares[0].personId === h.id;
            return (
              <button key={h.id} type="button" onClick={() => setAlloc([{ personId: h.id, numerator: 1, denominator: 1 }])} className={`rounded-full border px-4 py-1.5 text-sm ${on ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 hover:border-teal-500"}`}>
                {h.name || "（名前未入力）"}
                <span className={`ml-1 text-xs ${on ? "text-white/80" : "text-stone-500"}`}>{h.relationLabel}</span>
              </button>
            );
          })}
        </div>
      )}

      {mode === "many" && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-stone-500">それぞれの割合を「1/2」「1/3」のように入れてください。合計が1になるようにします。</p>
          <ul className="space-y-1.5">
            {heirs.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3">
                <span className="text-sm">
                  {h.name || "（名前未入力）"} <span className="text-xs text-stone-500">{h.relationLabel}</span>
                </span>
                <ShareCell key={`${h.id}:${shareText(shares.find((s) => s.personId === h.id))}`} value={shareText(shares.find((s) => s.personId === h.id))} onCommit={(v) => setOne(h.id, v)} />
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between">
            <button type="button" onClick={even} className="text-sm text-sky-800 underline">
              全員で均等に分ける
            </button>
            {shares.length > 0 && Math.abs(total - 1) > 1e-9 && <span className="text-xs text-red-700">合計が1になっていません（いま {Math.round(total * 1000) / 1000}）</span>}
          </div>
        </div>
      )}

      {mode === "undecided" && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          決まったら、ここで選び直してください。分け方が決まらないまま申告する場合（未分割の申告）は、相続コンパスでは作れないため、税理士にご相談ください。
        </p>
      )}
    </li>
  );
}
