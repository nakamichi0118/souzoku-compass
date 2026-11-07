"use client";

import { useCallback, useRef, useState } from "react";
import type { Faq } from "./faq";

/** 1回だけの質問（税額の画面の「説明して」など）。チャットは右下の CompassChat */
export function useAsk(step: string, context: () => string) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [asked, setAsked] = useState<string | null>(null);
  /** いちばん新しい質問の番号。答えが届くまでに別の質問を選んだら、古い答えは表示しない */
  const reqId = useRef(0);
  /** 自由な質問：Claude に送って答えてもらう */
  const ask = useCallback(
    async (question: string) => {
      if (!question.trim()) return;
      const id = ++reqId.current;
      setAsked(question);
      setBusy(true);
      setAnswer(null);
      try {
        const res = await fetch("/api/assist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ step, question, context: context().slice(0, 6000) }),
        });
        const json = await res.json();
        if (id !== reqId.current) return;
        setAnswer(json.answer ?? json.error ?? "うまく答えられませんでした。");
        setQ("");
      } catch {
        if (id !== reqId.current) return;
        setAnswer("通信に失敗しました。時間をおいてお試しください。");
      } finally {
        if (id === reqId.current) setBusy(false);
      }
    },
    [step, context],
  );
  /** 想定質問：用意した回答をすぐ出す（AI には送らない） */
  const pick = useCallback((f: Faq) => {
    reqId.current++;
    setBusy(false);
    setAsked(f.q);
    setAnswer(f.a);
  }, []);
  return { step, q, setQ, busy, answer, asked, ask, pick };
}

export type AskState = ReturnType<typeof useAsk>;
