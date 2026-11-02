"use client";

import { useCallback, useState } from "react";
import { Bubble, CompassAvatar } from "./CompassKun";

export function useAsk(step: string, context: () => string) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const ask = useCallback(
    async (question: string) => {
      if (!question.trim()) return;
      setQ(question);
      setBusy(true);
      setAnswer(null);
      try {
        const res = await fetch("/api/assist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ step, question, context: context().slice(0, 6000) }),
        });
        const json = await res.json();
        setAnswer(json.answer ?? json.error ?? "うまく答えられませんでした。");
      } catch {
        setAnswer("通信に失敗しました。時間をおいてお試しください。");
      } finally {
        setBusy(false);
      }
    },
    [step, context],
  );
  return { q, setQ, busy, answer, ask };
}

export type AskState = ReturnType<typeof useAsk>;

export function AskCompass({ state, placeholder, lead, id }: { state: AskState; placeholder: string; lead?: React.ReactNode; id?: string }) {
  const { q, setQ, busy, answer, ask } = state;
  return (
    <section id={id} className="space-y-3 rounded-2xl border border-sky-200 bg-gradient-to-b from-sky-50 to-emerald-50/60 p-5">
      <div className="flex items-start gap-3">
        <CompassAvatar size={52} />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="font-bold text-sky-900">コンパスくんに相談</p>
          <Bubble>{busy ? "ちょっと調べています…" : (answer ?? lead ?? "分からないことがあれば、なんでも聞いてくださいね。")}</Bubble>
        </div>
      </div>
      <textarea
        rows={2}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
      />
      <button type="button" onClick={() => ask(q)} disabled={busy || !q.trim()} className="w-full rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:bg-stone-300">
        {busy ? "考えています…" : "コンパスくんに聞く"}
      </button>
    </section>
  );
}
