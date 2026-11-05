"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { centerCurrent } from "@/components/ui/scroll";
import { filingSteps } from "@/lib/progress";
import { STEPS, stepIndex } from "@/lib/steps";
import { useCase } from "@/lib/store";

export function StepBar({ current }: { current: string }) {
  const idx = stepIndex(current);
  const { data, result } = useCase();
  // 「次へ」で終えて、入力もあるステップだけを済みにする
  const done = new Set(filingSteps(data, result).filter((s) => s.done).map((s) => s.slug));
  const navRef = useRef<HTMLElement>(null);
  // スマホで帯に収まらないときも、いまのステップが見えるよう帯を横へ送る
  useEffect(() => centerCurrent(navRef.current), [current]);
  return (
    <div className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center px-4 py-2">
        <nav ref={navRef} data-tour="steps" aria-label="進捗" className="min-w-0 flex-1 overflow-x-auto">
          {/* パソコン（lg 以上）では8つとも短い名前を出す。それより狭い画面では、いまのステップだけ名前を出し、ほかは番号だけにして1行に収める */}
          <ol className="flex min-w-max items-center gap-0.5 lg:gap-1">
            {STEPS.map((s, i) => {
              const state = i === idx ? "current" : done.has(s.slug) ? "done" : "todo";
              return (
                <li key={s.slug} className="flex items-center">
                  <Link
                    href={`/case/${s.slug}`}
                    aria-current={state === "current" ? "step" : undefined}
                    title={s.title}
                    className={`flex items-center gap-1.5 rounded-full py-1 text-xs font-medium lg:px-2.5 lg:text-sm ${state === "current" ? "px-2.5" : "px-0.5"} ${
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
                    <span className={state === "current" ? "whitespace-nowrap" : "sr-only lg:not-sr-only lg:whitespace-nowrap"}>{s.short}</span>
                  </Link>
                  {i < STEPS.length - 1 && <span className="mx-0.5 hidden h-px w-3 bg-stone-300 lg:block" aria-hidden />}
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
    </div>
  );
}
