"use client";

import Link from "next/link";
import { usePlan } from "@/lib/planStore";

/** 登録済みならマイページへ、まだなら「はじめる」 */
export function HeaderCta({ big }: { big?: boolean }) {
  const { account, loaded } = usePlan();
  const mine = loaded && !!account;
  // 1つのまとまりにして、スマホでも丸い形が2つに割れないようにする。上の帯（小）では名前を出さず、1行に収める
  const cls = big
    ? "inline-block max-w-full rounded-full bg-sky-700 px-7 py-3.5 text-center font-bold text-white shadow-lg hover:bg-sky-800"
    : "inline-block whitespace-nowrap rounded-full bg-sky-700 px-5 py-2 text-sm font-bold text-white shadow hover:bg-sky-800";
  return (
    <Link href={mine ? "/my" : "/start"} className={cls}>
      {mine ? (big ? `マイページへ（${account?.name}さん）` : "マイページへ") : big ? "はじめる（無料・約3分） ›" : "はじめる"}
    </Link>
  );
}
