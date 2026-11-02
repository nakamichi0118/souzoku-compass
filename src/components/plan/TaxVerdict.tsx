import Link from "next/link";
import type { Estimate } from "@/domain/procedures/interview";

const man = (n: number) => `${Math.round(n / 10_000).toLocaleString("ja-JP")}万円`;

export interface Precise {
  taxable: number;
  basic: number;
  payable: number;
  needsFiling: boolean;
}

/** 相続税がかかるかの判定。相続税申告の画面で財産を評価済みなら、その計算結果を使う */
export function TaxVerdict({ est, spouse, precise }: { est: Estimate; spouse: boolean; precise?: Precise | null }) {
  const verdict = precise ? (!precise.needsFiling ? "none" : precise.payable > 0 ? "likely" : "relief") : est.verdict;
  const taxable = precise ? precise.taxable : est.taxableTotal;
  const basic = precise ? precise.basic : est.basicDeduction;
  const tone = {
    none: "border-emerald-300 bg-emerald-50",
    borderline: "border-amber-300 bg-amber-50",
    relief: "border-amber-300 bg-amber-50",
    likely: "border-rose-300 bg-rose-50",
  }[verdict];
  const head = {
    none: "相続税はかからない見込みです。申告も不要です。",
    borderline: "相続税はかからない見込みですが、基礎控除に近い金額です。",
    relief: "特例を使えば相続税は0円の見込みです。ただし申告は必要です。",
    likely: precise ? `相続税は合計 ${precise.payable.toLocaleString("ja-JP")}円 の計算です。` : "相続税がかかる見込みです。10か月以内に申告と納税が必要です。",
  }[verdict];
  const pct = Math.min(100, Math.round((taxable / Math.max(1, basic)) * 100));
  return (
    <section className={`rounded-2xl border-2 p-5 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-bold tracking-wide text-stone-600">相続税はかかる？</p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${precise ? "bg-sky-700 text-white" : "bg-white text-stone-600"}`}>
          {precise ? "財産評価にもとづく計算" : "聞き取りの金額による目安"}
        </span>
      </div>
      <h2 className="mt-1 text-xl font-bold text-stone-900">{head}</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl bg-white/80 p-3">
          <p className="text-xs text-stone-500">{precise ? "課税価格の合計額" : "財産の合計の目安"}</p>
          <p className="text-2xl font-bold tabular-nums">{man(taxable)}</p>
          <p className="text-xs text-stone-500">{precise ? "土地・建物を評価し、特例・保険金の非課税・債務・葬式費用を反映した額" : `保険金の非課税分（${man(est.insuranceExempt)}）・借金・葬儀費用を差し引いた額`}</p>
        </div>
        <div className="rounded-xl bg-white/80 p-3">
          <p className="text-xs text-stone-500">基礎控除（これ以下なら税金はかからない）</p>
          <p className="text-2xl font-bold tabular-nums">{man(basic)}</p>
          <p className="text-xs text-stone-500">3,000万円 ＋ 600万円 × 相続人{est.heirCount}人</p>
        </div>
      </div>
      <div className="mt-3 h-3 overflow-hidden rounded-full bg-white" aria-hidden>
        <div className={`h-full ${verdict === "none" ? "bg-emerald-500" : verdict === "likely" ? "bg-rose-500" : "bg-amber-500"}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-right text-xs text-stone-500">基礎控除の {Math.round((taxable / Math.max(1, basic)) * 100)}%</p>
      {!precise && verdict === "relief" && (
        <p className="mt-2 text-sm leading-relaxed text-stone-700">
          自宅を家族が受け継ぐ場合の「小規模宅地等の特例」を使うと、財産の目安は {man(est.taxableWithRelief)} になり、基礎控除の範囲に収まります。特例は申告書を出さないと使えません。
        </p>
      )}
      {!precise && verdict === "likely" && (
        <p className="mt-2 text-sm leading-relaxed text-stone-700">
          法定相続分どおりに分けた場合の相続税の総額は、およそ <strong>{man(est.roughTotalTax)}</strong>
          {spouse && est.roughTaxAfterSpouse !== est.roughTotalTax && (
            <>
              。配偶者が法定相続分を受け継ぐと、配偶者の税額軽減でおよそ <strong>{man(est.roughTaxAfterSpouse)}</strong>
            </>
          )}
          の見込みです。
        </p>
      )}
      <p className="mt-3 text-xs text-stone-500">
        {precise ? (
          <>
            相続税申告の画面で入力した財産・分け方から、計算エンジンが計算した結果です。{" "}
            <Link href="/case/tax" className="text-sky-800 underline">
              計算の内訳を見る
            </Link>
          </>
        ) : (
          "答えていただいた金額から求めた目安です（相続税法15条）。正確な判定は、財産を一つずつ評価する「相続税申告」の画面で行えます。"
        )}
      </p>
    </section>
  );
}
