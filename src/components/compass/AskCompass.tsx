"use client";

import { useCallback, useRef, useState } from "react";
import { revealBelowHeader } from "@/components/ui/scroll";
import { Bubble, CompassAvatar } from "./CompassKun";
import { FAQS, type Faq } from "./faq";
import { Markdown } from "./Markdown";

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

/**
 * コンパスくんに相談する欄。
 * fill：パソコンで横に貼りついた欄のときは、与えられた高さに収め、答えと想定質問の部分だけを中で動かす
 * （入力欄と「コンパスくんに聞く」は、いつも下に見えるように）
 */
export function AskCompass({ state, placeholder, lead, id, fill }: { state: AskState; placeholder: string; lead?: React.ReactNode; id?: string; fill?: boolean }) {
  const { q, setQ, busy, answer, asked, ask, pick } = state;
  const faqs = FAQS[state.step] ?? [];
  const answerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /** 新しい答えの頭が画面の上（見出しの下）に隠れていたら、見える所まで戻す。答えは下へ伸びるので、頭が見えていれば動かさない */
  const showAnswer = () =>
    requestAnimationFrame(() => {
      // 欄の中で動かしているときは、答えの頭（いちばん上）まで戻す
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
      if (answerRef.current) revealBelowHeader(answerRef.current);
    });
  return (
    <section id={id} className={`space-y-3 rounded-2xl border border-sky-200 bg-gradient-to-b from-sky-50 to-emerald-50/60 p-3 sm:p-5${fill ? " lg:flex lg:min-h-0 lg:flex-1 lg:flex-col" : ""}`}>
      <div ref={bodyRef} className={fill ? "space-y-3 lg:-mx-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain lg:px-1" : "space-y-3"}>
        <div className="flex items-start gap-3">
          {/* スマホでは顔を見出しの横に小さく出し、答えの幅を広くとる */}
          <span className="hidden sm:block">
            <CompassAvatar size={52} />
          </span>
          <div ref={answerRef} className="min-w-0 flex-1 space-y-2">
            <p className="flex items-center gap-2 font-bold text-sky-900">
              <span className="sm:hidden">
                <CompassAvatar size={32} />
              </span>
              コンパスくんに相談
            </p>
            {asked && <p className="text-sm text-stone-600">「{asked}」</p>}
            <Bubble>
              {busy ? "ちょっと調べています…" : answer ? <div className="text-sm text-stone-800"><Markdown text={answer} /></div> : (lead ?? "分からないことがあれば、なんでも聞いてくださいね。")}
            </Bubble>
          </div>
        </div>
        {faqs.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {faqs.map((f) => (
              <button
                key={f.q}
                type="button"
                onClick={() => {
                  pick(f);
                  showAnswer();
                }}
                className={`rounded-full border px-3 py-1 text-sm ${asked === f.q ? "border-sky-600 bg-sky-700 text-white" : "border-sky-200 bg-white text-sky-900 hover:bg-sky-50"}`}
              >
                {f.q}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* 文字は 16px（iPhone で入力するときに画面が拡大されないように） */}
      <textarea
        rows={2}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="w-full shrink-0 rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm"
      />
      <button
        type="button"
        onClick={() => {
          ask(q);
          showAnswer();
        }}
        disabled={busy || !q.trim()}
        className="w-full shrink-0 rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-800 disabled:bg-stone-300"
      >
        {busy ? "考えています…" : "コンパスくんに聞く"}
      </button>
    </section>
  );
}
