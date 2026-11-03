"use client";

import { ChevronDown, Lightbulb } from "lucide-react";
import { useCallback } from "react";
import { AskCompass, useAsk } from "./compass/AskCompass";
import { CompassAvatar } from "./compass/CompassKun";
import { useCase } from "@/lib/store";
import { summarizeForAssistant } from "@/lib/summary";

const GUIDES: Record<string, { lead: string; points: string[] }> = {
  decedent: {
    lead: "まず、亡くなった方（被相続人）のことを教えてください。亡くなった日によって使う申告書の様式や税制が決まります。",
    points: [
      "相続税の申告期限は、亡くなったことを知った日の翌日から10か月以内です。",
      "提出先は、亡くなった方の最後の住所地を所轄する税務署です。",
      "相続コンパスは令和8年（2026年）中に亡くなった方の相続に対応しています。",
    ],
  },
  heirs: {
    lead: "家族の関係を入力すると、誰が相続人になり、法律上の取り分（法定相続分）がいくらかを自動で判定します。",
    points: [
      "先に亡くなった子がいる場合、その子ども（孫）が代わりに相続人になります（代襲相続）。",
      "相続放棄をした人も、相続税の基礎控除の人数には含めます。",
      "養子は、実子がいれば1人、いなければ2人までしか基礎控除の人数に入りません。",
    ],
  },
  assets: {
    lead: "亡くなった日時点の財産を登録します。土地や建物は、固定資産税の課税明細書や路線価図をもとに評価します。",
    points: [
      "預金は亡くなった日の残高に、定期預金などの既経過利息を加えます。",
      "上場株式は、亡くなった日の終値と、その月・前月・前々月の終値平均のうち最も低い価格で評価します。",
      "非上場株式・国外財産は自動で評価できません。税理士への相談をおすすめします。",
    ],
  },
  debts: {
    lead: "亡くなった方の借入金や未払いの税金、葬式費用は、財産から差し引けます。",
    points: [
      "香典返しの費用や法要（四十九日など）の費用は葬式費用に含まれません。",
      "相続を放棄した人は債務を差し引けませんが、実際に負担した葬式費用は差し引けます。",
    ],
  },
  division: {
    lead: "誰がどの財産を受け継ぐかを決めます。生命保険金は受取人が受け取るので、分け方の対象外です。",
    points: [
      "配偶者は、法定相続分か1億6千万円の多い方までは相続税がかかりません（配偶者の税額軽減）。",
      "自宅の土地を配偶者が受け継ぐと、小規模宅地等の特例で評価額が最大80%下がります。",
      "分け方が決まったら、遺産分割協議書に相続人全員が署名・押印します。",
    ],
  },
  tax: {
    lead: "入力内容から、相続税を決まった計算式で計算しています。AIは計算に関与しておらず、同じ入力なら必ず同じ結果になります。",
    points: [
      "各欄の計算過程を開くと、根拠となる法律と計算式を確認できます。",
      "納税額が0円でも、配偶者の税額軽減や小規模宅地等の特例を使う場合は申告が必要です。",
    ],
  },
  documents: {
    lead: "国税庁の令和8年分の正式様式に、計算結果を記入したPDFを作成します。",
    points: [
      "印刷して内容を確認し、マイナンバーなど残りの欄を書き込んでから税務署に提出してください（申告書への押印は要りません。氏名は入力した内容で記入済みです）。",
      "遺産分割協議書は相続人全員の署名と実印での押印が必要です。",
    ],
  },
};

export function GuidePanel({ step }: { step: string }) {
  const g = GUIDES[step];
  const { data, result } = useCase();
  const context = useCallback(() => summarizeForAssistant(data, result), [data, result]);
  const state = useAsk(step, context);
  return (
    <div className="space-y-3">
      {g && (
        <details className="group rounded-2xl border border-sky-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-sky-950 [&::-webkit-details-marker]:hidden">
            <Lightbulb className="h-4 w-4 text-brand" aria-hidden />
            このステップのTips
            <span className="text-xs font-normal text-stone-500">（{g.points.length + 1}件）</span>
            <ChevronDown className="ml-auto h-4 w-4 text-stone-400 transition group-open:rotate-180" aria-hidden />
          </summary>
          <div className="flex items-start gap-3 border-t border-sky-100 px-4 py-3">
            <CompassAvatar size={36} />
            <ul className="min-w-0 list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-stone-700">
              {[g.lead, ...g.points].map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </details>
      )}
      <AskCompass state={state} placeholder="例：定期預金の利息はどう調べればいい？" />
    </div>
  );
}
