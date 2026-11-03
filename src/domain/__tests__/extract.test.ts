import { describe, expect, it } from "vitest";
import { applyExtracted, findSame, matchPerson, missingItems, toAsset, type ExtractedAsset } from "@/lib/extract";
import { demoCase } from "@/data/demo";

const base: ExtractedAsset = { kind: "other", label: "", amount: null, accruedInterest: null, location: null, areaSqm: null, fixedAssetValue: null, date: null, evidence: "" };

describe("書類の読み取り結果の登録", () => {
  const c = structuredClone(demoCase);

  it("受取人・負担者の名前を家族に当てはめる（名だけでも）", () => {
    expect(matchPerson("花子", c.persons)?.id).toBe("hanako");
    expect(matchPerson("相続 一郎 様", c.persons)?.id).toBe("ichiro");
    expect(matchPerson("知らない人", c.persons)).toBeUndefined();
  });

  it("株数と4つの価格をそのまま渡す（0円にしない）", () => {
    const a = toAsset({ ...base, kind: "listedStock", label: "架空工業", shares: 2000, prices: { close: 3150, monthAvg: 3080, prevMonthAvg: 3020, prev2MonthAvg: 3110 } });
    expect(a.kind === "listedStock" && a.shares).toBe(2000);
    expect(a.kind === "listedStock" && a.prices.prevMonthAvg).toBe(3020);
    expect(a.pending).toBeUndefined();
  });

  it("路線価が書かれた土地は路線価方式にし、奥行は確認待ちにする", () => {
    const x = { ...base, kind: "land" as const, label: "自宅の土地", location: "東京都千代田区架空町一丁目2番3", areaSqm: 165.5, routePrice: 420_000 };
    const a = toAsset(x);
    expect(a.kind === "land" && a.method.type).toBe("rosenka");
    expect(a.pending?.some((p) => p.includes("奥行"))).toBe(true);
    expect(missingItems(x, c.persons)).toHaveLength(1);
  });

  it("同じ所在の土地は「同じもの」と判定し、更新しても id と分け方は残る", () => {
    const x = { ...base, kind: "land" as const, label: "自宅の土地", location: "東京都千代田区架空町1丁目2-3", areaSqm: 165.5, fixedAssetValue: 48_650_000 };
    const same = findSame(x, c);
    expect(same).toEqual({ type: "asset", id: "home-land" });
    const { next } = applyExtracted(c, x, same);
    expect(next.assets.length).toBe(c.assets.length);
    const land = next.assets.find((a) => a.id === "home-land");
    expect(land?.kind === "land" && land.method.type).toBe("rosenka"); // 地図で入れた路線価は消さない
    expect(land?.kind === "land" && land.smallResidential?.applies).toBe(true);
  });

  it("葬儀費用・贈与・保険金の受取人をそれぞれの入力先へ", () => {
    const f = applyExtracted(c, { ...base, kind: "funeral", label: "葬儀一式", amount: 1_850_000, personName: "一郎" });
    const d = f.next.debts.at(-1)!;
    expect(d.kind).toBe("funeral");
    expect(d.bearers).toEqual([{ personId: "ichiro", amount: 1_850_000 }]);
    const g = applyExtracted(c, { ...base, kind: "gift", label: "現金の贈与", amount: 1_100_000, personName: "さくら", date: "2024-12-20", giftTaxPaid: 0 });
    expect(g.next.priorGifts.at(-1)).toEqual({ personId: "sakura", date: "2024-12-20", amount: 1_100_000, giftTaxPaid: 0 });
    const ins = toAsset({ ...base, kind: "insurance", label: "保険", amount: 1, personName: "花子" }, c.persons);
    expect(ins.kind === "insurance" && ins.recipientId).toBe("hanako");
    const cash = toAsset({ ...base, kind: "cash", label: "現金", amount: 520_000 });
    expect(cash.kind).toBe("cash");
  });
});
