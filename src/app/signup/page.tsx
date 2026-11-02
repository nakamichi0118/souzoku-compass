"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bubble, CompassKun, LogoMark } from "@/components/compass/CompassKun";
import { TextInput } from "@/components/ui";
import { usePlan } from "@/lib/planStore";
import { blankCase, useCase } from "@/lib/store";

export default function SignupPage() {
  const { register } = usePlan();
  const { replace } = useCase();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [agree, setAgree] = useState(false);
  const ok = name.trim().length > 0 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && agree;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ok) return;
    register({ name: name.trim(), email: email.trim(), createdAt: new Date().toISOString() });
    replace(blankCase());
    router.push("/my/hearing");
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
          <Bubble className="mb-4 flex-1">はじめまして、コンパスくんです。マイページを作って、一緒に進めていきましょう。</Bubble>
        </div>
        <form onSubmit={submit} className="mt-2 space-y-4 rounded-2xl border border-white bg-white/95 p-6 shadow-xl">
          <h1 className="text-xl font-bold text-sky-950">利用者登録</h1>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-stone-700">お名前（ニックネーム可）</span>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="例：相続 一郎" autoComplete="name" />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-stone-700">メールアドレス</span>
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="例：you@example.com" autoComplete="email" />
          </label>
          <label className="flex items-start gap-2 text-sm text-stone-700">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-4 w-4 accent-sky-700" />
            入力した内容は、この端末のブラウザにだけ保存されることを確認しました（ハッカソン用の簡易登録です）。PDFの作成・書類の読み取り・コンパスくんへの相談のときだけ、その機能に必要な内容を送ります（各画面で説明します）。
          </label>
          <button type="submit" disabled={!ok} className="w-full rounded-full bg-sky-700 px-6 py-3 font-bold text-white hover:bg-sky-800 disabled:bg-stone-300">
            マイページを作成する
          </button>
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
