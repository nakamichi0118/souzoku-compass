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

/** 円単位の数値入力（3桁区切り表示） */
export function YenInput({ value, onChange, unit = "円" }: { value: number | undefined; onChange: (v: number) => void; unit?: string }) {
  const [text, setText] = useState(value != null ? value.toLocaleString("ja-JP") : "");
  useEffect(() => {
    setText(value != null ? value.toLocaleString("ja-JP") : "");
  }, [value]);
  return (
    <div className="relative">
      <input
        inputMode="numeric"
        className={`${inputCls} pr-10 text-right tabular-nums`}
        value={text}
        onChange={(e) => {
          const digits = e.target.value.replace(/[^\d]/g, "");
          setText(digits ? Number(digits).toLocaleString("ja-JP") : "");
          onChange(digits ? Number(digits) : 0);
        }}
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">{unit}</span>
    </div>
  );
}

export function NumInput({ value, onChange, step = "any", unit }: { value: number | undefined; onChange: (v: number) => void; step?: string; unit?: string }) {
  return (
    <div className="relative">
      <input
        type="number"
        step={step}
        className={`${inputCls} ${unit ? "pr-10" : ""} text-right tabular-nums`}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      />
      {unit && <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">{unit}</span>}
    </div>
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
