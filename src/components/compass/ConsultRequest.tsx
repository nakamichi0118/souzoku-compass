"use client";

import { Mail, UserRound } from "lucide-react";
import Link from "next/link";
import { CONSULT_FIRM } from "@/data/consultFirm";
import { consultPrompt } from "@/domain/review/topics";
import { consultMailto } from "@/lib/consult";
import { useCase } from "@/lib/store";

/**
 * 相談をすすめるカード：「〇〇のため、税務の判断が必要です。…相談しますか？」と、相談の概要を入れたメールを開くボタン。
 * 送るのは利用者のメールソフトから（送る前に内容を確かめられる）。送り先が決まっていなければ相談の案内ページへ
 */
export function ConsultRequest({ reasons }: { reasons: string[] }) {
  const { data, result, update } = useCase();
  if (!reasons.length) return null;
  const href = consultMailto(data, result);
  const opened = () => update((c) => ({ ...c, review: { ...c.review, consultOpenedAt: new Date().toISOString() } }));
  return (
    <div className="rounded-xl border border-orange-300 bg-orange-50 p-4 text-sm text-orange-950">
      <ul className="space-y-1">
        {reasons.map((r) => (
          <li key={r}>{consultPrompt(r)}</li>
        ))}
      </ul>
      <p className="mt-2 font-semibold">相談しますか？</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {href ? (
          <a href={href} onClick={opened} className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 font-semibold text-white hover:opacity-90">
            <Mail className="h-4 w-4" aria-hidden />
            {CONSULT_FIRM.name}に相談する
          </a>
        ) : (
          <Link href="/consult" className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 font-semibold text-white hover:opacity-90">
            <UserRound className="h-4 w-4" aria-hidden />
            相談する
          </Link>
        )}
        {data.review?.consultOpenedAt && <span className="text-xs text-orange-900">相談のメールを作りました（{new Date(data.review.consultOpenedAt).toLocaleDateString("ja-JP")}）</span>}
      </div>
      {href && (
        <details className="mt-2 text-xs text-orange-900">
          <summary className="cursor-pointer py-1">Tips：送られる内容</summary>
          <p className="mt-1 leading-relaxed">
            お使いのメールソフトが開き、相談の概要（亡くなった日・相続人・財産と税額の合計・相談したいこと）が入った状態になります。内容を確かめてから送ってください。送らなければ、どこにも送られません。
          </p>
        </details>
      )}
    </div>
  );
}
