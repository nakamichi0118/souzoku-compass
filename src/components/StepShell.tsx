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
import { markCompleted, visibleSteps } from "@/lib/progress";
import { useFocusParam } from "./ui/useFocusParam";

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
  const { data, loaded, update } = useCase();
  const idx = stepIndex(step);
  const Comp = COMPONENTS[step];
  // 相続人が1人なら「遺産の分け方」を飛ばして前後をつなぐ
  const shown = visibleSteps(data);
  const at = shown.findIndex((s) => s.slug === step);
  const prev = at >= 0 ? shown[at - 1] : STEPS[idx - 1];
  const next = at >= 0 ? shown[at + 1] : STEPS[idx + 1];
  // 「直す」リンクから来たときは、その行まで送って目立たせる
  useFocusParam(loaded);
  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50/70 to-stone-50">
      <AppHeader />
      <StepBar current={step} />
      <div className="mx-auto grid max-w-6xl gap-6 px-4 pb-24 pt-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-w-0 space-y-5">
          {/* 何番目のステップかは上の帯で分かるので、見出しだけにする */}
          <h1 className="text-2xl font-bold text-stone-900">{STEPS[idx].title}</h1>
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
        {/* パソコンでは横に貼りつけ、画面の高さに収める（収まらない分は中で動かす）。コンパスくんへの質問は右下から */}
        <aside className="lg:sticky lg:top-24 lg:flex lg:max-h-[calc(100dvh-7rem)] lg:flex-col lg:self-start">
          <GuidePanel step={step} />
        </aside>
      </div>
    </div>
  );
}
