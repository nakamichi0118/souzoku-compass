"use client";

/**
 * 利用者のデータの保存。ログインしていればサーバー（Firestore）が正本で、
 * ブラウザの保存領域は画面を速く出すための写しとしてだけ使う。
 *
 * - 開いたとき：ログイン中ならサーバーのデータを読み、写しを置き換えてから画面を出す
 * - 書いたとき：写しに書き、少し待ってまとめてサーバーへ送る（閉じるときは残りをすぐ送る）
 * - デモ（架空の家族）はサーバーに送らず、このブラウザの中だけで動かす
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { reportSaveFailure } from "./saveStatus";

export const PREFIX = "souzoku-compass:";
const MODE_KEY = "souzoku-compass-mode"; // 写しの持ち主（サーバーへは送らない）

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}
type Mode = "cloud" | "demo" | "none";

let mode: Mode = "none";
const pending = { set: new Map<string, string>(), del: new Set<string>() };
let timer: ReturnType<typeof setTimeout> | null = null;
let demoSwitch: Promise<void> | null = null;

function localKeys(): string[] {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
  } catch {
    return [];
  }
}
function clearLocal() {
  for (const k of localKeys()) localStorage.removeItem(k);
}

function body() {
  const b = { set: Object.fromEntries(pending.set), del: [...pending.del] };
  pending.set.clear();
  pending.del.clear();
  return JSON.stringify(b);
}

async function flush() {
  timer = null;
  if (mode !== "cloud" || (pending.set.size === 0 && pending.del.size === 0)) return;
  const b = body();
  try {
    const res = await fetch("/api/me/data", { method: "PUT", headers: { "content-type": "application/json" }, body: b });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    // 送れなかった分は戻して次の書き込みで送り直す
    const back = JSON.parse(b) as { set: Record<string, string>; del: string[] };
    for (const [k, v] of Object.entries(back.set)) if (!pending.set.has(k)) pending.set.set(k, v);
    for (const k of back.del) pending.del.add(k);
    reportSaveFailure();
  }
}

function schedule() {
  if (mode !== "cloud") return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, 800);
}

export function kvGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 保存する（null で消す） */
export function kvSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    if (mode !== "cloud") reportSaveFailure();
  }
  if (mode !== "cloud") return;
  if (value === null) {
    pending.set.delete(key);
    pending.del.add(key);
  } else {
    pending.del.delete(key);
    pending.set.set(key, value);
  }
  schedule();
}

interface SessionCtx {
  user: SessionUser | null;
  mode: Mode;
  /** ログインの確認とサーバーのデータの読み込みが終わった */
  ready: boolean;
  /** ログイン・登録のあと：サーバーのデータで画面を開き直す */
  signedIn: (to: string) => void;
  signOut: () => Promise<void>;
  /** デモ：ログアウトして、このブラウザの中だけで動かす */
  enterDemo: () => Promise<void>;
}
const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ ready: boolean; user: SessionUser | null; mode: Mode }>({ ready: false, user: null, mode: "none" });

  useEffect(() => {
    let off = false;
    (async () => {
      let user: SessionUser | null = null;
      try {
        user = ((await (await fetch("/api/auth/me", { cache: "no-store" })).json()) as { user: SessionUser | null }).user;
      } catch {
        user = null;
      }
      let m: Mode = "none";
      if (user) {
        try {
          const res = await fetch("/api/me/data", { cache: "no-store" });
          if (!res.ok) throw new Error(String(res.status));
          const { kv } = (await res.json()) as { kv: Record<string, string> };
          clearLocal();
          for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
          // 画面の「利用者」はログイン中の人
          localStorage.setItem(`${PREFIX}account:v1`, JSON.stringify({ name: user.name, email: user.email, createdAt: user.createdAt }));
          localStorage.setItem(MODE_KEY, `cloud:${user.id}`);
          m = "cloud";
        } catch {
          reportSaveFailure();
        }
      } else if (kvGet(MODE_KEY) === "demo") {
        m = "demo";
      } else if (kvGet(MODE_KEY)?.startsWith("cloud:")) {
        // ログインが切れた：前の人のデータの写しを残さない
        clearLocal();
        localStorage.removeItem(MODE_KEY);
      }
      mode = m;
      if (!off) setState({ ready: true, user: m === "cloud" ? user : null, mode: m });
    })();
    const onHide = () => {
      if (mode !== "cloud" || (pending.set.size === 0 && pending.del.size === 0)) return;
      navigator.sendBeacon?.("/api/me/data", new Blob([body()], { type: "application/json" }));
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      off = true;
      window.removeEventListener("pagehide", onHide);
    };
  }, []);

  const signedIn = useCallback((to: string) => {
    window.location.href = to;
  }, []);
  const signOut = useCallback(async () => {
    await flush();
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    mode = "none";
    clearLocal();
    localStorage.removeItem(MODE_KEY);
    window.location.href = "/";
  }, []);
  const enterDemo = useCallback(() => {
    // 何度呼ばれても1回だけ切り替える（2回目の消去でデモのデータを消さないため）
    demoSwitch ??= (async () => {
      if (mode === "cloud") {
        await flush();
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
      }
      mode = "demo";
      clearLocal();
      localStorage.setItem(MODE_KEY, "demo");
      setState({ ready: true, user: null, mode: "demo" });
    })().finally(() => (demoSwitch = null));
    return demoSwitch;
  }, []);

  // 画面のデータ（聞き取り・財産など）は、ready と mode が変わったときに読み直す
  return <Ctx.Provider value={{ user: state.user, mode: state.mode, ready: state.ready, signedIn, signOut, enterDemo }}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error("SessionProvider is missing");
  return c;
}
