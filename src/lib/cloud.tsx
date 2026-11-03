"use client";

/**
 * 利用者のデータの保存。ログインしていればサーバー（Firestore）が正本で、
 * ブラウザの保存領域は画面を速く出すための写しとしてだけ使う。
 *
 * - 開いたとき：ログイン中ならサーバーのデータを読み、写しを置き換えてから画面を出す。
 *   読めなかったときは古い写しのまま動かさず、「もう一度読み込む」画面を出す
 * - 書いたとき：写しに書き、少し待ってまとめてサーバーへ送る（閉じるときは残りをすぐ送る）
 * - ログアウト・デモへの切り替え：送っている途中の分と残りを送り終えてから写しを消す。送れなければ取りやめる
 * - デモ（架空の家族）はサーバーに送らず、このブラウザの中だけで動かす
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { authExpired, flushQueue, queueWrite, sendRestWithBeacon, setQueueEnabled } from "./saveQueue";
import { reportSaveFailure } from "./saveStatus";

export { isUnsaved } from "./saveQueue";

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
let demoSwitch: Promise<void> | null = null;
/** 開いたときの写しの持ち主（別のタブでログアウト・ログインしたら開き直すため） */
let loadedOwner: string | null | undefined;

function setMode(m: Mode) {
  mode = m;
  setQueueEnabled(m === "cloud");
}

function localKeys(): string[] {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(PREFIX));
  } catch {
    return [];
  }
}
function clearLocal() {
  try {
    for (const k of localKeys()) localStorage.removeItem(k);
  } catch {
    // 保存領域が使えないときは消すものもない
  }
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
  if (mode === "cloud") queueWrite(key, value);
}

/** 残っている書き込みをサーバーへ送る（送っている途中のものを待ってから）。届いたら true */
export function flush(): Promise<boolean> {
  return mode === "cloud" ? flushQueue() : Promise.resolve(true);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ログイン中の人を確かめる。通信の失敗は "error"（ログアウトとは区別する） */
async function fetchUser(): Promise<SessionUser | null | "error"> {
  for (let i = 0; i < 2; i++) {
    if (i) await sleep(1000);
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.ok) return ((await res.json()) as { user: SessionUser | null }).user ?? null;
    } catch {
      // 少し待って読み直す
    }
  }
  return "error";
}

/** サーバーのデータを読む。通信の失敗は少し待って数回まで読み直し、それでも読めなければ null */
async function fetchServerData(): Promise<Record<string, string> | null> {
  for (let i = 0; i < 3; i++) {
    if (i) await sleep(i * 1000);
    try {
      const res = await fetch("/api/me/data", { cache: "no-store" });
      if (res.ok) return ((await res.json()) as { kv?: Record<string, string> }).kv ?? {};
    } catch {
      // 少し待って読み直す
    }
  }
  return null;
}

type LoadFailure = "network" | "storage";

interface SessionCtx {
  user: SessionUser | null;
  mode: Mode;
  /** ログインの確認とサーバーのデータの読み込みが終わった */
  ready: boolean;
  /** ログイン・登録のあと：サーバーのデータで画面を開き直す */
  signedIn: (to: string) => void;
  /** 残りを保存してからログアウトする。保存できなければログアウトせず、保存できなかったことを知らせる */
  signOut: () => Promise<void>;
  /** デモ：ログアウトして、このブラウザの中だけで動かす（保存できなければ切り替えない） */
  enterDemo: () => Promise<void>;
}
const Ctx = createContext<SessionCtx | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ ready: boolean; user: SessionUser | null; mode: Mode; failed: LoadFailure | null }>({ ready: false, user: null, mode: "none", failed: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let off = false;
    (async () => {
      const owner = kvGet(MODE_KEY);
      const u = await fetchUser();
      let m: Mode = "none";
      let user: SessionUser | null = null;
      let failed: LoadFailure | null = null;
      if (u === "error") {
        // ログイン中だったかもしれないのに確かめられない：古い写しのまま動かさない
        if (owner?.startsWith("cloud:")) failed = "network";
        else if (owner === "demo") m = "demo";
      } else if (u) {
        const kv = await fetchServerData();
        if (kv) {
          try {
            clearLocal();
            for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
            // 画面の「利用者」はログイン中の人
            localStorage.setItem(`${PREFIX}account:v1`, JSON.stringify({ name: u.name, email: u.email, createdAt: u.createdAt }));
            localStorage.setItem(MODE_KEY, `cloud:${u.id}`);
            m = "cloud";
            user = u;
          } catch {
            failed = "storage";
          }
        } else {
          failed = "network";
        }
        if (failed && owner !== `cloud:${u.id}`) {
          // 写しが別の人（または前のデモ）のもの：この人の画面に出さないよう消す
          clearLocal();
          try {
            localStorage.removeItem(MODE_KEY);
          } catch {
            // 保存領域が使えない
          }
        }
      } else if (owner === "demo") {
        m = "demo";
      } else if (owner?.startsWith("cloud:")) {
        // ログインが切れた：前の人のデータの写しを残さない
        clearLocal();
        try {
          localStorage.removeItem(MODE_KEY);
        } catch {
          // 保存領域が使えない
        }
      }
      if (off) return;
      setMode(m);
      loadedOwner = failed ? undefined : kvGet(MODE_KEY);
      setState({ ready: !failed, user, mode: m, failed });
    })();
    return () => {
      off = true;
    };
  }, [attempt]);

  useEffect(() => {
    const onHide = () => sendRestWithBeacon();
    // 別のタブでログアウト・ログイン・デモへの切り替えがあったら、このタブも開き直す
    // （前の人の画面のまま、次の人のアカウントへ書き込まないため）
    const onStorage = (e: StorageEvent) => {
      if (e.key !== MODE_KEY && e.key !== null) return;
      if (loadedOwner !== undefined && kvGet(MODE_KEY) !== loadedOwner) window.location.reload();
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const signedIn = useCallback((to: string) => {
    window.location.href = to;
  }, []);
  const signOut = useCallback(async () => {
    if (mode === "cloud" && !(await flushQueue())) {
      // 送れなかった入力を消さないよう、ログアウトは取りやめる（書き出し・送り直しの案内を出す）
      reportSaveFailure(authExpired() ? "auth" : "leaving");
      return;
    }
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    setMode("none");
    clearLocal();
    try {
      localStorage.removeItem(MODE_KEY);
    } catch {
      // 保存領域が使えない
    }
    window.location.href = "/";
  }, []);
  const enterDemo = useCallback(() => {
    // 何度呼ばれても1回だけ切り替える（2回目の消去でデモのデータを消さないため）
    demoSwitch ??= (async () => {
      if (mode === "cloud") {
        if (!(await flushQueue())) {
          reportSaveFailure(authExpired() ? "auth" : "leaving");
          return;
        }
        await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
      }
      setMode("demo");
      clearLocal();
      try {
        localStorage.setItem(MODE_KEY, "demo");
      } catch {
        // 保存領域が使えなくても、この画面の中だけで動かす
      }
      loadedOwner = kvGet(MODE_KEY);
      setState({ ready: true, user: null, mode: "demo", failed: null });
    })().finally(() => (demoSwitch = null));
    return demoSwitch;
  }, []);

  const retry = useCallback(() => {
    setState((s) => ({ ...s, failed: null }));
    setAttempt((n) => n + 1);
  }, []);

  if (state.failed) return <LoadFailed reason={state.failed} onRetry={retry} />;

  // 画面のデータ（聞き取り・財産など）は、ready と mode が変わったときに読み直す
  return <Ctx.Provider value={{ user: state.user, mode: state.mode, ready: state.ready, signedIn, signOut, enterDemo }}>{children}</Ctx.Provider>;
}

/** ログイン中の人のデータを読めなかったとき：古い写しのまま入力させず、読み直してもらう */
function LoadFailed({ reason, onRetry }: { reason: LoadFailure; onRetry: () => void }) {
  return (
    <main className="min-h-screen bg-stone-50 px-4 py-24">
      <div role="alert" className="mx-auto max-w-md rounded-xl border border-rose-300 bg-white p-6 text-center text-stone-800 shadow">
        <p className="text-lg font-bold">データを読み込めませんでした</p>
        <p className="mt-3 text-left text-sm text-stone-600">
          {reason === "storage"
            ? "このブラウザに、入力内容の写しを置けませんでした。プライベートブラウズ（シークレットモード）を終えるか、別のブラウザでお試しください。"
            : "通信が切れているか、サーバーが混み合っている可能性があります。少し待ってから、もう一度読み込んでください。"}
        </p>
        <p className="mt-2 text-left text-xs text-stone-500">古いデータのまま入力すると、あとで消えてしまうおそれがあるため、読み込めるまで入力はできません。</p>
        <button type="button" onClick={onRetry} className="mt-5 rounded-lg bg-teal-700 px-5 py-2 font-semibold text-white hover:bg-teal-800">
          もう一度読み込む
        </button>
      </div>
    </main>
  );
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error("SessionProvider is missing");
  return c;
}
