import Link from "next/link";

const FLOW = [
  ["聞き取り", "家族構成や財産のおおよその額など、5つのことに答えます（約3分）。"],
  ["相続税はかかる？", "基礎控除と比べて、相続税がかかるか・申告が必要かをその場で判定します。"],
  ["あなたの手続きリスト", "死亡届から相続登記まで、必要な手続きだけを期限順に並べます。カレンダーにもまとめて追加できます。"],
  ["書類をつくる", "相続税がかかる場合は、国税庁の正式様式の申告書と遺産分割協議書のPDFを作れます。"],
];

const TIMELINE = [
  ["7日", "死亡届・火葬許可"],
  ["14日", "年金・健康保険・世帯主"],
  ["49日", "四十九日法要・納骨"],
  ["3か月", "相続放棄の期限"],
  ["4か月", "準確定申告"],
  ["10か月", "相続税の申告・納付"],
  ["1年", "一周忌"],
  ["3年", "相続登記の期限"],
];

export default function Home() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-14">
      <p className="text-sm font-semibold text-teal-700">身近な人が亡くなったら、まずここから。</p>
      <h1 className="mt-2 text-4xl font-bold leading-tight text-stone-900">相続コンパス</h1>
      <p className="mt-4 text-lg leading-relaxed text-stone-700">
        何から手をつければいいか分からない。相続税はかかるの？──いくつかの質問に答えるだけで、
        <strong>あなたの家族に必要な手続きと期限</strong>が分かります。相続税がかからなければ、それもはっきりお伝えします。
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/start" className="rounded-lg bg-teal-700 px-6 py-3 font-semibold text-white hover:bg-teal-800">
          はじめる（約3分）
        </Link>
        <Link href="/plan" className="rounded-lg border border-stone-300 bg-white px-6 py-3 font-semibold text-stone-800 hover:bg-stone-50">
          デモの手続きリストを見る
        </Link>
      </div>

      <ol className="mt-12 grid gap-3 sm:grid-cols-4">
        {FLOW.map(([t, d], i) => (
          <li key={t} className="rounded-xl border border-stone-200 bg-white p-4">
            <span className="text-xs font-bold text-teal-700">STEP {i + 1}</span>
            <p className="mt-1 font-bold text-stone-900">{t}</p>
            <p className="mt-1 text-sm leading-relaxed text-stone-600">{d}</p>
          </li>
        ))}
      </ol>

      <section className="mt-12">
        <h2 className="text-lg font-bold text-stone-900">亡くなった後の主な期限</h2>
        <ol className="mt-4 flex gap-2 overflow-x-auto pb-2">
          {TIMELINE.map(([when, what]) => (
            <li key={when} className="min-w-28 flex-1 rounded-lg border-t-4 border-teal-600 bg-white p-3 text-center shadow-sm">
              <p className="text-lg font-bold text-teal-800">{when}</p>
              <p className="mt-1 text-xs text-stone-600">{what}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12 grid gap-4 sm:grid-cols-3">
        {[
          ["期限と税額は決まったルールで", "手続きの要否・期限、相続税の計算は、法令に沿ったルール表と計算エンジンが決めます。AIは関与しないので、同じ答えなら必ず同じ結果です。"],
          ["Claudeが案内と入力を手伝う", "「この手続きは何を持っていけばいい？」といった質問や、専門用語の説明、残高証明書などの読み取りをClaudeが担当します。"],
          ["自動で完結できないものは正直に", "借金が多い場合の相続放棄、国外財産・非上場株式・争いのある遺産分割などは、専門家への相談をおすすめします。"],
        ].map(([t, d]) => (
          <div key={t} className="rounded-xl border border-stone-200 bg-white p-5">
            <h2 className="font-bold text-stone-900">{t}</h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">{d}</p>
          </div>
        ))}
      </section>

      <section className="mt-12 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="font-bold text-stone-900">相続税の申告書をつくる（相続税がかかる方）</h2>
        <p className="mt-2 text-sm leading-relaxed text-stone-600">
          亡くなった方・相続人・財産・債務・分け方を7つのステップで入力すると、国税庁の<strong>令和8年分の正式な申告書様式</strong>
          に記入したPDFと遺産分割協議書を作ります。土地は地図をクリックして国税庁の路線価図を重ねて評価できます。
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Link href="/case/decedent" className="rounded-lg border border-teal-700 px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50">
            相続税申告をはじめる（デモ案件入り）
          </Link>
          <Link href="/case/tax" className="rounded-lg px-4 py-2 text-sm font-semibold text-stone-700 hover:bg-stone-100">
            デモの計算結果を見る
          </Link>
        </div>
      </section>

      <p className="mt-12 text-xs text-stone-500">
        デモはすべて架空のダミーデータです。申告書様式の出典：国税庁「相続税の申告書等の様式一覧（令和8年分用）」を加工して作成。手続きの内容は一般的な案内で、自治体や窓口によって異なる場合があります。
      </p>
    </main>
  );
}
