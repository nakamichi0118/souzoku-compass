/**
 * やることリストと資料集めのチェックを連動させる。
 * 書類を取ること自体が手続きのもの（戸籍集め・法定相続情報・残高証明書）は、
 * 手続きを「完了」にすると書類も「そろった」に、書類が全部そろうと手続きも「完了」にする。
 * 「未完了」に戻すときは、押したほうだけを戻す（もう一方の記録は消さない）。
 */
import type { Interview } from "@/domain/procedures/interview";
import type { ItemStatus } from "./planStore";

const naId = (id: string) => `na:${id}`;

/** 手続きと、それで手に入る書類 */
export const PRODUCES: Record<string, (iv: Interview) => string[]> = {
  koseki: () => ["kosekiDecedent", "kosekiHeirs"],
  "houtei-joho": () => ["houteiJoho"],
  "bank-notice": (iv) => ["balanceCert", ...(iv.securities > 0 ? ["securitiesCert"] : [])],
};

const docKey = (id: string) => `doc:${id}`;

/** 押した項目の状態を変え、連動する項目も変えた記録を返す */
export function applyStatus(cur: string[], id: string, st: ItemStatus, iv: Interview): string[] {
  const set = (list: string[], key: string, s: ItemStatus) => {
    const next = list.filter((x) => x !== key && x !== naId(key));
    if (s === "done") next.push(key);
    if (s === "na") next.push(naId(key));
    return next;
  };
  let next = set(cur, id, st);
  if (st !== "done") return next;
  // 手続きを完了 → 手に入る書類も「そろった」（「不要」にした書類はそのまま）
  const produced = PRODUCES[id]?.(iv);
  if (produced) {
    for (const d of produced) if (!next.includes(docKey(d)) && !next.includes(naId(docKey(d)))) next.push(docKey(d));
    return next;
  }
  // 書類がそろった → その書類を取る手続きの書類が全部そろえば、手続きも完了
  if (id.startsWith("doc:")) {
    for (const [task, of] of Object.entries(PRODUCES)) {
      const docs = of(iv).map(docKey);
      if (!docs.includes(id) || next.includes(task) || next.includes(naId(task))) continue;
      if (docs.every((k) => next.includes(k) || next.includes(naId(k)))) next = [...next, task];
    }
  }
  return next;
}
