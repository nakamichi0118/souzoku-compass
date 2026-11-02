"use client";

import { kvGet, kvSet, useSession } from "./cloud";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { blankInterview, demoInterview, type Interview } from "@/domain/procedures/interview";
import { buildTasks } from "@/domain/procedures/rules";
import type { Account } from "./account";

const IV_KEY = "souzoku-compass:interview:v1";
const DONE_KEY = "souzoku-compass:done:v1";
const ACC_KEY = "souzoku-compass:account:v1";
const HEARD_KEY = "souzoku-compass:heard:v1";
const MEMO_KEY = "souzoku-compass:memo:v1";

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** デモでは、今日より前が期限の手続きと主な書類は済んだ状態から始める */
const demoDone = () => [
  ...buildTasks(demoInterview()).tasks.filter((t) => t.date < todayISO() && t.id !== "registration").map((t) => t.id),
  "doc:deathCert",
  "doc:kosekiDecedent",
  "doc:kosekiHeirs",
  "doc:juminhyoJokyo",
];

function read<T>(key: string, fallback: T): T {
  try {
    const raw = kvGet(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, v: unknown) {
  kvSet(key, v === null ? null : JSON.stringify(v));
}

export type ItemStatus = "open" | "done" | "na";
/** 「不要」にした手続き・書類は、記録の中で na: を付けて持つ */
export const naId = (id: string) => `na:${id}`;

interface PlanCtx {
  iv: Interview;
  saveIv: (iv: Interview) => void;
  /** 聞き取りを最後まで終えたか */
  heard: boolean;
  setHeard: (v: boolean) => void;
  done: string[];
  toggle: (id: string) => void;
  setDoneIds: (ids: string[], on: boolean) => void;
  /** 手続き・書類の状態：未・完了・不要 */
  statusOf: (id: string) => ItemStatus;
  setStatus: (id: string, s: ItemStatus) => void;
  /** 手続きごとのメモ（窓口の連絡先・担当者など） */
  memos: Record<string, string>;
  setMemo: (id: string, text: string) => void;
  account: Account | null;
  startDemo: () => void;
  signOut: () => void;
  loaded: boolean;
}

const Ctx = createContext<PlanCtx | null>(null);

/** 利用者・聞き取りの答え・済んだ手続きの記録（ログイン中はサーバーに保存。デモはこのブラウザの中だけ） */
export function PlanProvider({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const [iv, setIv] = useState<Interview>(demoInterview);
  const [done, setDone] = useState<string[]>([]);
  const [account, setAccount] = useState<Account | null>(null);
  const [heard, setHeardState] = useState(false);
  const [memos, setMemos] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!session.ready) return;
    // 記録がないときの初期値：デモは架空の家族、ログインした人は白紙から
    const demo = session.mode === "demo";
    setIv({ ...blankInterview(), ...read<Partial<Interview>>(IV_KEY, demo ? demoInterview() : blankInterview()) });
    setDone(read<string[] | null>(DONE_KEY, null) ?? (demo ? demoDone() : []));
    setAccount(read<Account | null>(ACC_KEY, null));
    setHeardState(read<boolean>(HEARD_KEY, false));
    setMemos(read<Record<string, string>>(MEMO_KEY, {}));
    setLoaded(true);
  }, [session.ready, session.mode]);

  const saveIv = useCallback((next: Interview) => {
    setIv(next);
    write(IV_KEY, next);
  }, []);
  const setHeard = useCallback((v: boolean) => {
    setHeardState(v);
    write(HEARD_KEY, v);
  }, []);
  const toggle = useCallback((id: string) => {
    setDone((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur.filter((x) => x !== naId(id)), id];
      write(DONE_KEY, next);
      return next;
    });
  }, []);
  const setDoneIds = useCallback((ids: string[], on: boolean) => {
    setDone((cur) => {
      const s = new Set(cur);
      for (const id of ids) {
        if (on) s.add(id);
        else s.delete(id);
      }
      const next = [...s];
      write(DONE_KEY, next);
      return next;
    });
  }, []);
  const statusOf = useCallback((id: string): ItemStatus => (done.includes(id) ? "done" : done.includes(naId(id)) ? "na" : "open"), [done]);
  const setStatus = useCallback((id: string, st: ItemStatus) => {
    setDone((cur) => {
      const next = cur.filter((x) => x !== id && x !== naId(id));
      if (st === "done") next.push(id);
      if (st === "na") next.push(naId(id));
      write(DONE_KEY, next);
      return next;
    });
  }, []);
  const setMemo = useCallback((id: string, text: string) => {
    setMemos((cur) => {
      const next = { ...cur };
      if (text.trim()) next[id] = text;
      else delete next[id];
      write(MEMO_KEY, next);
      return next;
    });
  }, []);
  const startDemo = useCallback(() => {
    const a: Account = { name: "相続 一郎", email: "demo@example.com", createdAt: new Date().toISOString(), demo: true };
    setAccount(a);
    write(ACC_KEY, a);
    const d = demoInterview();
    setIv(d);
    write(IV_KEY, d);
    const dd = demoDone();
    setDone(dd);
    write(DONE_KEY, dd);
    setHeardState(true);
    write(HEARD_KEY, true);
    const dm = { "bank-notice": "みほん銀行 さくら支店　相続センター 0120-000-000（平日9〜17時）\n担当：見本さん" };
    setMemos(dm);
    write(MEMO_KEY, dm);
  }, []);
  const { signOut: endSession } = session;
  const signOut = useCallback(() => {
    void endSession();
  }, [endSession]);

  return (
    <Ctx.Provider value={{ iv, saveIv, heard, setHeard, done, toggle, setDoneIds, statusOf, setStatus, memos, setMemo, account, startDemo, signOut, loaded }}>{children}</Ctx.Provider>
  );
}

export function usePlan() {
  const c = useContext(Ctx);
  if (!c) throw new Error("PlanProvider is missing");
  return c;
}
