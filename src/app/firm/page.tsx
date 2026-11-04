"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConsultInbox, type ConsultItem } from "@/components/consult/ConsultThread";
import { FirmBadge } from "@/components/compass/ConsultForm";
import { useSession } from "@/lib/cloud";

/** 事務所の画面：届いた相談の一覧・返信・打ち合わせの案内（事務所のアカウントだけ） */
export default function FirmPage() {
  const { user, ready } = useSession();
  const [items, setItems] = useState<ConsultItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () =>
    fetch("/api/consult?all=1", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        setItems(j.items);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    if (ready && user) load();
  }, [ready, user]);
  const change = (x: ConsultItem) => setItems((xs) => (xs ?? []).map((y) => (y.id === x.id ? x : y)));

  return (
    <main className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-sky-950">届いた相談</h1>
        <FirmBadge />
      </div>
      {ready && !user ? (
        <Link href="/login" className="inline-block rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">
          事務所のアカウントでログイン
        </Link>
      ) : err ? (
        <p className="text-sm text-red-700">{err}</p>
      ) : items === null ? (
        <p className="text-sm text-stone-500">読み込み中…</p>
      ) : (
        <>
          <button type="button" onClick={load} className="text-sm font-semibold text-teal-800 underline">
            更新
          </button>
          <ConsultInbox items={items} staff onChange={change} empty={<p className="text-sm text-stone-600">まだ相談は届いていません。</p>} />
        </>
      )}
    </main>
  );
}
