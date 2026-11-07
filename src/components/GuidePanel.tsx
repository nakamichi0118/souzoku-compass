"use client";

import { ChevronDown, Lightbulb } from "lucide-react";
import { useCallback } from "react";
import { useCompassTopic } from "@/lib/compassChat";
import { CompassAvatar } from "./compass/CompassKun";
import { useCase } from "@/lib/store";
import { summarizeForAssistant } from "@/lib/summary";

/**
 * 横の「このステップのTips」。画面の本文やすぐ下の想定質問（FAQ）と同じことは書かず、画面にない知識だけを置く。
 * 何もなければ Tips の欄ごと出さない
 */
const GUIDES: Record<string, string[]> = {
  decedent: ["亡くなった日で、使う申告書の様式と税制が決まります。", "相続コンパスは令和8年（2026年）中に亡くなった方の相続に対応しています。"],
  heirs: ["家族の関係から、相続人と取り分を自動で判定します。", "先に亡くなった子がいる場合、その子ども（孫）が代わりに相続人になります（代襲相続）。"],
  assets: [
    "亡くなった日時点の財産を登録します。",
    "上場株式は、亡くなった日の終値と、その月・前月・前々月の終値平均のうち最も低い価格で評価します。",
    "マンションは、2階建て以下（地下を除く）の建物や、住まい用の部屋が3室以下で全部を亡くなった方か親族が使っている建物では、区分所有補正をしません（階数は自動で判定します）。",
  ],
  review: ["家族名義の預金や会社の株の評価など、判断が分かれるものは税理士への相談をおすすめします。", "申告に入れるかどうかを最後に決めるのはご本人です。"],
  debts: ["相続を放棄した人は債務を差し引けませんが、実際に負担した葬式費用は差し引けます。"],
  division: ["自宅の土地を配偶者が受け継ぐと、小規模宅地等の特例で評価額が最大80%下がります。", "生命保険金・死亡退職金は、非課税枠（500万円×法定相続人の数）を引いて計算に入れています。"],
  tax: ["各欄の計算過程を開くと、根拠となる法律と計算式を確認できます。"],
  documents: ["申告書の氏名は、入力した内容で記入済みです。"],
};

export function GuidePanel({ step }: { step: string }) {
  const g = GUIDES[step];
  const { data, result } = useCase();
  const context = useCallback(() => summarizeForAssistant(data, result), [data, result]);
  useCompassTopic(step, context);
  return (
    <div className="space-y-3 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
      {g && (
        <details className="group rounded-2xl border border-sky-200 bg-white lg:shrink-0">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-sky-950 [&::-webkit-details-marker]:hidden">
            <Lightbulb className="h-4 w-4 text-brand" aria-hidden />
            このステップのTips
            <span className="text-xs font-normal text-stone-500">（{g.length}件）</span>
            <ChevronDown className="ml-auto h-4 w-4 text-stone-400 transition group-open:rotate-180" aria-hidden />
          </summary>
          <div className="flex items-start gap-3 border-t border-sky-100 px-4 py-3 lg:max-h-[35vh] lg:overflow-y-auto">
            <CompassAvatar size={36} />
            <ul className="min-w-0 list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-stone-700">
              {g.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        </details>
      )}
    </div>
  );
}
