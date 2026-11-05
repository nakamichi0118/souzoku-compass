"use client";

import Link from "next/link";
import { Button, Card, Check, Field, Note, Select, TextInput, YenInput, fmt } from "@/components/ui";
import { AddressField } from "@/components/ui/AddressField";
import { type HeirResult, determineHeirs, isSurchargeTarget } from "@/domain/heirs";
import { toString as fracText } from "@/domain/fraction";
import type { Case, Person, PriorCredit, Relation, SmallLandAcquirer } from "@/domain/types";
import { ageAt, wareki } from "@/forms/format";
import { newId, useCase } from "@/lib/store";
import { Choice } from "@/components/plan/inputs";
import { ConsultLink } from "@/components/compass/ConsultLink";
import { addedAnchor, useShowAdded } from "./useShowAdded";
import { PhoneField } from "@/components/ui/PhoneField";

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

/** 特例を使う2人目以降の取得者から、その人の行を外す（だれもいなくなれば undefined） */
const withoutPerson = (others: SmallLandAcquirer[] | undefined, id: string) => {
  const rest = (others ?? []).filter((o) => o.acquirerId !== id);
  return rest.length ? rest : undefined;
};

/** 家族を削除したとき：その人を指している入力を外す（指したままにしない） */
export function removePerson(c: Case, id: string): Case {
  return {
    ...c,
    persons: c.persons.filter((x) => x.id !== id).map((x) => (x.substituteOf === id ? { ...x, substituteOf: undefined } : x)),
    allocations: c.allocations.map((a) => ({ ...a, shares: a.shares.filter((s) => s.personId !== id) })),
    // 削除した人を指したままにしない（贈与・債務の負担者・保険金の受取人・特例の取得者は「未選択」に戻し、選び直してもらう）
    priorGifts: c.priorGifts.map((g) => (g.personId === id ? { ...g, personId: "" } : g)),
    debts: c.debts.map((d) => (d.bearers.some((b) => b.personId === id) ? { ...d, bearers: d.bearers.map((b) => (b.personId === id ? { ...b, personId: "" } : b)) } : d)),
    assets: c.assets.map((a) => {
      if (a.kind === "insurance" || a.kind === "retirement") {
        // 追加した受取人の行は人を外して残す（金額は入れたままにして、選び直してもらう）
        const others = a.otherRecipients?.some((o) => o.personId === id) ? { otherRecipients: a.otherRecipients.map((o) => (o.personId === id ? { ...o, personId: "" } : o)) } : {};
        return a.recipientId === id ? { ...a, ...others, recipientId: "" } : { ...a, ...others };
      }
      if (a.kind === "land" || a.kind === "condo") {
        const sr = a.smallResidential;
        if (!sr) return a;
        // 一緒に受け継いだ人（特例を使う2人目以降）からは、その人の行ごと外す
        const othersPatch = sr.others?.some((o) => o.acquirerId === id) ? { others: withoutPerson(sr.others, id) } : {};
        if (sr.acquirerId === id) {
          const check = sr.check;
          return {
            ...a,
            smallResidential: {
              ...sr,
              ...othersPatch,
              acquirerId: undefined,
              // 特例を使う面積はその人のための入力なので残さない
              selectedSqm: undefined,
              check: check ? { ownHome: check.ownHome, special: check.special, business: check.business, familyHome: check.familyHome, recent: check.recent } : undefined,
            },
          };
        }
        if ("others" in othersPatch) return { ...a, smallResidential: { ...sr, ...othersPatch } };
      }
      return a;
    }),
  };
}

export function HeirsStep() {
  const { data, update, result } = useCase();
  const persons = data.persons;
  // 追加した人は一覧の最後に入るので、そこまで画面を送る
  const showAdded = useShowAdded(persons);

  const add = (relation: Relation) => {
    const id = newId();
    update((c) => ({ ...c, persons: [...c.persons, { id, name: "", relation, relationLabel: relLabel(relation) }] }));
    showAdded(id);
  };
  const patch = (id: string, p: Partial<Person>) =>
    update((c) => ({ ...c, persons: c.persons.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  /** 先に亡くなった子・兄弟姉妹の子を、代襲相続人として追加する */
  const addChildOf = (parent: Person) => {
    const relation: Relation = parent.relation === "sibling" ? "nephewNiece" : parent.relation === "grandchild" ? "greatGrandchild" : "grandchild";
    const id = newId();
    update((c) => ({
      ...c,
      persons: [...c.persons.map((x) => (x.id === parent.id ? { ...x, hasChildren: true } : x)), { id, name: "", relation, relationLabel: relLabel(relation), substituteOf: parent.id }],
    }));
    showAdded(id);
  };
  const remove = (id: string) => update((c) => removePerson(c, id));

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
      <Note tone="info">聞き取りの答えから下書きしました。違うところは直してください。</Note>
      <Card title="家族を追加する">
        <p className="mb-3 text-sm text-stone-600">亡くなった方から見た関係を選びます。先に亡くなった家族も追加してください。</p>
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
        const rawAge = ageAt(p.birthDate, data.decedent.deathDate);
        // 亡くなった後に生まれた子は0歳（相続税の計算と同じ扱い）
        const age = rawAge == null ? undefined : Math.max(0, rawAge);
        return (
          <div key={p.id} id={addedAnchor(p.id)} data-focus={`person-${p.id}`} className="rounded-xl">
            <Card
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span>{p.name || "（氏名未入力）"}</span>
                  <span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">{p.relationLabel ?? relLabel(p.relation)}</span>
                  {p.predeceased && <span className="rounded bg-stone-200 px-2 py-0.5 text-xs">先に死亡</span>}
                  {p.renounced && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900">相続放棄</span>}
                  {civilShare && <span className="rounded bg-teal-100 px-2 py-0.5 text-xs text-teal-900">法定相続分 {fracText(civilShare)}</span>}
                  {civil && !p.predeceased && p.relation !== "spouse" && !(p.grandchildAdopted && p.alsoSubstituteHeir) && isSurchargeTarget(p, civil.substitutes) && (
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
                <Field label="続柄">
                  <TextInput value={p.relationLabel ?? ""} onChange={(e) => patch(p.id, { relationLabel: e.target.value })} placeholder="例：妻、長男、二女、孫" />
                </Field>
                <Field label="生年月日" hint={[wareki(p.birthDate)?.text, age != null && !p.predeceased ? `相続開始時 ${age}歳` : ""].filter(Boolean).join(" / ")}>
                  <TextInput type="date" value={p.birthDate ?? ""} onChange={(e) => patch(p.id, { birthDate: e.target.value })} />
                </Field>
                {["grandchild", "greatGrandchild", "nephewNiece"].includes(p.relation) && (
                  <Field label="代わりに相続する親">
                    <Select
                      value={p.substituteOf ?? ""}
                      onChange={(v) => patch(p.id, { substituteOf: v || undefined })}
                      options={[{ value: "", label: "代わりに相続する人ではない" }, ...parentsFor(p).map((x) => ({ value: x.id, label: `${x.name || "（未入力）"}（${x.relationLabel ?? relLabel(x.relation)}）` }))]}
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
                {!p.predeceased && <ContactFields p={p} patch={patch} />}
              </div>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2">
                {p.relation !== "other" && (
                  <Check checked={!!p.predeceased} onChange={(v) => patch(p.id, { predeceased: v })} label="すでに亡くなっている" />
                )}
                {!p.predeceased && p.relation !== "other" && <Check checked={!!p.renounced} onChange={(v) => patch(p.id, { renounced: v })} label="家庭裁判所で相続放棄をした" />}
                {p.relation === "sibling" && <Check checked={!!p.halfBlood} onChange={(v) => patch(p.id, { halfBlood: v })} label="父母の一方だけが同じ（半血）" />}
                {p.relation === "adoptedChild" && (
                  <>
                    <Check checked={!!p.grandchildAdopted} onChange={(v) => patch(p.id, { grandchildAdopted: v, ...(v ? {} : { alsoSubstituteHeir: undefined }) })} label="孫を養子にした" />
                    {p.grandchildAdopted && (
                      <Check
                        checked={!!p.alsoSubstituteHeir}
                        onChange={(v) => patch(p.id, { alsoSubstituteHeir: v || undefined })}
                        label="先に亡くなった子の代わりに相続する人でもある"
                      />
                    )}
                    <Check
                      checked={!!p.adoptedCountsAsBiological}
                      onChange={(v) => patch(p.id, { adoptedCountsAsBiological: v })}
                      label="特別養子・配偶者の連れ子の養子"
                    />
                  </>
                )}
                {!p.predeceased && <Check checked={!!p.nonResident} onChange={(v) => patch(p.id, { nonResident: v })} label="海外に住んでいる" />}
              </div>
              {!p.predeceased && <PriorCredits p={p} age={age} isLegalHeir={tax ? tax.slots.some((x) => x.personIds.includes(p.id)) : undefined} patch={patch} />}
              {p.relation === "adoptedChild" && p.grandchildAdopted && p.alsoSubstituteHeir && !p.predeceased && (
                <div className="mt-3">
                  <Note tone="stop">
                    養子と、代わりに相続する人の両方にあたる場合は、計算が特殊なため相続コンパスでは計算できません。税理士にご相談ください。
                    <span className="mt-2 block">
                      <ConsultLink topic="二重の資格" />
                    </span>
                  </Note>
                </div>
              )}
              {p.predeceased && <Deceased p={p} decedentDeath={data.decedent.deathDate} persons={persons} patch={patch} onAddChild={() => addChildOf(p)} />}
            </Card>
          </div>
        );
      })}

      {civil && tax && persons.length > 0 && (
        <Card title="判定結果">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-bold text-stone-700">相続人と取り分</h3>
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
              <h3 className="mb-2 text-sm font-bold text-stone-700">税の計算での人数</h3>
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
              <Note tone="warn">相続放棄で、相続人は第{civil.rank}順位に移ります。ただし相続税の計算は、放棄がなかったものとして行います。</Note>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

/** 住所・連絡先（申告書・協議書に書く欄）。ほかの欄と同じく、ふつうに見せて入れてもらう */
function ContactFields({ p, patch }: { p: Person; patch: (id: string, p: Partial<Person>) => void }) {
  return (
    <>
      <div className="sm:col-span-3">
        <AddressField label="住所" address={p.address ?? ""} onAddress={(v) => patch(p.id, { address: v })} zip={p.zip ?? ""} onZip={(v) => patch(p.id, { zip: v })} />
      </div>
      <PhoneField value={p.phone ?? ""} onChange={(v) => patch(p.id, { phone: v })} />
      <Field label="職業">
        <TextInput value={p.occupation ?? ""} onChange={(e) => patch(p.id, { occupation: e.target.value })} />
      </Field>
    </>
  );
}

type PriorKey = "priorMinorCredit" | "priorDisabilityCredit";

/**
 * 以前の相続でも受けたかを聞く控除：亡くなった日に18歳未満なら未成年者控除、障害者なら障害者控除。
 * どちらも法定相続人（放棄した人を含む）だけが受けられるので、相続人でない人・先に亡くなった人には聞かない
 */
export function priorCreditKinds(p: Person, age: number | undefined, isLegalHeir = p.relation !== "other"): { key: PriorKey; what: string }[] {
  if (p.predeceased || !isLegalHeir) return [];
  return [
    ...(age != null && age < 18 ? [{ key: "priorMinorCredit" as const, what: "未成年者控除" }] : []),
    ...(p.disability === "general" || p.disability === "special" ? [{ key: "priorDisabilityCredit" as const, what: "障害者控除" }] : []),
  ];
}

/** 以前の相続でも未成年者控除・障害者控除を受けた人：今回の控除はその残りまで（相続税法19条の3第3項・19条の4第3項） */
function PriorCredits({ p, age, isLegalHeir, patch }: { p: Person; age: number | undefined; isLegalHeir?: boolean; patch: (id: string, p: Partial<Person>) => void }) {
  const kinds = priorCreditKinds(p, age, isLegalHeir);
  if (kinds.length === 0) return null;
  const put = (key: PriorKey, v: PriorCredit | undefined) => patch(p.id, key === "priorMinorCredit" ? { priorMinorCredit: v } : { priorDisabilityCredit: v });
  return (
    <div className="mt-3 space-y-2">
      {kinds.map(({ key, what }) => {
        const v = p[key];
        return (
          <div key={key}>
            <Check checked={!!v} onChange={(on) => put(key, on ? {} : undefined)} label={`以前の相続でも${what}を受けた`} />
            {v && (
              <div className="mt-2 grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3 sm:grid-cols-2">
                <Field label="その相続が始まった日" hint="前に亡くなった方が亡くなった日（2回以上なら最初の日）">
                  <TextInput type="date" value={v.date ?? ""} onChange={(e) => put(key, { ...v, date: e.target.value || undefined })} />
                </Field>
                <Field label="これまでに控除を受けた金額（扶養義務者から引いた分を含む）">
                  <YenInput value={v.amount} onChange={(n) => put(key, { ...v, amount: n })} />
                </Field>
                {key === "priorDisabilityCredit" && (
                  // 前の相続のときの区分で、今回引ける額の上限が変わる（相基通19の4-4）。選ぶまでは今と同じ区分
                  <Field label="その相続のときの区分">
                    <Select
                      value={(v.special ?? p.disability === "special") ? "special" : "general"}
                      onChange={(x) => put(key, { ...v, special: x === "special" })}
                      options={[
                        { value: "general", label: "一般障害者" },
                        { value: "special", label: "特別障害者" },
                      ]}
                    />
                  </Field>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** すでに亡くなっている家族：亡くなった日と、代わりに相続する子どもの確認 */
function Deceased({
  p,
  decedentDeath,
  persons,
  patch,
  onAddChild,
}: {
  p: Person;
  decedentDeath: string;
  persons: Person[];
  patch: (id: string, p: Partial<Person>) => void;
  onAddChild: () => void;
}) {
  const after = !!p.deathDate && !!decedentDeath && p.deathDate > decedentDeath;
  const same = !!p.deathDate && p.deathDate === decedentDeath;
  const canSubstitute = ["child", "adoptedChild", "grandchild", "sibling"].includes(p.relation);
  const kids = persons.filter((x) => x.substituteOf === p.id);
  const who = p.relation === "sibling" ? "甥・姪" : "孫";
  return (
    <div className="mt-4 space-y-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
      <div className="max-w-56">
        <Field label="亡くなった日">
          <TextInput type="date" value={p.deathDate ?? ""} onChange={(e) => patch(p.id, { deathDate: e.target.value || undefined })} />
        </Field>
      </div>
      {after && (
        <Note tone="warn">
          亡くなった方より<strong>後に</strong>亡くなっているので、{p.name || "この方"}さんも相続人です。その分は{p.name || "この方"}さんの相続人が引き継ぎます。申告書の書き方が特殊で、{p.name || "この方"}さんの相続での相次相続控除も相続コンパスでは計算できないため、税理士にご相談ください。
          <span className="mt-2 block">
            <ConsultLink topic="数次相続" />
          </span>
        </Note>
      )}
      {same && <Note tone="warn">同じ日に亡くなり、どちらが先か分からないときは、お互いに相続しないものとして扱います。税理士や司法書士に確認してください。</Note>}
      {!after && (
        <>
          {p.relation !== "parent" && p.relation !== "grandparent" && (
            <p className="text-xs text-stone-500">
              亡くなった方がこの方の相続で相続税を納めていたら、
              <Link href="/case/decedent" className="mx-1 underline">
                「亡くなった方」の画面
              </Link>
              で入れてください。
            </p>
          )}
          <p className="text-sm text-stone-700">
            {p.relation === "spouse"
              ? "先に亡くなった配偶者は相続人にならず、代わりに相続する人もいません。"
              : canSubstitute
                ? `${p.name || "この方"}さんの分は、子ども（${who}）が代わりに相続します。`
                : p.relation === "parent" || p.relation === "grandparent"
                  ? "先に亡くなった父母・祖父母は相続人になりません。"
                  : "亡くなった方より先に亡くなった人は、相続人になりません。"}
          </p>
          {canSubstitute && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-stone-800">{p.name || "この方"}さんに子どもはいますか？</p>
              <Choice
                value={kids.length > 0 ? true : p.hasChildren}
                onChange={(v) => {
                  if (v && kids.length === 0) onAddChild();
                  else patch(p.id, { hasChildren: v });
                }}
                options={[
                  { value: true, label: "いる" },
                  { value: false, label: "いない" },
                ]}
              />
              {kids.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 text-sm text-stone-700">
                  代わりに相続する人：{kids.map((k) => k.name || `（${who}・氏名未入力）`).join("、")}
                  <Button variant="ghost" onClick={onAddChild}>
                    ＋ もう1人追加
                  </Button>
                </div>
              )}
              {p.hasChildren === false && kids.length === 0 && <p className="text-xs text-stone-500">子どもがいなければ、ほかの相続人で分けます。</p>}
              {p.relation === "sibling" && <p className="text-xs text-stone-500">兄弟姉妹の場合、代わりに相続するのは甥・姪までです。</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
