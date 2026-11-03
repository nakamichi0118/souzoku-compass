import { describe, expect, it } from "vitest";
import { applyExtracted, isoDate, missingItems, type ExtractedAsset } from "@/lib/extract";
import { demoCase } from "@/data/demo";
import type { Case } from "@/domain/types";

const base: ExtractedAsset = { kind: "other", label: "", amount: null, accruedInterest: null, location: null, areaSqm: null, fixedAssetValue: null, date: null, evidence: "" };
const fresh = (): Case => structuredClone(demoCase);

describe("「読み取った内容で更新」は読めた値だけを重ねる", () => {
  it("預貯金：金額だけ読めたときは、利息・支店・口座種別を消さない", () => {
    const c = fresh();
    const { next } = applyExtracted(c, { ...base, kind: "deposit", label: "みほん銀行", institution: "みほん銀行", amount: 38_300_000 }, { type: "asset", id: "dep1" });
    const d = next.assets.find((a) => a.id === "dep1");
    expect(d).toMatchObject({ kind: "deposit", amount: 38_300_000, accruedInterest: 1_234, branch: "架空支店", accountType: "普通預金", label: "みほん銀行 普通預金" });
    expect(d?.pending).toBeUndefined();
  });

  it("預貯金：金額が読めなかったときは、登録済みの金額を0円にしない", () => {
    const c = fresh();
    const { next } = applyExtracted(c, { ...base, kind: "deposit", label: "みほん銀行", institution: "みほん銀行", amount: null, accruedInterest: 0 }, { type: "asset", id: "dep1" });
    const d = next.assets.find((a) => a.id === "dep1");
    expect(d?.kind === "deposit" && d.amount).toBe(38_250_000);
    // 利息は書類に「0円」とあれば0にする（読めた値）
    expect(d?.kind === "deposit" && d.accruedInterest).toBe(0);
    // 金額は登録済みの値があるので確認待ちにしない
    expect(d?.pending).toBeUndefined();
  });

  it("保険金：受取人の名前が当てはまらなければ、登録済みの受取人を残す", () => {
    const c = fresh();
    const { next } = applyExtracted(c, { ...base, kind: "insurance", label: "みほん生命", amount: null, personName: "知らない人" }, { type: "asset", id: "ins" });
    const a = next.assets.find((x) => x.id === "ins");
    expect(a).toMatchObject({ kind: "insurance", amount: 20_000_000, recipientId: "hanako" });
    expect(a?.pending).toBeUndefined();
  });

  it("土地：地積・路線価が読めなくても、地積・地目・評価方法・登記の事項を残す", () => {
    const c = fresh();
    const { next } = applyExtracted(c, { ...base, kind: "land", label: "自宅", location: "東京都千代田区架空町一丁目2番3", fixedAssetValue: 49_000_000 }, { type: "asset", id: "home-land" });
    const land = next.assets.find((a) => a.id === "home-land");
    expect(land?.kind).toBe("land");
    if (land?.kind !== "land") return;
    expect(land.areaSqm).toBe(165.5);
    expect(land.landUse).toBe("宅地");
    expect(land.method).toEqual(demoCase.assets[0].kind === "land" ? demoCase.assets[0].method : null);
    expect(land.registry).toEqual({ assessedValue: 49_000_000, lotNumber: "2番3" });
    expect(land.smallResidential?.applies).toBe(true);
    expect(land.pending).toBeUndefined();
  });

  it("土地：評価がそろっていない土地に路線価が読めたら、路線価方式にして奥行を確認待ちにする", () => {
    const c = fresh();
    c.assets.push({ id: "l2", kind: "land", label: "畑", location: "架空町5番", areaSqm: 300, landUse: "畑", method: { type: "multiplier", fixedAssetValue: 0, multiplier: 0 } });
    const { next } = applyExtracted(c, { ...base, kind: "land", label: "畑", location: "架空町5番", routePrice: 120_000 }, { type: "asset", id: "l2" });
    const land = next.assets.find((a) => a.id === "l2");
    if (land?.kind !== "land") throw new Error("land expected");
    expect(land.method.type).toBe("rosenka");
    expect(land.landUse).toBe("畑");
    expect(land.areaSqm).toBe(300);
    expect(land.pending).toEqual([expect.stringContaining("奥行")]);
  });

  it("土地：倍率方式の土地は、読めた固定資産税評価額だけを差し替える", () => {
    const c = fresh();
    c.assets.push({ id: "l3", kind: "land", label: "山林", location: "架空村1番", areaSqm: 1000, landUse: "山林", method: { type: "multiplier", fixedAssetValue: 100_000, multiplier: 1.2 } });
    const { next } = applyExtracted(c, { ...base, kind: "land", label: "山林", location: "架空村1番", fixedAssetValue: 120_000 }, { type: "asset", id: "l3" });
    const land = next.assets.find((a) => a.id === "l3");
    expect(land?.kind === "land" && land.method).toEqual({ type: "multiplier", fixedAssetValue: 120_000, multiplier: 1.2 });
    expect(land?.pending).toBeUndefined();
  });

  it("確認待ちは重ねたあとの値で数え直す（書類で埋まった項目は外す）", () => {
    const c = fresh();
    c.assets.push({ id: "s2", kind: "listedStock", label: "見本商事", shares: 0, prices: { close: 0, monthAvg: 0, prevMonthAvg: 0, prev2MonthAvg: 0 }, pending: ["株数", "4つの価格（亡くなった日の終値と、その月・前月・前々月の平均）"] });
    const { next } = applyExtracted(c, { ...base, kind: "listedStock", label: "見本商事", shares: 500, prices: { close: 1000, monthAvg: null, prevMonthAvg: 990, prev2MonthAvg: 980 } }, { type: "asset", id: "s2" });
    const s = next.assets.find((a) => a.id === "s2");
    expect(s?.kind === "listedStock" && s.shares).toBe(500);
    expect(s?.pending).toEqual([expect.stringContaining("4つの価格")]);
  });

  it("家屋：家屋番号が読めなければ、登録済みの家屋番号・構造を残す", () => {
    const c = fresh();
    const { next } = applyExtracted(c, { ...base, kind: "building", label: "家屋", location: null, fixedAssetValue: 6_900_000 }, { type: "asset", id: "home-bldg" });
    const b = next.assets.find((a) => a.id === "home-bldg");
    expect(b).toMatchObject({ kind: "building", fixedAssetValue: 6_900_000, location: "東京都千代田区架空町一丁目2番地3 家屋番号2番3" });
    expect(b?.kind === "building" && b.registry).toMatchObject({ houseNumber: "2番3", structure: "木造スレートぶき2階建", assessedValue: 6_900_000 });
  });

  it("更新する財産が見つからない・種類が違うときは、上書きせずに別の財産として登録する", () => {
    const c = fresh();
    const r1 = applyExtracted(c, { ...base, kind: "cash", label: "現金", amount: 10 }, { type: "asset", id: "dep1" });
    expect(r1.next.assets.find((a) => a.id === "dep1")).toEqual(c.assets.find((a) => a.id === "dep1"));
    expect(r1.next.assets).toHaveLength(c.assets.length + 1);
    const r2 = applyExtracted(c, { ...base, kind: "cash", label: "現金", amount: 10 }, { type: "asset", id: "gone" });
    expect(r2.next.assets).toHaveLength(c.assets.length + 1);
  });

  it("債務：負担する人が読めなければ、登録済みの負担者・支払先の住所・種類を残す", () => {
    const c = fresh();
    c.debts[1].debtType = "公租公課";
    const { next } = applyExtracted(c, { ...base, kind: "debt", label: "固定資産税", amount: 186_400 }, { type: "debt", id: "tax" });
    const d = next.debts.find((x) => x.id === "tax");
    expect(d).toMatchObject({ amount: 186_400, creditor: "千代田区", creditorAddress: "東京都千代田区", debtType: "公租公課", label: "令和8年度 固定資産税（未納分）", bearers: [{ personId: "hanako", amount: 186_400 }] });
  });

  it("贈与：受け取った人・日付が読めなければ、登録済みの値を残す", () => {
    const c = fresh();
    const { next } = applyExtracted(c, { ...base, kind: "gift", label: "贈与", amount: 1_100_000, personName: null, date: null, giftTaxPaid: null }, { type: "gift", index: 0 });
    expect(next.priorGifts[0]).toEqual({ personId: "sakura", date: "2024-12-20", amount: 1_100_000, giftTaxPaid: 0 });
  });

  it("贈与：受け取った人・日付が読めないまま新しく登録したときは空欄で残し、確認待ちとして示す", () => {
    const c = fresh();
    const x = { ...base, kind: "gift" as const, label: "贈与", amount: 500_000, personName: "知らない人", date: "令和7年5月1日" };
    const { next } = applyExtracted(c, x);
    expect(next.priorGifts.at(-1)).toEqual({ personId: "", date: "", amount: 500_000, giftTaxPaid: 0 });
    expect(missingItems(x, c.persons)).toEqual(["贈与を受けた人", "贈与の日"]);
  });

  it("日付は YYYY-MM-DD の実在する日だけを通す", () => {
    expect(isoDate("2025-02-28")).toBe("2025-02-28");
    expect(isoDate("2025-02-30")).toBe("");
    expect(isoDate("2025/02/01")).toBe("");
    expect(isoDate(null)).toBe("");
  });
});
