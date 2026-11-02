import { notFound } from "next/navigation";
import { StepShell } from "@/components/StepShell";
import { STEPS } from "@/lib/steps";

export function generateStaticParams() {
  return STEPS.map((s) => ({ step: s.slug }));
}

export default async function StepPage({ params }: { params: Promise<{ step: string }> }) {
  const { step } = await params;
  if (!STEPS.some((s) => s.slug === step)) notFound();
  return <StepShell step={step} />;
}
