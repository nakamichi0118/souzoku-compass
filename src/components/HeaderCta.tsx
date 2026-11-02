"use client";

import Link from "next/link";
import { usePlan } from "@/lib/planStore";

/** 登録済みならマイページへ、まだなら「はじめる」 */
export function HeaderCta({ big }: { big?: boolean }) {
  const { account, loaded } = usePlan();
  const mine = loaded && !!account;
  const cls = big ? "rounded-full bg-sky-700 px-7 py-3.5 font-bold text-white shadow-lg hover:bg-sky-800" : "rounded-full bg-sky-700 px-5 py-2 text-sm font-bold text-white shadow hover:bg-sky-800";
  return (
    <Link href={mine ? "/my" : "/start"} className={cls}>
      {mine ? `マイページへ（${account?.name}さん）` : big ? "はじめる（無料・約3分） ›" : "はじめる"}
    </Link>
  );
}
