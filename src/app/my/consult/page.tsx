"use client";

import { useEffect, useState } from "react";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { ConsultInbox, type ConsultItem } from "@/components/consult/ConsultThread";
import { ConsultDemoNotice, ConsultForm, FirmBadge } from "@/components/compass/ConsultForm";
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
        <PageHead title="税理士への相談" say="返事と打ち合わせの案内は、ここに届きます。" />
        <div className="rounded-xl border border-sky-100 bg-white p-3">
          <FirmBadge />
        </div>
        {!user && ready ? (
          <ConsultDemoNotice />
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
                <p className="text-sm text-stone-600">まだ相談はありません。</p>
                <ConsultForm onSent={load} />
              </div>
            }
          />
        )}
      </div>
    </AppShell>
  );
}
