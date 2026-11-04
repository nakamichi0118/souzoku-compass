"use client";

import { Copy, ExternalLink } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { Card } from "@/components/ui";
import { consultMemo, consultPoints } from "@/lib/consult";
import { ConsultForm, FirmBadge } from "./ConsultForm";
import { useCase } from "@/lib/store";

export function ConsultPage() {
  const { data, result, loaded } = useCase();
  const topic = useSearchParams().get("topic");
  const [copied, setCopied] = useState(false);
  if (!loaded) return null;
  const points = consultPoints(data, result);
  const memo = consultMemo(data, result);
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl space-y-5">
        <PageHead
          title="税理士に相談する"
          say={topic ? `「${topic}」は判断で税額が変わるので、税理士に確かめると安心です。` : "判断で税額が変わるところは、税理士に確かめると安心です。"}
        />
        <Card title="相談のときに伝えること">
          {points.length === 0 ? (
            <p className="text-sm text-stone-600">いまのところ、特に確認が必要な点はありません。</p>
          ) : (
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-stone-800">
              {points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(memo);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                /* コピーできない環境では何もしない */
              }
            }}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
          >
            <Copy className="h-4 w-4" aria-hidden />
            {copied ? "コピーしました" : "相談メモをコピー"}
          </button>
        </Card>
        <Card title="相談先を探す">
          <ul className="space-y-3 text-sm">
            <li className="space-y-2">
              <FirmBadge />
              <ConsultForm />
            </li>
            <li>
              <a href="https://www.zeirishikensaku.jp/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand underline">
                税理士情報検索サイト（日本税理士会連合会）
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
              <p className="mt-0.5 text-stone-600">地域から探せます。相続税の申告を多く扱う事務所が安心です。</p>
            </li>
            <li>
              <p className="font-semibold text-stone-800">相続コンパスで作った資料を持っていく</p>
              <p className="mt-0.5 text-stone-600">財産の一覧・申告書の下書き（PDF）・集めた書類があると、相談も見積もりも早く進みます。</p>
            </li>
          </ul>
        </Card>
      </div>
    </AppShell>
  );
}
