import Link from "next/link";
import { LogoMark } from "@/components/compass/CompassKun";

export const metadata = { title: "利用規約｜相続コンパス" };

/** 利用規約（ハッカソンの試作版。商用化の前に弁護士の確認を受ける） */
const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: "1. 相続コンパスの役割",
    p: [
      "相続コンパスは、利用者ご本人が相続の手続きを進め、相続税の申告書を作るための道具（ソフトウェア）です。利用者は、このシステムを利用する権利を得るものであり、運営者が利用者の代わりに申告書を作ったり、税務の相談に応じたりするものではありません。",
      "相続コンパスは税理士による確認の代わりにはなりません。判断が分かれる項目は、画面で税理士への相談をおすすめします。",
    ],
  },
  {
    h: "2. 利用者の責任",
    p: [
      "財産・債務などの入力内容が正しく、漏れがないことの確認は、利用者ご本人が行ってください。",
      "作った申告書の内容を確かめ、提出するかどうかを決めるのは利用者ご本人です。申告内容についての最終的な責任は、申告をする利用者ご本人にあります。",
      "「分からない」と答えた項目や、相談をおすすめした項目が残っているときは、申告書に「下書き」と入ります。そのまま提出しないでください。",
    ],
  },
  {
    h: "3. 運営者の責任",
    p: [
      "運営者は、計算の仕組みが法令と国税庁の公表する様式・通達に沿うよう努めますが、すべての相続にあてはまることを保証するものではありません。",
      "運営者の故意または重大な過失による場合を除き、相続コンパスの利用によって生じた損害（加算税・延滞税などを含みます）について、運営者は責任を負いません。",
    ],
  },
  {
    h: "4. AI（コンパスくん）について",
    p: ["コンパスくんの説明や聞き取りは、手続きを進める手助けです。税額や評価額は、アプリの決まった計算で求めます。AIの回答に誤りがある場合があるため、大切な判断は税理士にご確認ください。"],
  },
  {
    h: "5. その他",
    p: [
      "相続コンパスは「Built with Claude: Japan 2026」ハッカソンの試作です。実在の方の情報ではなく、架空の内容でお試しください。",
      "個人情報の取り扱いは、プライバシーポリシーをご覧ください。",
    ],
  },
];

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="flex items-center gap-2 text-lg font-bold text-sky-950">
        <LogoMark size={30} />
        相続コンパス
      </Link>
      <h1 className="mt-6 text-2xl font-bold text-stone-900">利用規約</h1>
      <div className="mt-6 space-y-6 text-sm leading-relaxed text-stone-700">
        {SECTIONS.map((s) => (
          <section key={s.h}>
            <h2 className="mb-2 font-bold text-stone-900">{s.h}</h2>
            <ul className="list-disc space-y-1 pl-5">
              {s.p.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </section>
        ))}
        <p>
          <Link href="/privacy" className="text-teal-800 underline">
            プライバシーポリシー
          </Link>
        </p>
      </div>
    </main>
  );
}
