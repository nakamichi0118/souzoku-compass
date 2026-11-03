"use client";

import { YenInput } from "@/components/ui";

/** 選択肢。value が undefined のときは何も選ばれていない状態 */
export function Choice<T extends string | boolean>({ value, onChange, options }: { value: T | undefined; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
              on ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 bg-white text-stone-700 hover:border-teal-600"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export const YesNo = ({ value, onChange, yes = "はい", no = "いいえ" }: { value: boolean | undefined; onChange: (v: boolean) => void; yes?: string; no?: string }) => (
  <Choice value={value} onChange={onChange} options={[{ value: true, label: yes }, { value: false, label: no }]} />
);

export function Counter({ value, onChange, max = 10, unit = "人" }: { value: number; onChange: (v: number) => void; max?: number; unit?: string }) {
  const btn = "grid h-10 w-10 place-items-center rounded-full border border-stone-300 bg-white text-lg font-bold text-stone-700 hover:border-teal-600 disabled:opacity-40";
  return (
    <div className="flex items-center gap-3">
      <button type="button" className={btn} onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0} aria-label="減らす">
        −
      </button>
      <span className="min-w-12 text-center text-lg font-bold tabular-nums">
        {value}
        <span className="ml-0.5 text-sm font-normal text-stone-500">{unit}</span>
      </span>
      <button type="button" className={btn} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="増やす">
        ＋
      </button>
    </div>
  );
}

/** 万円単位で入力する金額欄（内部は円） */
export function ManYen({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return <YenInput value={Math.round(value / 10_000)} onChange={(v) => onChange(v * 10_000)} unit="万円" />;
}

export function Q({ label, hint, children, align }: { label: string; hint?: string; children: React.ReactNode; align?: boolean }) {
  // align：横に並べたとき、説明の長さが違っても入力欄の高さをそろえる
  return (
    <div data-q className={`scroll-mt-28 border-t border-stone-100 py-4 first:border-t-0 first:pt-0 ${align ? "flex flex-col gap-2" : "space-y-2"}`}>
      <p className="font-medium text-stone-800">{label}</p>
      {hint && <p className="text-xs leading-relaxed text-stone-500">{hint}</p>}
      {align ? <div className="mt-auto">{children}</div> : children}
    </div>
  );
}
