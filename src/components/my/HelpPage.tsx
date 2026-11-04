"use client";

import Link from "next/link";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { HELP, HELP_FLOW } from "@/data/help";

/** ヘルプ：進め方と、画面ごとの使い方 */
export function HelpPage() {
  return (
    <AppShell>
      <PageHead title="ヘルプ" say="困ったときは、ここを見てくださいね。" />
      <section className="rounded-2xl border border-sky-100 bg-white p-5">
        <h2 className="font-bold text-sky-950">進め方</h2>
        <ol className="mt-3 grid gap-3 sm:grid-cols-4">
          {HELP_FLOW.map((f, i) => (
            <li key={f.title} className="rounded-xl bg-sky-50/70 p-3">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-sky-700 text-sm font-bold text-white">{i + 1}</span>
              <p className="mt-2 font-semibold text-stone-900">{f.title}</p>
              <p className="text-sm text-stone-600">{f.text}</p>
            </li>
          ))}
        </ol>
        <Link href="/my?guide=1" className="mt-4 inline-block text-sm font-semibold text-sky-800 hover:underline">
          操作ガイドをもう一度見る ›
        </Link>
      </section>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {HELP.map((h) => (
          <section key={h.id} id={h.id} className="scroll-mt-28 rounded-2xl border border-stone-200 bg-white p-5">
            <h2 className="font-bold text-sky-950">{h.title}</h2>
            <p className="mt-1 text-sm text-stone-700">{h.what}</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-stone-700">
              {h.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="mt-5 text-sm text-stone-600">
        それでも分からないときは、各画面の「コンパスくんに相談」で聞くか、
        <Link href="/my/consult" className="font-semibold text-sky-800 underline">
          税理士に相談
        </Link>
        できます。
      </p>
    </AppShell>
  );
}
