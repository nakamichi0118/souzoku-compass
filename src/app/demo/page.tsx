"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { demoCase } from "@/data/demo";
import { useSession } from "@/lib/cloud";
import { usePlan } from "@/lib/planStore";
import { useCase } from "@/lib/store";

/** デモ（架空の家族）でマイページを開く。デモのデータはサーバーに送らない */
export default function DemoPage() {
  const { mode, ready, enterDemo } = useSession();
  const { startDemo, loaded } = usePlan();
  const { replace, loaded: caseLoaded } = useCase();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    if (mode !== "demo") {
      void enterDemo();
      return;
    }
    if (!loaded || !caseLoaded) return;
    startDemo();
    replace(structuredClone(demoCase));
    router.replace("/my");
  }, [ready, mode, enterDemo, loaded, caseLoaded, startDemo, replace, router]);
  return <p className="p-10 text-center text-stone-500">デモのマイページを準備しています…</p>;
}
