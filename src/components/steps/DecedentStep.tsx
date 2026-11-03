"use client";

import Link from "next/link";
import { Card, Field, Note, TextInput, YenInput, fmt } from "@/components/ui";
import { isValidDate, monthsDeadline, nextOpenDay } from "@/domain/procedures/dates";
import type { Decedent } from "@/domain/types";
import { useCase } from "@/lib/store";
import { Choice } from "@/components/plan/inputs";
import { wareki } from "@/forms/format";

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
      <Card
        title="亡くなった方の情報"
      >
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
          <Field label="亡くなった日（相続開始日）" hint={wareki(d.deathDate)?.text}>
            <TextInput type="date" value={d.deathDate} onChange={(e) => set("deathDate", e.target.value)} />
          </Field>
          <Field label="最後の住所" hint="提出先の税務署はこの住所で決まります">
            <TextInput value={d.address} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="職業">
            <TextInput value={d.occupation ?? ""} onChange={(e) => set("occupation", e.target.value)} placeholder="無職" />
          </Field>
          <Field label="提出先の税務署" hint="例：麹町（「税務署」は不要）">
            <TextInput
              value={data.filing?.taxOffice ?? ""}
              onChange={(e) => update((c) => ({ ...c, filing: { ...c.filing, taxOffice: e.target.value } }))}
            />
          </Field>
        </div>
      </Card>
      <Card title="10年以内の相続">
        <p className="text-sm text-stone-700">亡くなった方は、亡くなる前の10年以内に、ほかの方の相続で財産を受け取り、相続税を納めましたか？</p>
        <p className="mt-1 text-xs text-stone-500">たとえば、先に亡くなった配偶者や子どもから相続していた場合です。納めた相続税の一部を今回の相続税から差し引ける「相次相続控除」の対象になります。</p>
        <div className="mt-3">
          <Choice
            value={d.priorInheritanceTax ?? false}
            onChange={(v) => update((c) => ({ ...c, decedent: { ...c.decedent, priorInheritanceTax: v } }))}
            options={[
              { value: false, label: "いいえ・分からない" },
              { value: true, label: "はい" },
            ]}
          />
        </div>
        {d.priorInheritanceTax && (
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
              <summary className="cursor-pointer font-medium text-teal-800">Tips：差し引ける額の計算</summary>
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
        <p className="text-sm text-stone-700">亡くなった方から生前に贈与を受けた人の中に、贈与税の申告で「相続時精算課税」を選んだ人はいますか？</p>
        <p className="mt-1 text-xs text-stone-500">
          税務署に「相続時精算課税選択届出書」を出して贈与を受けた場合です。選んだ後に受けた贈与は、何年前のものでも相続税の計算に足すことになります（令和6年以降の贈与は、毎年110万円までの部分を除きます）。
        </p>
        <div className="mt-3">
          <Choice
            value={d.settlementGift ?? false}
            onChange={(v) => update((c) => ({ ...c, decedent: { ...c.decedent, settlementGift: v } }))}
            options={[
              { value: false, label: "いいえ・分からない" },
              { value: true, label: "はい" },
            ]}
          />
        </div>
        {d.settlementGift && (
          <p className="mt-3 text-sm text-stone-700">
            その贈与は
            <Link href="/case/debts" className="mx-1 font-semibold underline">
              債務・葬式費用
            </Link>
            の画面の贈与の一覧に入れて、「相続時精算課税」に印を付けてください。
          </p>
        )}
      </Card>
      {outOfScope ? (
        <Note tone="stop">相続コンパスは令和8年（2026年）中に亡くなった方の相続を対象にしています。それ以外の年は税制や様式が異なります。</Note>
      ) : (
        deadline && (
          <Note tone="info">
            申告と納税の期限は <strong>{wareki(deadline)?.text}</strong> です（亡くなったことを知った日の翌日から10か月以内。土日祝日・年末年始にあたる場合は次の平日にしています）。
          </Note>
        )
      )}
    </div>
  );
}
