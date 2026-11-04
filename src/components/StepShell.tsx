"use client";

import Link from "next/link";
import { StepBar } from "./StepBar";
import { AppHeader } from "./shell/AppShell";
import { GuidePanel } from "./GuidePanel";
import { DecedentStep } from "./steps/DecedentStep";
import { HeirsStep } from "./steps/HeirsStep";
import { AssetsStep } from "./steps/AssetsStep";
import { DebtsStep } from "./steps/DebtsStep";
import { DivisionStep } from "./steps/DivisionStep";
import { ReviewStep } from "./steps/ReviewStep";
import { TaxStep } from "./steps/TaxStep";
import { DocumentsStep } from "./steps/DocumentsStep";
import { STEPS, stepIndex } from "@/lib/steps";
import { useCase } from "@/lib/store";
import { markCompleted } from "@/lib/progress";

const COMPONENTS: Record<string, React.ComponentType> = {
  decedent: DecedentStep,
  heirs: HeirsStep,
  assets: AssetsStep,
  debts: DebtsStep,
  review: ReviewStep,
  division: DivisionStep,
  tax: TaxStep,
  documents: DocumentsStep,
};

export function StepShell({ step }: { step: string }) {
  const { loaded, update } = useCase();
  const idx = stepIndex(step);
  const Comp = COMPONENTS[step];
  const prev = STEPS[idx - 1];
  const next = STEPS[idx + 1];
  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50/70 to-stone-50">
      <AppHeader />
      <StepBar current={step} />
      <div className="mx-auto grid max-w-6xl gap-6 px-4 pb-24 pt-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-w-0 space-y-5">
          <div>
            <p className="text-sm font-semibold text-teal-700">
              ステップ {idx + 1} / {STEPS.length}
            </p>
            <h1 className="text-2xl font-bold text-stone-900">{STEPS[idx].title}</h1>
          </div>
          {loaded ? <Comp /> : <p className="text-stone-500">読み込み中…</p>}
          <div className="flex justify-between pt-2">
            {prev ? (
              <Link href={`/case/${prev.slug}`} className="rounded-lg px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50">
                ← {prev.title}
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link href={`/case/${next.slug}`} onClick={() => update((c) => markCompleted(c, step))} className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800">
                次へ：{next.title} →
              </Link>
            )}
          </div>
        </main>
        {/* パソコンでは横に貼りつけ、画面の高さに収める（低い画面でも「コンパスくんに聞く」まで見えるように。収まらない分は中で動かす） */}
        <aside className="lg:sticky lg:top-24 lg:flex lg:max-h-[calc(100dvh-7rem)] lg:flex-col lg:self-start">
          <GuidePanel step={step} />
        </aside>
      </div>
    </div>
  );
}
