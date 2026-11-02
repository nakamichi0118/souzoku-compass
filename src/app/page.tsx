import Link from "next/link";

const STEPS = ["亡くなった方", "相続人", "財産", "債務・葬式費用", "遺産の分け方", "税額の確認", "書類の作成"];

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-14">
      <p className="text-sm font-semibold text-teal-700">相続税の申告を、自分の手で。</p>
      <h1 className="mt-2 text-4xl font-bold leading-tight text-stone-900">相続コンパス</h1>
      <p className="mt-4 text-lg leading-relaxed text-stone-700">
        家族の関係と財産を順番に入力するだけで、相続人と法定相続分を判定し、相続税を計算して、国税庁の
        <strong>令和8年分の正式な申告書様式</strong>に記入したPDFを作ります。わからない言葉や書類の読み方は、Claudeがその場で説明します。
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/case/decedent" className="rounded-lg bg-teal-700 px-6 py-3 font-semibold text-white hover:bg-teal-800">
          はじめる（デモ案件入り）
        </Link>
        <Link href="/case/tax" className="rounded-lg border border-stone-300 bg-white px-6 py-3 font-semibold text-stone-800 hover:bg-stone-50">
          デモの計算結果を見る
        </Link>
      </div>
      <ol className="mt-12 grid gap-3 sm:grid-cols-7">
        {STEPS.map((s, i) => (
          <li key={s} className="rounded-lg border border-stone-200 bg-white p-3 text-center text-sm">
            <span className="block text-xs font-bold text-teal-700">STEP {i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          ["税額は決まった計算式で", "相続税法・財産評価基本通達に沿った計算エンジンが計算します。AIは計算に関与しないので、同じ入力なら必ず同じ結果です。"],
          ["Claudeが案内と入力を手伝う", "専門用語の説明、残高証明書などの書類の読み取り、計算結果の説明をClaudeが担当します。"],
          ["自動で完結できないものは正直に", "国外財産・非居住者・納税猶予・非上場株式の評価などは、税理士への相談をおすすめします。"],
        ].map(([t, d]) => (
          <div key={t} className="rounded-xl border border-stone-200 bg-white p-5">
            <h2 className="font-bold text-stone-900">{t}</h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">{d}</p>
          </div>
        ))}
      </section>
      <p className="mt-12 text-xs text-stone-500">
        デモ案件はすべて架空のダミーデータです。申告書様式の出典：国税庁「相続税の申告書等の様式一覧（令和8年分用）」を加工して作成。
      </p>
    </main>
  );
}
