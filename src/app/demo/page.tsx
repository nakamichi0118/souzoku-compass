"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (!ready) return;
    if (mode !== "demo") {
      void enterDemo().then(() => setStuck(true));
      return;
    }
    if (!loaded || !caseLoaded) return;
    startDemo();
    replace(structuredClone(demoCase));
    router.replace("/my");
  }, [ready, mode, enterDemo, loaded, caseLoaded, startDemo, replace, router]);
  if (stuck && ready && mode !== "demo")
    return <p className="p-10 text-center text-stone-700">まだ保存できていない入力があるため、デモに切り替えられませんでした。画面の案内から保存し直してから、もう一度お試しください。</p>;
  return <p className="p-10 text-center text-stone-500">デモのマイページを準備しています…</p>;
}
