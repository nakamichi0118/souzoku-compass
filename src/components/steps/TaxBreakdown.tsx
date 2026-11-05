"use client";

import Link from "next/link";
import { Note, fmt } from "@/components/ui";
import type { TaxBreakdown } from "@/lib/taxBreakdown";

function Line({ label, sub, value, strong, minor }: { label: string; sub?: string; value: number; strong?: boolean; minor?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 border-b border-stone-100 py-1.5 last:border-b-0 ${minor ? "pl-3" : ""}`}>
      <div className="min-w-0">
        <dt className={`${strong ? "font-bold text-stone-900" : minor ? "text-stone-600" : "text-stone-800"}`}>{label}</dt>
        {sub && <p className="text-xs text-stone-500">{sub}</p>}
      </div>
      <dd className={`shrink-0 tabular-nums ${strong ? "font-bold text-teal-900" : value < 0 ? "text-teal-800" : "text-stone-800"}`}>
        {value < 0 ? `−${fmt(-value)}` : fmt(value)}円
      </dd>
    </div>
  );
}

const area = (n: number) => n.toLocaleString("ja-JP", { maximumFractionDigits: 2 });

/** 税額の画面の「財産の合計の内訳」：財産の評価額から、特例・非課税・債務・贈与の加算で課税価格の合計になるまで */
export function TaxBreakdownList({ b }: { b: TaxBreakdown }) {
  const exemptRows = (name: string, e: NonNullable<TaxBreakdown["insurance"]>) => (
    <>
      <Line label={name} value={e.received} />
      <Line
        minor
        label="うち非課税"
        sub={`500万円×法定相続人${b.legalHeirCount}人＝${fmt(e.limit)}円まで${e.notHeirs ? "。相続人でない人・相続を放棄した人が受け取った分には使えません" : ""}`}
        value={-e.exempt}
      />
    </>
  );
  return (
    <div className="mt-2 space-y-2">
      <dl className="rounded-lg border border-stone-200 bg-white px-3 text-sm">
        <Line label="財産の評価額" value={b.assets} />
        {b.small.map((s) => (
          <Line key={s.assetId} minor label={`小規模宅地等の特例（${s.label}）`} sub={`${s.name}：${area(s.area)}㎡を${s.rate}%減額`} value={-s.reduction} />
        ))}
        {b.insurance && exemptRows("死亡保険金", b.insurance)}
        {b.retirement && exemptRows("死亡退職金", b.retirement)}
        {b.debts > 0 && <Line label="債務・葬式費用" value={-b.debts} />}
        {b.gifts > 0 && <Line label="生前贈与の加算" value={b.gifts} />}
        <Line
          strong
          label="財産の合計（課税価格の合計）"
          sub={`一人ずつ1,000円未満を切り捨てた合計${b.netFloored ? "。債務などが受け取った財産より多い人は0円として数えます" : ""}`}
          value={b.total}
        />
      </dl>
      {b.smallUnused.map((u) => (
        <Note key={u.assetId} tone="warn">
          <span className="font-semibold">「{u.label}」は小規模宅地等の特例を使っていません。</span>
          {u.reason}
          <Link href={`/case/assets?asset=${encodeURIComponent(u.assetId)}`} className="ml-2 font-semibold underline">
            財産で直す ›
          </Link>
        </Note>
      ))}
      {b.smallUnanswered.length > 0 && (
        <p className="text-xs text-stone-600">
          特例の欄に答えていない土地：{b.smallUnanswered.map((u) => u.label).join("、")}。自宅・お店・貸している土地なら、答えると評価が下がることがあります。
          <Link href={`/case/assets?asset=${encodeURIComponent(b.smallUnanswered[0].assetId)}`} className="ml-1 font-semibold text-teal-800 underline">
            財産で答える ›
          </Link>
        </p>
      )}
    </div>
  );
}
