"use client";

import { useEffect, useState } from "react";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { ConsultInbox, type ConsultItem } from "@/components/consult/ConsultThread";
import { ConsultForm, FirmBadge } from "@/components/compass/ConsultForm";
import { CONSULT_FIRM } from "@/data/consultFirm";
import { useSession } from "@/lib/cloud";

export default function MyConsultPage() {
  const { user, ready } = useSession();
  const [items, setItems] = useState<ConsultItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const load = () =>
    fetch("/api/consult", { cache: "no-store" })
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
    <AppShell>
      <div className="mx-auto max-w-5xl space-y-5">
        <PageHead title="税理士への相談" say={`${CONSULT_FIRM.name}とのやりとりや、打ち合わせの案内がここに届きます。`} />
        <div className="rounded-xl border border-sky-100 bg-white p-3">
          <FirmBadge />
        </div>
        {!user && ready ? (
          <p className="text-sm text-stone-600">相談を送るには、利用者登録をしてログインしてください（デモでは送れません）。</p>
        ) : err ? (
          <p className="text-sm text-red-700">{err}</p>
        ) : items === null ? (
          <p className="text-sm text-stone-500">読み込み中…</p>
        ) : (
          <ConsultInbox
            items={items}
            staff={false}
            onChange={change}
            empty={
              <div className="space-y-3">
                <p className="text-sm text-stone-600">まだ相談はありません。入力した内容をもとに、相談の文面を自動で入れています。</p>
                <ConsultForm onSent={load} />
              </div>
            }
          />
        )}
      </div>
    </AppShell>
  );
}
