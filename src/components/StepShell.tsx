"use client";

import Link from "next/link";
import { StepBar } from "./StepBar";
import { GuidePanel } from "./GuidePanel";
import { DecedentStep } from "./steps/DecedentStep";
import { HeirsStep } from "./steps/HeirsStep";
import { AssetsStep } from "./steps/AssetsStep";
import { DebtsStep } from "./steps/DebtsStep";
import { DivisionStep } from "./steps/DivisionStep";
import { TaxStep } from "./steps/TaxStep";
import { DocumentsStep } from "./steps/DocumentsStep";
import { STEPS, stepIndex } from "@/lib/steps";
import { useCase } from "@/lib/store";

const COMPONENTS: Record<string, React.ComponentType> = {
  decedent: DecedentStep,
  heirs: HeirsStep,
  assets: AssetsStep,
  debts: DebtsStep,
  division: DivisionStep,
  tax: TaxStep,
  documents: DocumentsStep,
};

export function StepShell({ step }: { step: string }) {
  const { loaded } = useCase();
  const idx = stepIndex(step);
  const Comp = COMPONENTS[step];
  const prev = STEPS[idx - 1];
  const next = STEPS[idx + 1];
  return (
    <>
      <StepBar current={step} />
      <div className="mx-auto grid max-w-6xl gap-6 px-4 pb-24 pt-20 lg:grid-cols-[1fr_340px]">
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
              <Link href={`/case/${next.slug}`} className="rounded-lg bg-teal-700 px-5 py-2 text-sm font-semibold text-white hover:bg-teal-800">
                次へ：{next.title} →
              </Link>
            )}
          </div>
        </main>
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <GuidePanel step={step} />
        </aside>
      </div>
    </>
  );
}
