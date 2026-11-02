"use client";

import Link from "next/link";
import { LogoMark } from "./compass/CompassKun";
import { STEPS, stepIndex } from "@/lib/steps";

export function StepBar({ current }: { current: string }) {
  const idx = stepIndex(current);
  return (
    <header className="fixed inset-x-0 top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2">
        <Link href="/" className="flex shrink-0 items-center gap-1.5 text-base font-bold text-sky-950">
          <LogoMark size={26} />
          相続コンパス
        </Link>
        <Link href="/#progress" className="hidden shrink-0 rounded-full border border-stone-300 px-2.5 py-1 text-xs text-stone-600 hover:bg-stone-50 sm:inline">
          ← 手続きリスト
        </Link>
        <nav aria-label="進捗" className="flex-1 overflow-x-auto">
          <ol className="flex min-w-max items-center gap-1">
            {STEPS.map((s, i) => {
              const state = i < idx ? "done" : i === idx ? "current" : "todo";
              return (
                <li key={s.slug} className="flex items-center">
                  <Link
                    href={`/case/${s.slug}`}
                    aria-current={state === "current" ? "step" : undefined}
                    className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium sm:text-sm ${
                      state === "current"
                        ? "bg-teal-700 text-white"
                        : state === "done"
                          ? "bg-teal-50 text-teal-800 hover:bg-teal-100"
                          : "text-stone-500 hover:bg-stone-100"
                    }`}
                  >
                    <span
                      className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${
                        state === "current" ? "bg-white text-teal-800" : state === "done" ? "bg-teal-700 text-white" : "bg-stone-200 text-stone-600"
                      }`}
                    >
                      {state === "done" ? "✓" : i + 1}
                    </span>
                    <span className="hidden sm:inline">{s.title}</span>
                    <span className="sm:hidden">{s.short}</span>
                  </Link>
                  {i < STEPS.length - 1 && <span className="mx-0.5 h-px w-3 bg-stone-300" aria-hidden />}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </header>
  );
}
