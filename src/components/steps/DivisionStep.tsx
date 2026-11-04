"use client";

import { useState } from "react";
import { Button, Card, Check, Field, Note, Select, YenInput, fmt } from "@/components/ui";
import { civilHeirIds, determineHeirs } from "@/domain/heirs";
import type { Allocation, Case, Compensation, Person } from "@/domain/types";
import { divisibleAssets, isAllocated, unsettledAssets } from "@/lib/progress";
import { useCase } from "@/lib/store";
import { kindLabel } from "./AssetsStep";

function parseShare(s: string): { n: number; d: number } | null {
  // 全角の数字や「／」で入力されても読めるように、半角にそろえる
  const t = s.normalize("NFKC").trim();
  if (!t) return null;
  const m = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m && Number(m[2]) > 0) return { n: Number(m[1]), d: Number(m[2]) };
  if (/^\d+$/.test(t)) return { n: Number(t), d: 1 };
  return null;
}
/**
 * 「すべて法定相続分どおりに分けると決めた」：遺産分割協議で決めた分け方として、分ける財産すべてに法定相続分を入れる。
 * 決まった分け方になるので、「分け方がまだ決まっていない」のチェックは外す
 */
export function legalShareDivision(c: Case): Case {
  let civil: ReturnType<typeof determineHeirs>;
  try {
    civil = determineHeirs(c.persons, "civil");
  } catch {
    return c; // 相続人の入力途中は何も変えない
  }
  const shares = [...civil.byPerson].map(([personId, f]) => ({ personId, numerator: Number(f.n), denominator: Number(f.d) }));
  return { ...c, undivided: undefined, allocations: divisibleAssets(c).map((a) => ({ assetId: a.id, shares })) };
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
  // 取得する人が決まっていない財産は計算に入らないので、そのあいだは税額を出さない
  const unsettled = unsettledAssets(data);
  const divisible = data.assets.filter((a) => a.kind !== "insurance" && a.kind !== "retirement");
  // 「均等に分ける」の対象は、相続放棄をしていない民法上の相続人だけ（相続人でない人・放棄した人は含めない）
  const evenHeirs = (() => {
    try {
      const ids = civilHeirIds(data.persons);
      return heirs.filter((h) => ids.has(h.id));
    } catch {
      return [];
    }
  })();

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-600">財産ごとに、受け取る人を選びます。</p>
        {/* 決まった分け方として計算される（配偶者の税額軽減・小規模宅地等の特例も使う）ので、「まだ決まっていない」のときは出さない */}
        {!data.undivided && (
          <Button variant="secondary" onClick={() => update(legalShareDivision)}>
            すべて法定相続分どおりに分けると決めた
          </Button>
        )}
      </div>
      <div>
        <Check checked={!!data.undivided} onChange={(v) => update((c) => ({ ...c, undivided: v || undefined }))} label="分け方がまだ決まっていない" />
        {data.undivided && <p className="mt-1 pl-6 text-xs text-stone-500">決まっていない財産は法定相続分で計算します。</p>}
      </div>
      {heirs.length === 0 && <Note tone="warn">先に「相続人」で家族を登録してください。</Note>}
      <ol className="space-y-4">
        {divisible.map((a, i) => (
          <AssetChoice key={a.id} no={i + 1} assetId={a.id} heirs={heirs} evenHeirs={evenHeirs} />
        ))}
      </ol>
      {heirs.length > 0 && <CompensationList living={heirs} />}

      {result && unsettled.length > 0 && (
        <Note tone="warn">
          取得する人が決まっていない財産（{unsettled.map((a) => a.label || "名称未入力").join("、")}）があるため、まだ税額を出せません。
        </Note>
      )}
      {result && unsettled.length === 0 && (
        <Card title={result.blockers.length > 0 ? "この分け方での相続税（暫定）" : "この分け方での相続税"}>
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
            <p className="mt-2 text-xs text-stone-500">生命保険金・死亡退職金は受取人のものなので、ここでは分けません。</p>
          )}
        </Card>
      )}
      {result?.warnings.map((w, i) => (
        <Note key={`${i}:${w}`} tone="warn">
          {w}
        </Note>
      ))}
    </div>
  );
}

type ChoiceMode = "one" | "many" | "undecided";

/** 財産1件の分け方：「1人」（1人が全部）「複数人」（複数人で分ける）「未定」（まだ決まっていない）から選ぶ */
function AssetChoice({ no, assetId, heirs, evenHeirs }: { no: number; assetId: string; heirs: Person[]; evenHeirs: Person[] }) {
  const { data, update, result } = useCase();
  const a = data.assets.find((x) => x.id === assetId)!;
  const alloc = data.allocations.find((x) => x.assetId === assetId);
  const shares = alloc?.shares ?? [];
  const derived: ChoiceMode | null = shares.length === 0 ? (alloc ? "undecided" : null) : shares.length === 1 && shares[0].numerator === shares[0].denominator ? "one" : "many";
  const [picked, setPicked] = useState<ChoiceMode | null>(null);
  // 選んだ分け方は、保存されている内容と食い違わないときだけ使う
  // （「すべて法定相続分どおりに分けると決めた」などで中身が変わったら、中身のほうを表示する）
  const fits = (m: ChoiceMode) => m === "many" || shares.length === 0 || m === derived;
  const mode = picked && fits(picked) ? picked : derived;
  const total = shares.reduce((s, x) => s + x.numerator / x.denominator, 0);
  const line = result?.assets.find((l) => l.asset.id === assetId);
  // 未分割で申告するときは、決まっていない財産（一部だけ決まっている財産の残りも）を法定相続分で計算する
  const undividedPart = !!data.undivided && (!isAllocated(data, assetId) || total < 1 - 1e-9);

  const setAlloc = (next: Allocation["shares"]) =>
    update((c) => ({ ...c, allocations: [...c.allocations.filter((x) => x.assetId !== assetId), { assetId, shares: next }] }));
  const setOne = (personId: string, text: string) => {
    const p = parseShare(text);
    // 読み取れない入力のときは、いまの割合を消さずにそのまま残す（欄は赤く表示される）
    if (!p && text.trim() !== "") return;
    const others = shares.filter((s) => s.personId !== personId);
    setAlloc(p && p.n > 0 ? [...others, { personId, numerator: p.n, denominator: p.d }] : others);
  };
  const even = () => {
    if (evenHeirs.length === 0) return;
    setAlloc(evenHeirs.map((h) => ({ personId: h.id, numerator: 1, denominator: evenHeirs.length })));
  };

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
        <div className="flex flex-wrap items-baseline gap-2">
          {undividedPart && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">未分割（法定相続分）</span>}
          {line && <p className="tabular-nums text-stone-700">{fmt(line.valuation.value)}円</p>}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2" role="group" aria-label="受け取る人">
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
          <p className="text-xs text-stone-500">割合を「1/2」のように入れます（合計1）。</p>
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
            <button type="button" onClick={even} disabled={evenHeirs.length === 0} className="py-2 text-sm text-sky-800 underline disabled:text-stone-400 disabled:no-underline">
              相続人全員で均等に分ける
            </button>
            {shares.length > 0 && Math.abs(total - 1) > 1e-9 && !(undividedPart && total < 1) && (
              <span className="text-xs text-red-700">合計が1になっていません（いま {Math.round(total * 1000) / 1000}）</span>
            )}
          </div>
        </div>
      )}

      {mode === "undecided" && !data.undivided && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          申告期限までに決まらないときは、上の「分け方がまだ決まっていない」にチェックします。
        </p>
      )}
    </li>
  );
}

/** 代償金：財産を多く受け継いだ人が、ほかの人にお金を払う（代償分割）。入れたものがあれば開いておく */
function CompensationList({ living }: { living: Person[] }) {
  const { data, update, result } = useCase();
  const rows = data.compensation ?? [];
  const [open, setOpen] = useState(rows.length > 0);
  const isLiving = (id: string) => living.some((p) => p.id === id);
  const options = [{ value: "", label: "選んでください" }, ...living.map((p) => ({ value: p.id, label: p.name || "（名前未入力）" }))];
  // 代償金の額のもとにできる財産（分け方を決める財産）
  const bases = divisibleAssets(data);
  const isBase = (id: string) => bases.some((a) => a.id === id);
  const baseOptions = [{ value: "", label: "選んでください" }, ...bases.map((a) => ({ value: a.id, label: a.label || "（名称未入力）" }))];
  const set = (i: number, p: Partial<Compensation>) => update((c) => ({ ...c, compensation: (c.compensation ?? []).map((x, j) => (j === i ? { ...x, ...p } : x)) }));
  const setBasis = (i: number, p: Partial<NonNullable<Compensation["basis"]>>) =>
    update((c) => ({ ...c, compensation: (c.compensation ?? []).map((x, j) => (j === i ? { ...x, basis: { assetId: "", marketValue: 0, ...x.basis, ...p } } : x)) }));
  const remove = (i: number) => update((c) => ({ ...c, compensation: (c.compensation ?? []).filter((_, j) => j !== i) }));
  const add = () => update((c) => ({ ...c, compensation: [...(c.compensation ?? []), { fromId: "", toId: "", amount: 0 }] }));
  const incomplete = rows.some((x) => !isLiving(x.fromId) || !isLiving(x.toId) || x.fromId === x.toId || !(x.amount > 0));

  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <summary className="cursor-pointer font-bold text-stone-800">代償金（多く受け継いだ人が払うお金）</summary>
      <div className="mt-3 space-y-2">
        <p className="text-xs text-stone-500">払う人の財産から引き、受け取る人の財産に足して計算します。</p>
        {rows.map((x, i) => (
          <div key={i} className="grid items-end gap-2 rounded-lg border border-stone-200 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Field label="払う人">
              <Select value={isLiving(x.fromId) ? x.fromId : ""} onChange={(v) => set(i, { fromId: v })} options={options} />
            </Field>
            <Field label="受け取る人">
              <Select value={isLiving(x.toId) ? x.toId : ""} onChange={(v) => set(i, { toId: v })} options={options} />
            </Field>
            <Field label="金額">
              <YenInput value={x.amount} onChange={(v) => set(i, { amount: v })} />
            </Field>
            <Button variant="danger" onClick={() => remove(i)}>
              削除
            </Button>
            <CompensationBasis
              basis={x.basis}
              baseOk={!!x.basis && isBase(x.basis.assetId)}
              options={baseOptions}
              value={result?.compensation?.[i]?.value}
              onToggle={(v) => set(i, { basis: v ? { assetId: "", marketValue: 0 } : undefined })}
              onChange={(p) => setBasis(i, p)}
            />
          </div>
        ))}
        <Button variant="secondary" onClick={add}>
          ＋ 代償金を追加
        </Button>
        {incomplete && <Note tone="warn">払う人と受け取る人（別の人）、金額を入れてください。入れるまで相続税の計算を確定できません。</Note>}
      </div>
    </details>
  );
}

/**
 * 代償金の額を、特定の財産の時価をもとに決めたとき（相基通11の2-10(2)）。
 * 課税価格に入れる額は 代償金 × その財産の相続税評価額 ÷ 時価 になる（計算は税額の計算のほうで行う）
 */
export function CompensationBasis({
  basis,
  baseOk,
  options,
  value,
  onToggle,
  onChange,
}: {
  basis: Compensation["basis"];
  baseOk: boolean;
  options: { value: string; label: string }[];
  /** 課税価格に入れる額（計算できたとき） */
  value?: number;
  onToggle: (on: boolean) => void;
  onChange: (p: Partial<NonNullable<Compensation["basis"]>>) => void;
}) {
  const ready = !!basis && baseOk && basis.marketValue > 0;
  return (
    <div className="space-y-2 sm:col-span-4">
      <Check checked={!!basis} onChange={onToggle} label="特定の財産の時価をもとに金額を決めた" />
      {basis && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="もとにした財産">
            <Select value={baseOk ? basis.assetId : ""} onChange={(v) => onChange({ assetId: v })} options={options} />
          </Field>
          <Field label="その財産の時価">
            <YenInput value={basis.marketValue} onChange={(v) => onChange({ marketValue: v })} />
          </Field>
          <p className="text-xs text-stone-500 sm:col-span-2">
            課税価格には 代償金 × 評価額 ÷ 時価 で入れます{ready && value != null && value > 0 ? `（${fmt(value)}円）` : ""}。
            {!ready && <span className="ml-1 font-medium text-amber-800">もとにした財産と時価を入れてください。</span>}
          </p>
        </div>
      )}
    </div>
  );
}
