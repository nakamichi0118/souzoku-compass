import type { TaxResult } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";
import { toString as fracText } from "@/domain/fraction";

/**
 * Claude に渡す案件の要約。氏名・住所などの個人情報は送らず、続柄と金額だけにする。
 */
export function summarizeForAssistant(c: Case, r: TaxResult | null): string {
  const label = new Map(c.persons.map((p, i) => [p.id, `${p.relationLabel ?? p.relation}${i + 1}`]));
  const lines: string[] = [];
  lines.push(`相続開始日: ${c.decedent.deathDate}`);
  lines.push(
    `家族: ${c.persons
      .map((p) => `${label.get(p.id)}${p.predeceased ? "(先に死亡)" : ""}${p.renounced ? "(放棄)" : ""}${p.substituteOf ? `(代襲:${label.get(p.substituteOf)})` : ""}`)
      .join("、") || "未入力"}`,
  );
  lines.push(`財産: ${c.assets.map((a) => `${a.kind}`).join("、") || "未入力"}（${c.assets.length}件）`);
  if (r) {
    lines.push(`法定相続人の数: ${r.legalHeirCount}人 / 基礎控除: ${r.basicDeduction.toLocaleString()}円`);
    lines.push(`課税価格の合計: ${r.totalTaxable.toLocaleString()}円 / 相続税の総額: ${r.totalTax.toLocaleString()}円 / 納付税額合計: ${r.totalPayable.toLocaleString()}円`);
    lines.push(`法定相続分(税法): ${r.heirsTax.slots.map((s) => `${s.personIds.map((id) => label.get(id)).join("・")}=${fracText(s.share)}`).join("、")}`);
    if (r.blockers.length) lines.push(`自動完結できない事項: ${r.blockers.length}件`);
  }
  return lines.join("\n");
}
