"use client";

import { useEffect, useState } from "react";

export function Card({ title, children, actions, className = "" }: { title?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-stone-200 bg-white p-5 shadow-sm ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-lg font-bold text-stone-800">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-stone-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base text-stone-900 focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/20";

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputCls} ${props.className ?? ""}`} />;
}

export function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** 単位つきの入力欄。単位は入力欄の中の右端に置き、数字と重ならないようにする */
function UnitBox({ unit, children }: { unit?: string; children: React.ReactNode }) {
  return (
    <div className="flex w-full items-center rounded-lg border border-stone-300 bg-white focus-within:border-teal-600 focus-within:ring-2 focus-within:ring-teal-600/20">
      {children}
      {unit && <span className="shrink-0 whitespace-nowrap pr-3 pl-1 text-sm text-stone-500">{unit}</span>}
    </div>
  );
}
const boxInputCls = "min-w-0 flex-1 rounded-lg bg-transparent px-3 py-2 text-right text-base tabular-nums text-stone-900 focus:outline-none";

/** 円単位の数値入力（3桁区切り表示） */
export function YenInput({ value, onChange, unit = "円" }: { value: number | undefined; onChange: (v: number) => void; unit?: string }) {
  const [text, setText] = useState(value != null ? value.toLocaleString("ja-JP") : "");
  useEffect(() => {
    setText(value != null ? value.toLocaleString("ja-JP") : "");
  }, [value]);
  return (
    <UnitBox unit={unit}>
      <input
        inputMode="numeric"
        className={boxInputCls}
        value={text}
        // 0 のときは、入力を始めると 0 が消えるようにする
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^\d]/g, "");
          setText(digits ? Number(digits).toLocaleString("ja-JP") : "");
          onChange(digits ? Number(digits) : 0);
        }}
      />
    </UnitBox>
  );
}

/** 小数も入る数値入力（地積・奥行など）。先頭の 0 は自動で取る */
export function NumInput({ value, onChange, unit }: { value: number | undefined; onChange: (v: number) => void; step?: string; unit?: string }) {
  const show = (v: number | undefined) => (v == null ? "" : String(v));
  const [text, setText] = useState(show(value));
  useEffect(() => {
    setText((t) => (Number(t) === value ? t : show(value)));
  }, [value]);
  return (
    <UnitBox unit={unit}>
      <input
        inputMode="decimal"
        className={boxInputCls}
        value={text}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          let t = e.target.value.normalize("NFKC").replace(/[^\d.]/g, "");
          const dot = t.indexOf(".");
          if (dot >= 0) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, "");
          t = t.replace(/^0+(?=\d)/, "");
          setText(t);
          onChange(t === "" || t === "." ? 0 : Number(t));
        }}
      />
    </UnitBox>
  );
}

export function Button({ variant = "primary", className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const v = {
    primary: "bg-teal-700 text-white hover:bg-teal-800 disabled:bg-stone-300",
    secondary: "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50",
    ghost: "text-teal-800 hover:bg-teal-50",
    danger: "text-red-700 hover:bg-red-50",
  }[variant];
  return <button type="button" {...props} className={`inline-flex items-center justify-center gap-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${v} ${className}`} />;
}

export function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-stone-700">
      <input type="checkbox" className="h-4 w-4 accent-teal-700" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Note({ tone = "info", children }: { tone?: "info" | "warn" | "stop" | "ok"; children: React.ReactNode }) {
  const c = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warn: "border-amber-200 bg-amber-50 text-amber-900",
    stop: "border-red-200 bg-red-50 text-red-900",
    ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[tone];
  return <div className={`rounded-lg border px-4 py-3 text-sm leading-relaxed ${c}`}>{children}</div>;
}

export const fmt = (n: number) => n.toLocaleString("ja-JP");
