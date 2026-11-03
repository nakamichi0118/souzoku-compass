"use client";

import Link from "next/link";
import { useState } from "react";
import { Bubble, CompassKun, LogoMark } from "@/components/compass/CompassKun";
import { TextInput } from "@/components/ui";
import { useSession } from "@/lib/cloud";

/** 利用者登録とログインの画面 */
export function AuthForm({ kind }: { kind: "signup" | "login" }) {
  const { signedIn } = useSession();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signup = kind === "signup";
  const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  const pwOk = password.length >= 8 && /[A-Za-z]/.test(password) && /\d/.test(password);
  const ok = signup ? name.trim().length > 0 && emailOk && pwOk && agree : emailOk && password.length > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(signup ? "/api/auth/signup" : "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signup ? { name, email, password } : { email, password }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "うまくいきませんでした。");
      signedIn(signup ? "/my/hearing" : "/my", j.user?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-cover bg-bottom px-4 py-10" style={{ backgroundImage: "url(/brand/hero-background.png)" }}>
      <div className="mx-auto max-w-md">
        <Link href="/" className="flex items-center justify-center gap-2 text-xl font-bold text-sky-950">
          <LogoMark size={34} />
          相続コンパス
        </Link>
        <div className="mt-6 flex items-end gap-2">
          <CompassKun className="h-24 w-auto" />
          <Bubble className="mb-4 flex-1">{signup ? "はじめまして、コンパスくんです。マイページを作って、一緒に進めていきましょう。" : "おかえりなさい。続きから進めましょう。"}</Bubble>
        </div>
        <form onSubmit={submit} className="mt-2 space-y-4 rounded-2xl border border-white bg-white/95 p-6 shadow-xl">
          <h1 className="text-xl font-bold text-sky-950">{signup ? "利用者登録" : "ログイン"}</h1>
          {signup && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-stone-700">お名前（ニックネーム可）</span>
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="例：相続 一郎" autoComplete="name" />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-stone-700">メールアドレス</span>
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="例：you@example.com" autoComplete="email" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-stone-700">パスワード</span>
            <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={signup ? "new-password" : "current-password"} />
            {signup && <span className={`mt-1 block text-xs ${password && !pwOk ? "text-rose-700" : "text-stone-500"}`}>8文字以上で、英字と数字を両方入れてください。</span>}
          </label>
          {signup && (
            <label className="flex items-start gap-2 text-sm text-stone-700">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-4 w-4 accent-sky-700" />
              <Link href="/privacy" target="_blank" className="text-sky-800 underline">プライバシーポリシー</Link>に同意します。ハッカソン用の試作のため、架空の内容でお試しください。
            </label>
          )}
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>}
          <button type="submit" disabled={!ok || busy} className="w-full rounded-full bg-sky-700 px-6 py-3 font-bold text-white hover:bg-sky-800 disabled:bg-stone-300">
            {busy ? "お待ちください…" : signup ? "マイページを作成する" : "ログイン"}
          </button>
          <p className="text-center text-sm text-stone-600">
            {signup ? (
              <>
                登録済みの方は
                <Link href="/login" className="ml-1 text-sky-800 underline">
                  ログイン
                </Link>
              </>
            ) : (
              <>
                はじめての方は
                <Link href="/signup" className="ml-1 text-sky-800 underline">
                  利用者登録
                </Link>
              </>
            )}
          </p>
          <p className="text-center text-sm">
            <Link href="/demo" className="text-sky-800 underline">
              登録せずにデモ（架空の家族）を見る
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}
