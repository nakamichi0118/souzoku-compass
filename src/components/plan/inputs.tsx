"use client";

import { YenInput } from "@/components/ui";

/** 選択肢。value が undefined のときは何も選ばれていない状態。スマホでも指で押しやすい高さにし、幅が足りなければ次の行へ折り返す */
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
            className={`min-h-11 max-w-full touch-manipulation rounded-full border px-4 py-2 text-sm leading-snug font-medium transition sm:min-h-10 ${
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
  // 続けて押しても、スマホで画面が拡大されないようにする（touch-manipulation）
  const btn = "grid h-11 w-11 shrink-0 touch-manipulation place-items-center rounded-full border border-stone-300 bg-white text-lg font-bold text-stone-700 hover:border-teal-600 disabled:opacity-40 sm:h-10 sm:w-10";
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

export function Q({ label, hint, children, align, missing }: { label: string; hint?: string; children: React.ReactNode; align?: boolean; missing?: boolean }) {
  // align：横に並べたとき、説明の長さが違っても入力欄の高さをそろえる
  // missing：まだ答えていない（飛ばした）質問。左に印をつけ、data-missing で「未回答へ」から送れるようにする
  return (
    <div
      data-q
      data-missing={missing ? "" : undefined}
      className={`scroll-mt-28 rounded-md border-t border-stone-100 py-4 transition-shadow first:border-t-0 first:pt-0 ${missing ? "-mx-2 border-l-4 border-l-orange-400 bg-orange-50/60 px-2" : ""} ${align ? "flex flex-col gap-2" : "space-y-2"}`}
    >
      <p className="font-medium text-stone-800">
        {label}
        {missing && <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 align-middle text-[11px] font-bold text-orange-800">未回答</span>}
      </p>
      {hint && <p className="text-xs leading-relaxed text-stone-500">{hint}</p>}
      {align ? <div className="mt-auto">{children}</div> : children}
    </div>
  );
}
