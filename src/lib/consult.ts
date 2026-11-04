/** 税理士に相談するときに伝える内容を、入力内容から書き出す */
import { type TaxResult, isValidISODate, mergeAcquirerCheck } from "@/domain/tax/engine";
import type { Case, Person, SmallLandKind, SmallLandRelief } from "@/domain/types";
import { reviewConsultLines } from "@/domain/review/topics";
import { type SmallResidentialCheck, judgeSmallResidential, smallLandKind } from "@/domain/valuation/smallResidential";

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

/**
 * 小規模宅地等の特例で税理士に確かめたいこと。1つの土地を何人かで受け継いで特例を使うときは、2人目以降の人も
 * 本人の答え（土地についての答えは1人目の答え）で判定し、人の名前を添える。理由が同じ人はまとめて1行にする
 */
function smallLandConsult(lotName: string, sr: SmallLandRelief, kind: SmallLandKind, living: Person[], assetKind: "land" | "condo"): string[] {
  const who: { id?: string; check: SmallResidentialCheck }[] = [];
  const seen = new Set<string>();
  if (sr.check) who.push({ id: sr.acquirerId, check: sr.check });
  if (sr.acquirerId) seen.add(sr.acquirerId);
  for (const o of Array.isArray(sr.others) ? sr.others : []) {
    if (!o?.acquirerId || seen.has(o.acquirerId) || !living.some((p) => p.id === o.acquirerId)) continue;
    seen.add(o.acquirerId);
    who.push({ id: o.acquirerId, check: mergeAcquirerCheck(sr.check, o.check) });
  }
  const several = seen.size > 1;
  const byReason = new Map<string, string[]>();
  for (const w of who) {
    const person = living.find((p) => p.id === w.id);
    const j = judgeSmallResidential(w.check, person, kind, { assetKind });
    if (j.result !== "consult") continue;
    byReason.set(j.reason, [...(byReason.get(j.reason) ?? []), person?.name ? `${person.name}さん` : "取得する人"]);
  }
  return [...byReason].map(([reason, names]) => `「${lotName}」の小規模宅地等の特例${several ? `（${names.join("・")}の分）` : ""}：${reason}`);
}

export function consultPoints(c: Case, r: TaxResult | null): string[] {
  const out: string[] = [];
  const living = c.persons.filter((p) => !p.predeceased);
  for (const a of c.assets) {
    if (a.kind === "land" && a.method.type === "rosenka") {
      const roads = a.method.roads?.filter((x) => x.price > 0) ?? [];
      const v = r?.assets.find((l) => l.asset.id === a.id)?.valuation.value;
      out.push(
        `土地「${a.label || a.location}」（${a.areaSqm}㎡）：路線価方式で${roads.length >= 2 ? `${roads.length}つの道路に面する土地として` : ""}評価${v ? ` ${yen(v)}` : ""}。間口が狭い・奥行が長い・形がいびつ・がけ地などの減額ができるか確認したい。`,
      );
    }
    if ((a.kind === "land" || a.kind === "condo") && a.smallResidential) {
      out.push(...smallLandConsult(a.label || a.location, a.smallResidential, smallLandKind(a), living, a.kind));
    }
    if (a.kind === "unlistedStock") out.push(`非上場株式「${a.label}」の評価をお願いしたい。`);
    if (a.foreign) out.push(`国外の財産「${a.label}」がある。`);
  }
  // 相次相続控除・相続時精算課税・扶養義務者からの控除・未分割・代償金は相続コンパスが計算する。
  // 相次相続控除は、前の相続の内容がそろわない（申告書の控えが見つからないなど）ときだけ相談の項目にする
  const pi = c.decedent.priorInheritance;
  if (c.decedent.priorInheritanceTax && !(isValidISODate(pi?.date) && Number(pi?.prevTax) > 0 && Number(pi?.prevAcquired) > 0))
    out.push("亡くなった方が10年以内の相続で相続税を納めている。相次相続控除に使う前の相続の内容（相続の日・納めた相続税額・取得した財産の価額）を確かめたい。");
  if (c.persons.length > 0 && r && r.heirsCivil.slots.length === 0)
    out.push("相続人がいない（全員が相続を放棄した、または相続人になる家族がいない）。相続財産清算人・特別縁故者の手続きと相続税の申告について相談したい。");
  for (const p of c.persons) {
    if (p.predeceased && p.deathDate && c.decedent.deathDate && p.deathDate > c.decedent.deathDate)
      out.push(`${p.name || "相続人"}さんが亡くなった方より後に亡くなっている（数次相続）。`);
    if (p.nonResident) out.push(`${p.name || "相続人"}さんが海外に住んでいる。`);
    if (!p.predeceased && p.relation === "adoptedChild" && p.grandchildAdopted && p.alsoSubstituteHeir)
      out.push(`${p.name || "養子"}さんは孫を養子にした人で、先に亡くなった子の代わりに相続する人（代襲相続人）でもある（二重の資格）。`);
  }
  out.push(...reviewConsultLines(c.review));
  return out;
}

export function consultMemo(c: Case, r: TaxResult | null): string {
  const lines = [
    `亡くなった日：${c.decedent.deathDate || "未入力"}`,
    `相続人：${c.persons.filter((p) => !p.predeceased).map((p) => `${p.relationLabel ?? ""}${p.name ? ` ${p.name}` : ""}`).join("、") || "未入力"}`,
    r ? `財産の合計（相続コンパスの計算）：${yen(r.assets.reduce((s, l) => s + l.valuation.value, 0))}` : "",
    r ? `相続税の合計（相続コンパスの計算）：${yen(r.totalPayable)}` : "",
    "",
    "相談したいこと：",
    ...consultPoints(c, r).map((x) => `・${x}`),
  ];
  return lines.filter((l, i) => l !== "" || i > 0).join("\n");
}

