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
  const [emailLeft, setEmailLeft] = useState(false);
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
          <CompassKun className="h-24 w-auto shrink-0" />
          <Bubble className="mb-4 min-w-0 flex-1">{signup ? "はじめまして！一緒に進めましょう。" : "おかえりなさい！"}</Bubble>
        </div>
        <form onSubmit={submit} className="mt-2 space-y-4 rounded-2xl border border-white bg-white/95 p-6 shadow-xl">
          {/* 試作版のあいだは、架空の内容で試してもらうことを見出しの横に短く出す */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h1 className="text-xl font-bold text-sky-950">{signup ? "利用者登録" : "ログイン"}</h1>
            {signup && <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-900">試作版・架空の内容でお試しください</span>}
          </div>
          {signup && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-stone-700">お名前（ニックネーム可）</span>
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="例：相続 一郎" autoComplete="name" />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-stone-700">メールアドレス</span>
            <TextInput
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmailLeft(true)}
              placeholder="例：you@example.com"
              autoComplete="email"
              aria-invalid={emailLeft && email !== "" && !emailOk}
            />
            {email !== "" && !emailOk && (emailLeft || email.includes("@")) && (
              <span role="alert" className="mt-1 block text-xs text-rose-700">
                正しいメールアドレスを入力してください（例：you@example.com）
              </span>
            )}
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-stone-700">パスワード</span>
            <TextInput type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={signup ? "new-password" : "current-password"} />
            {signup && <span className={`mt-1 block text-xs ${password && !pwOk ? "text-rose-700" : "text-stone-500"}`}>8文字以上・英字と数字を含む</span>}
          </label>
          {signup && (
            <label className="flex items-start gap-2 text-sm text-stone-700">
              <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-sky-700" />
              {/* リンクと文を1つにまとめる（分かれていると、スマホでは2つの列に分かれて読みにくい） */}
              <span className="min-w-0">
                <Link href="/privacy" target="_blank" className="text-sky-800 underline">
                  プライバシーポリシー
                </Link>
                に同意します
              </span>
            </label>
          )}
          {signup && !ok && (name || email || password) && (
            <p className="text-center text-xs text-stone-600">{missingHint(name, emailOk, pwOk, agree)}</p>
          )}
          {error && <p role="alert" className="break-words rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-900">{error}</p>}
          <button type="submit" disabled={!ok || busy} className="w-full rounded-full bg-sky-700 px-6 py-3 font-bold text-white hover:bg-sky-800 disabled:bg-stone-300">
            {busy ? "お待ちください…" : signup ? "マイページを作成する" : "ログイン"}
          </button>
          <p className="text-center text-sm text-stone-600">
            {signup ? (
              <Link href="/login" className="text-sky-800 underline">
                ログインはこちら
              </Link>
            ) : (
              <Link href="/signup" className="text-sky-800 underline">
                利用者登録はこちら
              </Link>
            )}
          </p>
          <p className="text-center text-sm">
            <Link href="/demo" className="text-sky-800 underline">
              デモを見る（架空の家族）
            </Link>
          </p>
        </form>
      </div>
    </main>
  );
}

/** 登録ボタンが押せないとき、何が足りないかを1行で示す */
export function missingHint(name: string, emailOk: boolean, pwOk: boolean, agree: boolean): string {
  const miss: string[] = [];
  if (!name.trim()) miss.push("お名前");
  if (!emailOk) miss.push("正しいメールアドレス");
  if (!pwOk) miss.push("パスワード");
  if (!agree) miss.push("同意のチェック");
  return `まだ足りないもの：${miss.join("、")}`;
}
