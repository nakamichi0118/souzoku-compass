"use client";
/* eslint-disable @next/next/no-img-element */

import { ExternalLink, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui";
import { CONSULT_FIRM, PREFECTURES, prefectureOf } from "@/data/consultFirm";
import { useSession } from "@/lib/cloud";
import { consultMemo } from "@/lib/consult";
import { useCase } from "@/lib/store";

/** 相談を受ける事務所のロゴ・名前・ホームページ */
export function FirmBadge({ size = "md" }: { size?: "sm" | "md" }) {
  const h = size === "sm" ? 24 : 36;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {CONSULT_FIRM.logo ? (
        <img src={CONSULT_FIRM.logo} alt={CONSULT_FIRM.name} style={{ height: h }} className="w-auto" />
      ) : (
        <span className="grid shrink-0 place-items-center rounded-lg bg-sky-900 font-bold text-white" style={{ height: h, width: h, fontSize: h * 0.42 }} aria-hidden>
          IU
        </span>
      )}
      <span className="font-bold text-stone-900">{CONSULT_FIRM.name}</span>
      {CONSULT_FIRM.url && (
        <a href={CONSULT_FIRM.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-xs font-semibold text-teal-800 underline">
          公式ホームページ
          <ExternalLink className="h-3 w-3" aria-hidden />
        </a>
      )}
    </span>
  );
}

const field = "w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm";

/** 相談のフォーム。名前・都道府県・連絡先・相談内容は、入力済みの内容から自動で入れておく */
export function ConsultForm({ onSent }: { onSent?: () => void }) {
  const { data, result } = useCase();
  const { user, mode } = useSession();
  const [f, setF] = useState(() => ({
    name: user?.name ?? "",
    prefecture: prefectureOf(data.decedent.address),
    contact: user?.email ?? "",
    content: consultMemo(data, result),
  }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  if (sent)
    return (
      <div className="rounded-lg bg-white p-3 text-sm text-stone-800">
        <p className="font-semibold text-teal-800">相談を送りました。</p>
        <p className="mt-1">
          {CONSULT_FIRM.name}からの返事や打ち合わせの案内は、
          <Link href="/my/consult" className="font-semibold text-teal-800 underline">
            税理士への相談
          </Link>
          に届きます。
        </p>
      </div>
    );
  if (mode !== "cloud" || !user)
    return (
      <p className="rounded-lg bg-white p-3 text-sm text-stone-700">
        相談を送るには、利用者登録をしてログインしてください（デモでは送れません）。
        <Link href="/signup" className="ml-1 font-semibold text-teal-800 underline">
          登録する
        </Link>
      </p>
    );

  const send = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/consult", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "送れませんでした。");
      setSent(true);
      onSent?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const ok = f.name.trim() && f.prefecture && f.contact.trim() && f.content.trim();
  return (
    <div className="space-y-3 rounded-lg bg-white p-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-stone-600">お名前（必須）</span>
          <input value={f.name} onChange={set("name")} maxLength={50} className={field} />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-stone-600">都道府県（必須）</span>
          <select value={f.prefecture} onChange={set("prefecture")} className={field}>
            <option value="">選んでください</option>
            {PREFECTURES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-semibold text-stone-600">連絡先（必須・電話番号かメールアドレス）</span>
          <input value={f.contact} onChange={set("contact")} maxLength={100} className={field} />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-xs font-semibold text-stone-600">相談内容（必須・入力内容から自動で入れています）</span>
          <textarea value={f.content} onChange={set("content")} maxLength={4000} rows={8} className={field} />
        </label>
      </div>
      {err && <p className="text-xs text-red-700">{err}</p>}
      <Button onClick={send} disabled={busy || !ok}>
        <Send className="mr-1 inline h-4 w-4" aria-hidden />
        {busy ? "送っています…" : `${CONSULT_FIRM.name}に送る`}
      </Button>
    </div>
  );
}
