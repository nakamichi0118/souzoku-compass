"use client";
/**
 * 右下のコンパスくんチャットの中身。
 * やりとりは画面を移っても続くよう、ここ（モジュール）で持つ。画面ごとの話題（step と案件の要約）は、
 * 各画面が useCompassTopic で知らせる（いちばん新しく開いた画面のものを使う）。
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { Faq } from "@/components/compass/faq";

export type ChatMsg = {
  role: "user" | "assistant";
  text: string;
  /** コンパスくんが答え終えた（「解決できましたか？」を出す） */
  resolved?: boolean;
  /** 画面の中だけの返事（エラー・お礼など）。Claude には送らない */
  local?: boolean;
};
export type Feedback = "yes" | "no" | "consult";
export type Topic = { step: string; context: () => string; placeholder?: string };

type State = { msgs: ChatMsg[]; busy: boolean; open: boolean; feedback: Record<number, Feedback> };
let state: State = { msgs: [], busy: false, open: false, feedback: {} };
const listeners = new Set<() => void>();
const set = (p: Partial<State>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useChat() {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

const topics: { current: Topic }[] = [];
const topicListeners = new Set<() => void>();
export const currentTopic = (): Topic | null => topics[topics.length - 1]?.current ?? null;

/** 画面の話題をチャットに知らせる（その画面を開いている間だけ） */
export function useCompassTopic(step: string, context: () => string, placeholder?: string) {
  const entry = useRef<{ current: Topic }>({ current: { step, context, placeholder } });
  entry.current.current = { step, context, placeholder };
  useEffect(() => {
    const e = entry.current;
    topics.push(e);
    topicListeners.forEach((l) => l());
    return () => {
      const i = topics.indexOf(e);
      if (i >= 0) topics.splice(i, 1);
      topicListeners.forEach((l) => l());
    };
  }, []);
}

/** いまの画面の step（想定質問を選ぶため）。画面が知らせていなければ null */
export function useTopicStep(): string | null {
  return useSyncExternalStore(
    (l) => {
      topicListeners.add(l);
      return () => topicListeners.delete(l);
    },
    () => currentTopic()?.step ?? null,
    () => null,
  );
}

export const openChat = (open = true) => set({ open });

/** Claude に送るやりとり（画面の中だけの返事は除き、直近の分だけ） */
export function historyOf(msgs: ChatMsg[]): { role: "user" | "assistant"; text: string }[] {
  return msgs
    .filter((m) => !m.local && m.text.trim())
    .slice(-10)
    .map((m) => ({ role: m.role, text: m.text.slice(0, 4000) }));
}

let req = 0;
/** 自由な質問：Claude に送る */
export async function sendQuestion(question: string, topic: Topic) {
  const q = question.trim();
  if (!q || state.busy) return;
  const id = ++req;
  const history = historyOf(state.msgs);
  set({ msgs: [...state.msgs, { role: "user", text: q }], busy: true });
  let reply: ChatMsg;
  try {
    const res = await fetch("/api/assist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step: topic.step, question: q.slice(0, 2000), context: topic.context().slice(0, 6000), history }),
    });
    const json = await res.json().catch(() => ({}));
    reply = json.answer
      ? { role: "assistant", text: json.answer, resolved: json.resolved === true }
      : { role: "assistant", text: json.error ?? "うまく答えられませんでした。", local: true };
  } catch {
    reply = { role: "assistant", text: "通信に失敗しました。時間をおいてお試しください。", local: true };
  }
  if (id !== req) return;
  set({ msgs: [...state.msgs, reply], busy: false });
}

/** 想定質問：用意した回答をすぐ出す（AI には送らない） */
export function pickFaq(f: Faq) {
  if (state.busy) return;
  set({ msgs: [...state.msgs, { role: "user", text: f.q }, { role: "assistant", text: f.a, resolved: true }] });
}

export const THANKS = "よかったです。ほかにも気になることがあれば、いつでも聞いてくださいね。";
export const RETRY = "すみません。どこが分かりにくかったか、もう少し詳しく教えてください。";

/** 「解決できましたか？」への答え。相談するときは、聞いた質問を相談内容の下書きに残す */
export function answerFeedback(index: number, f: Feedback) {
  const feedback = { ...state.feedback, [index]: f };
  if (f === "consult") {
    saveConsultDraft(state.msgs);
    set({ feedback, open: false });
    return;
  }
  set({ feedback, msgs: [...state.msgs, { role: "assistant", text: f === "yes" ? THANKS : RETRY, local: true }] });
}

export function resetChat() {
  req++;
  set({ msgs: [], busy: false, feedback: {} });
}

export const CONSULT_DRAFT_KEY = "souzoku-compass:consult-draft";

/** 相談内容の頭に入れる、コンパスくんに聞いたこと */
export function consultDraft(msgs: ChatMsg[]): string {
  const qs = msgs.filter((m) => m.role === "user").map((m) => `・${m.text.replace(/\s+/g, " ").slice(0, 300)}`);
  return qs.length ? `コンパスくんに聞いたこと：\n${qs.slice(-5).join("\n")}` : "";
}

function saveConsultDraft(msgs: ChatMsg[]) {
  try {
    sessionStorage.setItem(CONSULT_DRAFT_KEY, consultDraft(msgs));
  } catch {
    /* 下書きを残せなくても、相談の画面には移れる */
  }
}

/** 相談フォームに入れる、チャットからの下書き（送ったら clearConsultDraft で消す） */
export function peekConsultDraft(): string {
  try {
    return sessionStorage.getItem(CONSULT_DRAFT_KEY) ?? "";
  } catch {
    return "";
  }
}
export function clearConsultDraft() {
  try {
    sessionStorage.removeItem(CONSULT_DRAFT_KEY);
  } catch {
    /* 消せなくても困らない */
  }
}

/** いちばん最後のコンパスくんの返事で、まだ「解決できましたか？」に答えていなければ、その番号 */
export function askFeedbackAt(s: Pick<State, "msgs" | "feedback" | "busy">): number | null {
  if (s.busy) return null;
  const i = s.msgs.length - 1;
  const m = s.msgs[i];
  return m && m.role === "assistant" && m.resolved && !m.local && !s.feedback[i] ? i : null;
}
