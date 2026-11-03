/** 税理士に相談するときに伝える内容を、入力内容から書き出す */
import type { TaxResult } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";
import { judgeSmallResidential } from "@/domain/valuation/smallResidential";

const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

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
    if ((a.kind === "land" || a.kind === "condo") && a.smallResidential?.check) {
      const j = judgeSmallResidential(a.smallResidential.check, living.find((p) => p.id === a.smallResidential?.acquirerId));
      if (j.result === "consult") out.push(`「${a.label || a.location}」の小規模宅地等の特例：${j.reason}`);
    }
    if (a.kind === "unlistedStock") out.push(`非上場株式「${a.label}」の評価をお願いしたい。`);
    if (a.foreign) out.push(`国外の財産「${a.label}」がある。`);
  }
  if (c.decedent.priorInheritanceTax) out.push("亡くなった方が10年以内の相続で相続税を納めている（相次相続控除を計算してほしい）。");
  if (c.decedent.settlementGift) out.push("亡くなった方から「相続時精算課税」を選んで贈与を受けた人がいる（贈与の加算と贈与税の差し引きを計算してほしい）。");
  for (const p of c.persons) {
    if (p.predeceased && p.deathDate && c.decedent.deathDate && p.deathDate > c.decedent.deathDate)
      out.push(`${p.name || "相続人"}さんが亡くなった方より後に亡くなっている（数次相続）。`);
    if (p.nonResident) out.push(`${p.name || "相続人"}さんが海外に住んでいる。`);
    if (!p.predeceased && p.relation === "adoptedChild" && p.grandchildAdopted && p.alsoSubstituteHeir)
      out.push(`${p.name || "養子"}さんは孫を養子にした人で、先に亡くなった子の代わりに相続する人（代襲相続人）でもある（二重の資格）。`);
  }
  for (const p of r?.persons ?? []) {
    const name = p.person.name || "相続人";
    if (p.minorExcess > 0) out.push(`${name}さんの未成年者控除のうち${yen(p.minorExcess)}が本人の相続税から引ききれない（扶養義務者の相続税から差し引く計算をしてほしい）。`);
    if (p.disabilityExcess > 0) out.push(`${name}さんの障害者控除のうち${yen(p.disabilityExcess)}が本人の相続税から引ききれない（扶養義務者の相続税から差し引く計算をしてほしい）。`);
  }
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
