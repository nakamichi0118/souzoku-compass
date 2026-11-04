"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { ConsultForm, FirmBadge } from "./ConsultForm";

/**
 * 申告前の確認の最後に出す、相談のおすすめ：
 * 「次の理由で、税理士への相談をおすすめします。」と理由の一覧、自動で入力したフォーム
 */
export function ConsultRequest({ reasons }: { reasons: string[] }) {
  const [open, setOpen] = useState(false);
  if (!reasons.length) return null;
  return (
    <div className="space-y-3 rounded-xl border border-orange-300 bg-orange-50 p-4 text-sm text-orange-950">
      <p className="font-semibold">次の理由で、税理士への相談をおすすめします。</p>
      <ul className="list-disc space-y-1 pl-5">
        {[...new Set(reasons)].map((r) => (
          <li key={r}>{r}です。</li>
        ))}
      </ul>
      <p>判断しだいで税額が大きく変わることがあります。</p>
      <div className="rounded-lg bg-white/70 p-3">
        <FirmBadge />
      </div>
      {open ? <ConsultForm /> : <Button onClick={() => setOpen(true)}>相談内容を確かめて送る</Button>}
    </div>
  );
}
