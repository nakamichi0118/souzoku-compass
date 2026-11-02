"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { usePlan } from "@/lib/planStore";

/** 「はじめる」：登録済みなら聞き取りへ、未登録なら利用者登録へ */
export default function StartPage() {
  const { account, loaded } = usePlan();
  const router = useRouter();
  useEffect(() => {
    if (loaded) router.replace(account ? "/my/hearing" : "/signup");
  }, [loaded, account, router]);
  return null;
}
