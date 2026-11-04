"use client";

import Link from "next/link";
import { Card, Field, Note, TextInput, YenInput, fmt } from "@/components/ui";
import { AddressField } from "@/components/ui/AddressField";
import { isValidDate, monthsDeadline, nextOpenDay } from "@/domain/procedures/dates";
import type { Decedent } from "@/domain/types";
import { useCase } from "@/lib/store";
import { Choice } from "@/components/plan/inputs";
import { ConsultLink } from "@/components/compass/ConsultLink";
import { wareki } from "@/forms/format";

const YES_NO_UNKNOWN: { value: boolean | "unknown"; label: string }[] = [
  { value: true, label: "はい" },
  { value: false, label: "いいえ" },
  { value: "unknown", label: "分からない" },
];

/** 「分からない」を選んだときの確かめ方と、税理士への相談の入り口 */
function HowToCheck({ topic, stop, children }: { topic: string; stop?: boolean; children: React.ReactNode }) {
  return (
    <div className={`mt-3 rounded-xl border p-3 text-sm ${stop ? "border-amber-300 bg-amber-50 text-amber-950" : "border-sky-200 bg-sky-50 text-sky-950"}`}>
      <p className="font-semibold">確かめ方</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">{children}</ul>
      <ConsultLink topic={topic} className="mt-3" />
    </div>
  );
}

export function DecedentStep() {
  const { data, update, result } = useCase();
  const d = data.decedent;
  const set = (k: keyof typeof d, v: string) => update((c) => ({ ...c, decedent: { ...c.decedent, [k]: v } }));
  const pi = d.priorInheritance ?? {};
  // 相続人ごとに差し引く相次相続控除の合計（それぞれの相続税額が上限）
  const successive = result?.persons.reduce((s, p) => s + p.successiveCredit, 0) ?? 0;
  // 前の相続の内容（空欄は undefined にして、入っていないことが分かるようにする）
  const setPrior = (p: Partial<NonNullable<Decedent["priorInheritance"]>>) =>
    update((c) => ({ ...c, decedent: { ...c.decedent, priorInheritance: { ...c.decedent.priorInheritance, ...p } } }));
  // やることリスト・カレンダーと同じ計算（応当日がなければ月末、休みの日なら次の開いている日）
  const deadline = d.deathDate && isValidDate(d.deathDate) ? nextOpenDay(monthsDeadline(d.deathDate, 10)) : null;
  const outOfScope = d.deathDate && !d.deathDate.startsWith("2026");

  return (
    <div className="space-y-5">
      {/* 見出しはページの大見出し（亡くなった方）と同じなので付けない */}
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="氏名">
            <TextInput value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="相続 太郎" />
          </Field>
          <Field label="フリガナ">
            <TextInput value={d.kana ?? ""} onChange={(e) => set("kana", e.target.value)} placeholder="ソウゾク タロウ" />
          </Field>
          <Field label="生年月日" hint={wareki(d.birthDate)?.text}>
            <TextInput type="date" value={d.birthDate} onChange={(e) => set("birthDate", e.target.value)} />
          </Field>
          <Field label="亡くなった日" hint={wareki(d.deathDate)?.text}>
            <TextInput type="date" value={d.deathDate} onChange={(e) => set("deathDate", e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <AddressField label="最後の住所" address={d.address} onAddress={(v) => set("address", v)} />
          </div>
          <Field label="職業">
            <TextInput value={d.occupation ?? ""} onChange={(e) => set("occupation", e.target.value)} placeholder="無職" />
          </Field>
          <Field label="提出先の税務署" hint="最後の住所を担当する税務署">
            {/* 「税務署」は欄の右に出しておき、名前だけ入れてもらう */}
            <span className="flex items-center gap-2">
              <TextInput
                value={data.filing?.taxOffice ?? ""}
                onChange={(e) => update((c) => ({ ...c, filing: { ...c.filing, taxOffice: e.target.value } }))}
                placeholder="例：麹町"
              />
              <span className="shrink-0 text-sm text-stone-600">税務署</span>
            </span>
          </Field>
        </div>
      </Card>
      <Card title="10年以内の相続">
        <p className="text-sm text-stone-700">亡くなった方は、亡くなる前10年以内に、ほかの方の相続で相続税を納めましたか？</p>
        <p className="mt-1 text-xs text-stone-500">例：先に亡くなった配偶者から相続していた。今回の相続税が少なくなります。</p>
        <div className="mt-3">
          <Choice
            value={d.priorInheritanceTax}
            onChange={(v) => update((c) => ({ ...c, decedent: { ...c.decedent, priorInheritanceTax: v } }))}
            options={YES_NO_UNKNOWN}
          />
        </div>
        {d.priorInheritanceTax === "unknown" && (
          <HowToCheck topic="相次相続控除">
            <li>先に亡くなった家族（例：配偶者）の相続税の申告書の控えを探す</li>
            <li>見つからなければ、そのとき申告した税務署で申告書の閲覧を申し込む</li>
            <li>分からないままなら「いいえ」と同じ扱いで計算します（控除は使いません）</li>
          </HowToCheck>
        )}
        {d.priorInheritanceTax === true && (
          <div className="mt-4 space-y-3">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="前の相続があった日" hint={wareki(pi.date)?.text ?? "前に亡くなった方が亡くなった日"}>
                <TextInput type="date" value={pi.date ?? ""} onChange={(e) => setPrior({ date: e.target.value || undefined })} />
              </Field>
              <Field label="そのとき納めた相続税">
                <YenInput value={pi.prevTax} onChange={(v) => setPrior({ prevTax: v > 0 ? v : undefined })} />
              </Field>
              <Field label="そのとき受け取った財産の額" hint="債務を引いた後の額。前の申告書の第1表④">
                <YenInput value={pi.prevAcquired} onChange={(v) => setPrior({ prevAcquired: v > 0 ? v : undefined })} />
              </Field>
            </div>
            {successive > 0 && <Note tone="ok">今回の相続税から、家族全体で {fmt(successive)}円 を差し引けます（相次相続控除）。</Note>}
            <details className="text-xs text-stone-600">
              <summary className="cursor-pointer py-2 font-medium text-teal-800">Tips：差し引ける額の計算</summary>
              <div className="mt-2 space-y-1 leading-relaxed">
                <p>差し引ける額の合計 ＝ A × C ÷（B − A）×（10 − E）÷ 10（相続税法20条）</p>
                <ul className="list-disc space-y-1 pl-5">
                  <li>A：そのとき納めた相続税（延滞税・加算税は含めません）</li>
                  <li>B：そのとき受け取った財産の額（債務を引いた後）</li>
                  <li>C：今回の相続で財産を受け取る人全員の財産の額の合計（債務を引いた後。自動で計算します）。C ÷（B − A）が1を超えるときは1にします</li>
                  <li>E：前の相続があった日から今回亡くなった日までの年数（1年未満は切り捨て）。10年以上たっていれば差し引けません</li>
                </ul>
                <p>この合計を、今回財産を受け取る相続人ごとに、受け取る財産の額の割合で分けて、それぞれの相続税から差し引きます。相続を放棄した人や、相続人でない人は差し引けません。</p>
              </div>
            </details>
          </div>
        )}
      </Card>
      <Card title="相続時精算課税を選んだ贈与">
        <p className="text-sm text-stone-700">亡くなった方からの贈与で「相続時精算課税」を選んだ人はいますか？</p>
        <p className="mt-1 text-xs text-stone-500">「相続時精算課税選択届出書」を出した贈与のことです。</p>
        <details className="text-xs text-stone-600">
          <summary className="cursor-pointer py-2 font-medium text-teal-800">詳しく</summary>
          <p className="leading-relaxed">選んだ後に受けた贈与は、何年前のものでも相続税の計算に足します（令和6年以降の贈与は、毎年110万円までの部分を除きます）。</p>
        </details>
        <div className="mt-3">
          <Choice
            value={d.settlementGift}
            onChange={(v) => update((c) => ({ ...c, decedent: { ...c.decedent, settlementGift: v } }))}
            options={YES_NO_UNKNOWN}
          />
        </div>
        {d.settlementGift === "unknown" && (
          <HowToCheck topic="相続時精算課税" stop>
            <li>
              亡くなった方の最後の住所の税務署に<strong>「相続税法第49条第1項の開示請求」</strong>を出すと、精算課税の贈与と、亡くなる前の贈与税の申告分を教えてもらえます
            </li>
            <li>入れ忘れは後で追加の納税になりやすいので、確かめるまで税額は出しません</li>
          </HowToCheck>
        )}
        {d.settlementGift === true && (
          <p className="mt-3 text-sm text-stone-700">
            贈与は
            <Link href="/case/debts" className="mx-1 font-semibold underline">
              債務・葬式費用
            </Link>
            の画面に入れ、「相続時精算課税」に印を付けます。
          </p>
        )}
      </Card>
      {outOfScope ? (
        <Note tone="stop">令和8年（2026年）中に亡くなった方だけが対象です（ほかの年は税制・様式が違うため）。</Note>
      ) : (
        deadline && (
          <Note tone="info">
            申告・納税の期限：<strong>{wareki(deadline)?.text}</strong>（亡くなったことを知った日の翌日から10か月。休日なら次の平日）
          </Note>
        )
      )}
    </div>
  );
}
