"use client";

import { Button, Card, Check, Field, Note, Select, TextInput, fmt } from "@/components/ui";
import { type HeirResult, determineHeirs, isSurchargeTarget } from "@/domain/heirs";
import { toString as fracText } from "@/domain/fraction";
import type { Person, Relation } from "@/domain/types";
import { ageAt, wareki } from "@/forms/format";
import { newId, useCase } from "@/lib/store";

const RELATIONS: { value: Relation; label: string; hint: string }[] = [
  { value: "spouse", label: "配偶者", hint: "夫・妻（法律上の婚姻）" },
  { value: "child", label: "子", hint: "実の子" },
  { value: "adoptedChild", label: "養子", hint: "養子縁組した子" },
  { value: "grandchild", label: "孫", hint: "先に亡くなった子の子（代襲）など" },
  { value: "greatGrandchild", label: "ひ孫", hint: "孫も先に亡くなった場合" },
  { value: "parent", label: "父母", hint: "子や孫がいない場合に相続人" },
  { value: "grandparent", label: "祖父母", hint: "父母がいない場合に相続人" },
  { value: "sibling", label: "兄弟姉妹", hint: "子も父母もいない場合に相続人" },
  { value: "nephewNiece", label: "甥・姪", hint: "先に亡くなった兄弟姉妹の子" },
  { value: "other", label: "相続人以外", hint: "遺言で財産を受け取る人など" },
];
const relLabel = (r: Relation) => RELATIONS.find((x) => x.value === r)?.label ?? r;

export function HeirsStep() {
  const { data, update, result } = useCase();
  const persons = data.persons;

  const add = (relation: Relation) =>
    update((c) => ({ ...c, persons: [...c.persons, { id: newId(), name: "", relation, relationLabel: relLabel(relation) }] }));
  const patch = (id: string, p: Partial<Person>) =>
    update((c) => ({ ...c, persons: c.persons.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const remove = (id: string) =>
    update((c) => ({
      ...c,
      persons: c.persons.filter((x) => x.id !== id).map((x) => (x.substituteOf === id ? { ...x, substituteOf: undefined } : x)),
      allocations: c.allocations.map((a) => ({ ...a, shares: a.shares.filter((s) => s.personId !== id) })),
    }));

  let civil: HeirResult | undefined, tax: HeirResult | undefined;
  try {
    civil = determineHeirs(persons, "civil");
    tax = determineHeirs(persons, "tax");
  } catch {
    /* 入力途中 */
  }
  const parentsFor = (p: Person) =>
    persons.filter((x) => x.id !== p.id && x.predeceased && (["grandchild", "greatGrandchild"].includes(p.relation) ? ["child", "adoptedChild", "grandchild"].includes(x.relation) : x.relation === "sibling"));

  return (
    <div className="space-y-5">
      <Card title="家族を追加する">
        <p className="mb-3 text-sm text-stone-600">亡くなった方から見た関係を選んでください。先に亡くなった家族も、その子どもが相続人になる場合があるので追加してください。</p>
        <div className="flex flex-wrap gap-2">
          {RELATIONS.map((r) => (
            <Button key={r.value} variant="secondary" onClick={() => add(r.value)} title={r.hint}>
              ＋ {r.label}
            </Button>
          ))}
        </div>
      </Card>

      {persons.map((p) => {
        const civilShare = civil?.byPerson.get(p.id);
        const age = ageAt(p.birthDate, data.decedent.deathDate);
        return (
          <Card
            key={p.id}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span>{p.name || "（氏名未入力）"}</span>
                <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">{p.relationLabel ?? relLabel(p.relation)}</span>
                {p.predeceased && <span className="rounded bg-stone-200 px-2 py-0.5 text-xs">先に死亡</span>}
                {p.renounced && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">相続放棄</span>}
                {civilShare && <span className="rounded bg-teal-100 px-2 py-0.5 text-xs text-teal-900">法定相続分 {fracText(civilShare)}</span>}
                {!p.predeceased && p.relation !== "spouse" && isSurchargeTarget(p) && (
                  <span className="rounded bg-rose-100 px-2 py-0.5 text-xs text-rose-900">2割加算の対象</span>
                )}
              </span>
            }
            actions={
              <Button variant="danger" onClick={() => remove(p.id)}>
                削除
              </Button>
            }
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="氏名">
                <TextInput value={p.name} onChange={(e) => patch(p.id, { name: e.target.value })} />
              </Field>
              <Field label="フリガナ">
                <TextInput value={p.kana ?? ""} onChange={(e) => patch(p.id, { kana: e.target.value })} />
              </Field>
              <Field label="続柄（書類に書く表記）" hint="例：妻、長男、二女、孫">
                <TextInput value={p.relationLabel ?? ""} onChange={(e) => patch(p.id, { relationLabel: e.target.value })} />
              </Field>
              <Field label="生年月日" hint={[wareki(p.birthDate)?.text, age != null && !p.predeceased ? `相続開始時 ${age}歳` : ""].filter(Boolean).join(" / ")}>
                <TextInput type="date" value={p.birthDate ?? ""} onChange={(e) => patch(p.id, { birthDate: e.target.value })} />
              </Field>
              {!p.predeceased && (
                <>
                  <Field label="郵便番号">
                    <TextInput value={p.zip ?? ""} onChange={(e) => patch(p.id, { zip: e.target.value })} placeholder="100-0001" />
                  </Field>
                  <Field label="電話番号">
                    <TextInput value={p.phone ?? ""} onChange={(e) => patch(p.id, { phone: e.target.value })} placeholder="03-0000-0000" />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="住所">
                      <TextInput value={p.address ?? ""} onChange={(e) => patch(p.id, { address: e.target.value })} />
                    </Field>
                  </div>
                  <Field label="職業">
                    <TextInput value={p.occupation ?? ""} onChange={(e) => patch(p.id, { occupation: e.target.value })} />
                  </Field>
                </>
              )}
              {["grandchild", "greatGrandchild", "nephewNiece"].includes(p.relation) && (
                <Field label="代わりに相続する親（被代襲者）" hint="先に亡くなった親を選ぶと代襲相続人になります">
                  <Select
                    value={p.substituteOf ?? ""}
                    onChange={(v) => patch(p.id, { substituteOf: v || undefined })}
                    options={[{ value: "", label: "代襲相続ではない" }, ...parentsFor(p).map((x) => ({ value: x.id, label: `${x.name || "（未入力）"}（${x.relationLabel ?? relLabel(x.relation)}）` }))]}
                  />
                </Field>
              )}
              {!p.predeceased && (
                <Field label="障害者控除">
                  <Select
                    value={p.disability ?? "none"}
                    onChange={(v) => patch(p.id, { disability: v as Person["disability"] })}
                    options={[
                      { value: "none", label: "該当しない" },
                      { value: "general", label: "一般障害者" },
                      { value: "special", label: "特別障害者" },
                    ]}
                  />
                </Field>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
              {p.relation !== "spouse" && p.relation !== "other" && (
                <Check checked={!!p.predeceased} onChange={(v) => patch(p.id, { predeceased: v })} label="亡くなった方より先に亡くなっている" />
              )}
              {!p.predeceased && p.relation !== "other" && <Check checked={!!p.renounced} onChange={(v) => patch(p.id, { renounced: v })} label="家庭裁判所で相続放棄をした" />}
              {p.relation === "sibling" && <Check checked={!!p.halfBlood} onChange={(v) => patch(p.id, { halfBlood: v })} label="父母の一方だけが同じ（半血）" />}
              {p.relation === "adoptedChild" && (
                <>
                  <Check checked={!!p.grandchildAdopted} onChange={(v) => patch(p.id, { grandchildAdopted: v })} label="孫を養子にした" />
                  <Check
                    checked={!!p.adoptedCountsAsBiological}
                    onChange={(v) => patch(p.id, { adoptedCountsAsBiological: v })}
                    label="特別養子・配偶者の連れ子の養子"
                  />
                </>
              )}
              {!p.predeceased && <Check checked={!!p.nonResident} onChange={(v) => patch(p.id, { nonResident: v })} label="海外に住んでいる" />}
            </div>
          </Card>
        );
      })}

      {civil && tax && persons.length > 0 && (
        <Card title="判定結果">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-bold text-stone-700">民法上の相続人と法定相続分</h3>
              <ul className="space-y-1 text-sm">
                {civil.slots.map((s) => (
                  <li key={s.personIds.join()} className="flex justify-between border-b border-stone-100 py-1">
                    <span>{s.label}</span>
                    <span className="font-semibold tabular-nums">{fracText(s.share)}</span>
                  </li>
                ))}
                {civil.slots.length === 0 && <li className="text-stone-500">相続人がいません</li>}
              </ul>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-bold text-stone-700">相続税の計算に使う法定相続人</h3>
              <p className="text-3xl font-bold text-teal-800">
                {tax.count}
                <span className="ml-1 text-base font-normal">人</span>
              </p>
              <p className="text-sm text-stone-600">基礎控除 3,000万円 ＋ 600万円 × {tax.count}人 ＝ {fmt(30_000_000 + 6_000_000 * tax.count)}円</p>
              {result && <p className="text-sm text-stone-600">生命保険金の非課税枠 500万円 × {tax.count}人 ＝ {fmt(result.insuranceExemptLimit)}円</p>}
            </div>
          </div>
          {tax.notes.map((n) => (
            <div key={n} className="mt-3">
              <Note tone="info">{n}</Note>
            </div>
          ))}
          {civil.rank !== tax.rank && (
            <div className="mt-3">
              <Note tone="warn">相続放棄により、民法上の相続人は第{civil.rank}順位に移りますが、相続税の計算は放棄がなかったものとして行います（相続税法15条2項）。</Note>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
