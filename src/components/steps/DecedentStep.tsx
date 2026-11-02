"use client";

import { Button, Card, Field, Note, TextInput } from "@/components/ui";
import { demoCase } from "@/data/demo";
import { blankCase, useCase } from "@/lib/store";
import { wareki } from "@/forms/format";

export function DecedentStep() {
  const { data, update, replace } = useCase();
  const d = data.decedent;
  const set = (k: keyof typeof d, v: string) => update((c) => ({ ...c, decedent: { ...c.decedent, [k]: v } }));
  const deadline = (() => {
    if (!d.deathDate) return null;
    const dt = new Date(d.deathDate + "T00:00:00Z");
    dt.setUTCMonth(dt.getUTCMonth() + 10);
    return dt.toISOString().slice(0, 10);
  })();
  const outOfScope = d.deathDate && !d.deathDate.startsWith("2026");

  return (
    <div className="space-y-5">
      <Card
        title="亡くなった方の情報"
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => replace(structuredClone(demoCase))}>
              デモ案件を読み込む
            </Button>
            <Button variant="ghost" onClick={() => confirm("入力内容を消して新しく始めますか？") && replace(blankCase())}>
              新しく始める
            </Button>
          </div>
        }
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
      {outOfScope ? (
        <Note tone="stop">相続コンパスは令和8年（2026年）中に亡くなった方の相続を対象にしています。それ以外の年は税制や様式が異なります。</Note>
      ) : (
        deadline && (
          <Note tone="info">
            申告と納税の期限は <strong>{wareki(deadline)?.text}</strong> ごろです（亡くなったことを知った日の翌日から10か月以内。期限日が土日祝日の場合は翌平日）。
          </Note>
        )
      )}
    </div>
  );
}
