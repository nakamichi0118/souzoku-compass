import type { Asset, AssetKind } from "@/domain/types";

/** 財産の種類 → その評価に使う書類（資料集めの書類の id） */
export const DOC_OF: Partial<Record<AssetKind, string>> = { land: "hyokaCert", building: "hyokaCert", condo: "hyokaCert", deposit: "balanceCert", listedStock: "securitiesCert", insurance: "insurancePay" };

/**
 * 財産ごとの「書類あり」。書類を読み取って登録した財産か、「書類が手元にある」にした財産。
 * 資料集めで書類の種類に「済」を付けただけのときは、その種類の財産が1件だけなら書類ありとする
 * （預金口座が2つ以上あると、どの口座の書類かが分からないため）
 */
export function assetHasDoc(a: Asset, all: Asset[], done: string[]): boolean {
  const docId = DOC_OF[a.kind];
  if (!docId) return false;
  if (a.docFrom) return true;
  return done.includes(`doc:${docId}`) && all.filter((x) => DOC_OF[x.kind] === docId).length === 1;
}

/** その書類を使う財産で、まだ書類がないもの（2行のうち1行だけ読んだときの、もう1行など） */
export const assetsMissingDoc = (docId: string, all: Asset[], done: string[]) => all.filter((a) => DOC_OF[a.kind] === docId && !assetHasDoc(a, all, done));
