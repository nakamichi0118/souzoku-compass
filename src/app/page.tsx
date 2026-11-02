/* eslint-disable @next/next/no-img-element */
import Link from "next/link";
import { Bubble, CompassKun } from "@/components/compass/CompassKun";
import { HeaderCta } from "@/components/HeaderCta";
import { SiteHeader } from "@/components/SiteHeader";

const HOW = [
  { title: "はじめる", text: "お名前とメールアドレスだけの簡単な登録で、あなたのマイページを作ります。" },
  { title: "質問に答える", text: "家族構成や財産のおおよその額など、約3分の質問に答えます。" },
  { title: "やることが分かる", text: "必要な手続き・期限・提出先・集める書類がマイページに並びます。相続税がかかるかも分かります。" },
  { title: "書類を作る", text: "財産を評価して、相続税申告書・遺産分割協議書・登記申請書のPDFを作ります。" },
];

const FLOW = ["聞き取り", "相続税の判定", "手続き", "書類集め", "申告書"];

const FEATURES = [
  { img: "/brand/feature-progress.png", title: "やることが期限順に分かる", text: "死亡届から相続登記まで、あなたの家族に必要な手続きだけを期限つきで。カレンダーにもまとめて入ります。" },
  { img: "/brand/feature-property.png", title: "土地・マンションの評価", text: "地図をクリックすると国税庁の路線価図を重ねて表示。小規模宅地等の特例も自動で計算します。" },
  { img: "/brand/feature-filing.png", title: "正式な申告書を作成", text: "国税庁の令和8年分の正式な様式に記入した相続税申告書と、遺産分割協議書のPDFを作ります。" },
];

export default function Home() {
  return (
    <>
      <SiteHeader />
      <section className="relative overflow-hidden bg-cover bg-bottom" style={{ backgroundImage: "url(/brand/hero-background.png)" }}>
        <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 md:grid-cols-[1.1fr_0.9fr] md:py-16">
          <div>
            <p className="inline-block rounded-full bg-sky-100 px-4 py-1.5 text-sm font-bold text-sky-900">相続の手続きを、自分で進められる</p>
            <h1 className="mt-5 text-4xl font-black leading-tight tracking-tight text-sky-950 sm:text-5xl">
              相続の手続きを、
              <br />
              迷わず
              <span className="relative inline-block">
                自分で
                <span className="absolute inset-x-0 -bottom-1 h-2 rounded-full bg-emerald-400/70" aria-hidden />
              </span>
              。
            </h1>
            <p className="mt-5 text-base leading-relaxed text-stone-700 sm:text-lg">
              何から手をつければいいか分からない。相続税はかかるの？
              <br />
              いくつかの質問に答えるだけで、必要な手続き・集める書類・提出先がわかり、申告書の完成まで進めます。
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <HeaderCta big />
              <Link href="/demo" className="rounded-full border-2 border-sky-700 bg-white px-7 py-3 font-bold text-sky-800 hover:bg-sky-50">
                ▶ デモを見る
              </Link>
            </div>
          </div>
          <div className="relative">
            <div className="rounded-2xl border border-white bg-white/90 p-4 shadow-xl backdrop-blur">
              <div className="mb-3 flex gap-1.5" aria-hidden>
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
              </div>
              <ol className="flex items-start justify-between">
                {FLOW.map((f, i) => (
                  <li key={f} className="flex flex-1 flex-col items-center gap-1 text-center">
                    <span className={`grid h-8 w-8 place-items-center rounded-full text-sm font-bold ${i === 0 ? "bg-emerald-500 text-white" : i === 1 ? "bg-sky-700 text-white" : "border-2 border-stone-300 text-stone-500"}`}>
                      {i === 0 ? "✓" : i + 1}
                    </span>
                    <span className={`text-[11px] ${i === 1 ? "font-bold text-sky-800" : "text-stone-600"}`}>{f}</span>
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex items-end gap-2 rounded-xl bg-gradient-to-b from-emerald-50 to-sky-50 p-3">
                <CompassKun className="h-28 w-auto" />
                <div className="mb-6 flex-1">
                  <p className="mb-1 text-sm font-bold text-sky-950">コンパスくんがご案内</p>
                  <Bubble>相続税がかかるか、まずは家族の人数から確かめましょう。</Bubble>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="scroll-mt-20 py-12">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-center text-2xl font-bold text-sky-950">使い方はかんたん</h2>
          <ol className="mt-6 grid gap-4 md:grid-cols-4">
            {HOW.map((h, i) => (
              <li key={h.title} className="relative rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-sky-700 font-bold text-white">{i + 1}</span>
                <h3 className="mt-3 font-bold text-sky-950">{h.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-stone-600">{h.text}</p>
              </li>
            ))}
          </ol>
          <p className="mt-5 text-center text-sm text-stone-600">
            まずは雰囲気を見たい方は{" "}
            <Link href="/demo" className="font-semibold text-sky-800 underline">
              デモの家族（すべて架空）でマイページを見る
            </Link>
          </p>
        </div>
      </section>

      <section id="features" className="scroll-mt-20 bg-white py-12">
        <div className="mx-auto grid max-w-6xl gap-5 px-4 md:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-sky-100 bg-white p-5 text-center shadow-sm">
              <img src={f.img} alt="" className="mx-auto h-20 w-auto object-contain" />
              <h3 className="mt-3 text-lg font-bold text-sky-950">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{f.text}</p>
            </div>
          ))}
        </div>
        <div className="mx-auto mt-8 max-w-6xl px-4">
          <div className="rounded-full bg-sky-50 px-6 py-4 text-center text-base font-bold text-sky-950">
            むずかしいケース（借金が多い・国外財産・非上場株式・遺産分割で争いがある など）は、税理士・弁護士への相談をおすすめします
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-4 py-8 text-xs leading-relaxed text-stone-500">
        デモはすべて架空のダミーデータです。申告書様式の出典：国税庁「相続税の申告書等の様式一覧（令和8年分用）」を加工して作成。手続きの内容は一般的な案内で、自治体や窓口によって異なる場合があります。
      </footer>
    </>
  );
}
