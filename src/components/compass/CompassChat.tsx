"use client";

import { RotateCcw, Send, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CONSULT_FIRM } from "@/data/consultFirm";
import {
  answerFeedback,
  askFeedbackAt,
  currentTopic,
  openChat,
  pickFaq,
  resetChat,
  sendQuestion,
  useChat,
  useTopicStep,
  type Topic,
} from "@/lib/compassChat";
import { useCaseOptional } from "@/lib/store";
import { summarizeForAssistant } from "@/lib/summary";
import { Bubble, CompassAvatar } from "./CompassKun";
import { FAQS } from "./faq";
import { Markdown } from "./Markdown";

/** 「いつでも聞いてくださいね」を閉じた・チャットを開いた（このタブを閉じるまで出さない） */
const HELLO_KEY = "souzoku-compass:chat-hello-seen";
const helloSeen = () => {
  try {
    return sessionStorage.getItem(HELLO_KEY) === "1";
  } catch {
    return false;
  }
};
const markHello = () => {
  try {
    sessionStorage.setItem(HELLO_KEY, "1");
  } catch {
    /* 覚えられなくても、この画面の中では閉じたまま */
  }
};

/** 画面の場所から、想定質問を選ぶための step を決める（画面が知らせていないとき） */
export function stepFromPath(path: string): string {
  if (path.startsWith("/case/")) return path.split("/")[2] || "home";
  if (path.startsWith("/my/tasks")) return "tasks";
  if (path.startsWith("/my/docs")) return "docs";
  return "home";
}

/**
 * 右下のコンパスくん。押すとチャットが開く。
 * スマホでは画面いっぱい、パソコンでは右下の窓（後ろの画面を見ながら聞ける）。
 */
export function CompassChat() {
  const path = usePathname() ?? "/";
  const router = useRouter();
  const { msgs, busy, open, feedback } = useChat();
  const topicStep = useTopicStep();
  const kase = useCaseOptional();
  const step = topicStep ?? stepFromPath(path);
  const topic = useCallback((): Topic => currentTopic() ?? { step, context: () => (kase ? summarizeForAssistant(kase.data, kase.result) : "") }, [step, kase]);
  const [q, setQ] = useState("");
  const [hello, setHello] = useState(false);
  useEffect(() => setHello(!helloSeen()), []);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 新しい発言が出たら、いちばん下まで送る
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, busy, open]);
  // Esc で閉じる
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && openChat(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  // スマホで画面いっぱいに開いている間は、後ろの画面を動かさない
  useEffect(() => {
    if (!open || window.matchMedia("(min-width: 640px)").matches) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const show = () => {
    markHello();
    setHello(false);
    openChat(true);
  };
  const send = () => {
    if (!q.trim() || busy) return;
    void sendQuestion(q, topic());
    setQ("");
  };
  const faqs = FAQS[step] ?? [];
  const fbAt = askFeedbackAt({ msgs, feedback, busy });
  const placeholder = currentTopic()?.placeholder ?? "質問を入力";

  return (
    <>
      {!open && (
        <div className="compass-fab fixed right-4 z-40 flex items-end gap-2 print:hidden" style={{ bottom: "calc(1rem + var(--fab-lift, 0px))" }}>
          {hello && (
            <div className="relative mb-2 whitespace-nowrap rounded-2xl border border-sky-100 bg-white py-2 pl-3 pr-7 text-sm text-stone-800 shadow-lg">
              <button type="button" onClick={show} className="text-left">
                いつでも聞いてくださいね。
              </button>
              <button
                type="button"
                aria-label="閉じる"
                onClick={() => {
                  markHello();
                  setHello(false);
                }}
                className="absolute right-1 top-1 rounded p-1 text-stone-400 hover:text-stone-700"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
              <span className="absolute -right-1.5 bottom-4 h-3 w-3 rotate-45 border-r border-t border-sky-100 bg-white" aria-hidden />
            </div>
          )}
          <button
            type="button"
            onClick={show}
            aria-label="コンパスくんに聞く"
            className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full bg-white shadow-lg ring-2 ring-sky-200 transition hover:scale-105 hover:ring-sky-400"
          >
            <CompassAvatar size={60} />
            {busy && <span className="absolute right-0 top-0 h-3.5 w-3.5 animate-pulse rounded-full border-2 border-white bg-orange-500" aria-hidden />}
          </button>
        </div>
      )}
      {open && (
        <div
          role="dialog"
          aria-label="コンパスくんに相談"
          className="fixed inset-0 z-50 flex flex-col bg-white sm:inset-auto sm:bottom-4 sm:right-4 sm:h-[min(640px,calc(100dvh-6rem))] sm:w-[400px] sm:overflow-hidden sm:rounded-2xl sm:border sm:border-sky-200 sm:shadow-2xl print:hidden"
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-sky-100 bg-gradient-to-r from-sky-50 to-emerald-50/60 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:pt-2">
            <CompassAvatar size={36} />
            <p className="min-w-0 flex-1 font-bold text-sky-900">コンパスくんに相談</p>
            {msgs.length > 0 && (
              <button type="button" onClick={resetChat} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-stone-600 hover:bg-white">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                最初から
              </button>
            )}
            <button type="button" onClick={() => openChat(false)} aria-label="閉じる" className="rounded-lg p-2 text-stone-500 hover:bg-white hover:text-stone-800">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>

          <div ref={bodyRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-sky-50/40 px-3 py-3" aria-live="polite">
            <div className="flex items-start gap-2">
              <CompassAvatar size={32} />
              <Bubble className="min-w-0 flex-1">いつでも聞いてくださいね。この画面のことも、手続きのことも答えます。</Bubble>
            </div>
            {msgs.length === 0 && faqs.length > 0 && (
              <div className="flex flex-wrap gap-2 pl-10">
                {faqs.map((f) => (
                  <button key={f.q} type="button" onClick={() => pickFaq(f)} className="rounded-full border border-sky-200 bg-white px-3 py-1 text-left text-sm text-sky-900 hover:bg-sky-50">
                    {f.q}
                  </button>
                ))}
              </div>
            )}
            {msgs.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-tr-sm bg-sky-700 px-3 py-2 text-sm text-white">{m.text}</p>
                </div>
              ) : (
                <div key={i} className="flex items-start gap-2">
                  <CompassAvatar size={32} />
                  <Bubble className="min-w-0 flex-1">
                    <div className="text-sm text-stone-800">
                      <Markdown text={m.text} />
                    </div>
                  </Bubble>
                </div>
              ),
            )}
            {busy && (
              <div className="flex items-center gap-2 text-sm text-stone-600">
                <CompassAvatar size={32} thinking="blink" />
                ちょっと調べています…
              </div>
            )}
            {fbAt !== null && (
              <div className="ml-10 rounded-xl border border-sky-100 bg-white p-3">
                <p className="text-sm font-semibold text-stone-800">このチャットで解決できましたか？</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => answerFeedback(fbAt, "yes")} className="rounded-lg bg-sky-700 px-4 py-1.5 text-sm font-semibold text-white hover:bg-sky-800">
                    はい
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      answerFeedback(fbAt, "no");
                      inputRef.current?.focus();
                    }}
                    className="rounded-lg border border-stone-300 px-4 py-1.5 text-sm hover:bg-stone-50"
                  >
                    いいえ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      answerFeedback(fbAt, "consult");
                      router.push("/my/consult");
                    }}
                    className="rounded-lg border border-brand px-3 py-1.5 text-sm font-semibold text-brand hover:bg-brand-soft"
                  >
                    {CONSULT_FIRM.name}に相談する
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-end gap-2 border-t border-sky-100 bg-white px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
            {/* 文字は 16px（iPhone で入力するときに画面が拡大されないように） */}
            <textarea
              ref={inputRef}
              rows={2}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={placeholder}
              aria-label="コンパスくんへの質問"
              className="min-w-0 flex-1 resize-none rounded-lg border border-stone-300 bg-white px-3 py-2 text-base sm:text-sm"
            />
            <button
              type="button"
              onClick={send}
              disabled={busy || !q.trim()}
              aria-label="送る"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-sky-700 text-white hover:bg-sky-800 disabled:bg-stone-300"
            >
              <Send className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
