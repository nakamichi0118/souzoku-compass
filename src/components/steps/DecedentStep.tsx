"use client";

import { Card, Field, Note, TextInput } from "@/components/ui";
import { addMonths, isValidDate, nextOpenDay } from "@/domain/procedures/dates";
import { useCase } from "@/lib/store";
import { Choice } from "@/components/plan/inputs";
import { ConsultLink } from "@/components/compass/ConsultLink";
import { wareki } from "@/forms/format";

export function DecedentStep() {
  const { data, update } = useCase();
  const d = data.decedent;
  const set = (k: keyof typeof d, v: string) => update((c) => ({ ...c, decedent: { ...c.decedent, [k]: v } }));
  // やることリスト・カレンダーと同じ計算（応当日がなければ月末、休みの日なら次の開いている日）
  const deadline = d.deathDate && isValidDate(d.deathDate) ? nextOpenDay(addMonths(d.deathDate, 10)) : null;
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
          <div className="mt-3">
            <Note tone="stop">
              相続コンパスでは、相次相続控除の計算と申告書（第7表）の作成はできません。前回の相続の申告書の控えを用意して、税理士にご相談ください。
              <span className="mt-2 block">
                <ConsultLink topic="相次相続控除" />
              </span>
            </Note>
          </div>
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
