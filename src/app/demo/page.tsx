"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { demoCase } from "@/data/demo";
import { usePlan } from "@/lib/planStore";
import { useCase } from "@/lib/store";

/** デモ（架空の家族）でマイページを開く */
export default function DemoPage() {
  const { startDemo, loaded } = usePlan();
  const { replace, loaded: caseLoaded } = useCase();
  const router = useRouter();
  useEffect(() => {
    if (!loaded || !caseLoaded) return;
    startDemo();
    replace(structuredClone(demoCase));
    router.replace("/my");
  }, [loaded, caseLoaded, startDemo, replace, router]);
  return <p className="p-10 text-center text-stone-500">デモのマイページを準備しています…</p>;
}
