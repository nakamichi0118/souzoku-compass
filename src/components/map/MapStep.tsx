"use client";

import Link from "next/link";
import { StepBar } from "@/components/StepBar";

export function MapStep() {
  return (
    <>
      <StepBar current="assets" />
      <main className="mx-auto max-w-6xl px-4 pt-20">
        <h1 className="text-2xl font-bold">地図で土地を選ぶ</h1>
        <p className="mt-2 text-stone-600">準備中です。</p>
        <Link href="/case/assets" className="mt-4 inline-block text-teal-800 underline">
          財産の入力に戻る
        </Link>
      </main>
    </>
  );
}
