import { describe, expect, it } from "vitest";
import { determineHeirs, isSurchargeTarget } from "../heirs";
import { toString } from "../fraction";
import type { Person } from "../types";

const P = (id: string, relation: Person["relation"], extra: Partial<Person> = {}): Person => ({
  id,
  name: id,
  relation,
  ...extra,
});
const shares = (ps: Person[], mode: "civil" | "tax") => {
  const r = determineHeirs(ps, mode);
  return Object.fromEntries([...r.byPerson].map(([k, v]) => [k, toString(v)]));
};

describe("法定相続分（民法900条・901条）", () => {
  it("配偶者＋子2人 → 1/2・1/4・1/4、法定相続人3人", () => {
    const ps = [P("妻", "spouse"), P("長男", "child"), P("長女", "child")];
    expect(shares(ps, "civil")).toEqual({ 妻: "1/2", 長男: "1/4", 長女: "1/4" });
    expect(determineHeirs(ps, "tax").count).toBe(3);
  });

  it("配偶者＋父母（子なし）→ 2/3・1/6・1/6（900条2号）", () => {
    const ps = [P("妻", "spouse"), P("父", "parent"), P("母", "parent")];
    expect(shares(ps, "civil")).toEqual({ 妻: "2/3", 父: "1/6", 母: "1/6" });
  });

  it("父母が亡く祖父母のみ → 祖父母が相続人（889条1項1号：親等の近い者）", () => {
    const ps = [P("父", "parent", { predeceased: true }), P("祖母", "grandparent")];
    expect(shares(ps, "civil")).toEqual({ 祖母: "1" });
  });

  it("配偶者＋全血兄＋半血妹 → 3/4・1/6・1/12（900条4号ただし書）", () => {
    const ps = [P("妻", "spouse"), P("兄", "sibling"), P("妹", "sibling", { halfBlood: true })];
    expect(shares(ps, "civil")).toEqual({ 妻: "3/4", 兄: "1/6", 妹: "1/12" });
  });

  it("配偶者のみ → 1", () => {
    expect(shares([P("夫", "spouse")], "civil")).toEqual({ 夫: "1" });
  });
});

describe("代襲相続（887条2項・3項、889条2項、901条）", () => {
  it("配偶者＋子＋先に亡くなった子の子2人 → 1/2・1/4・1/8・1/8、人数4", () => {
    const ps = [
      P("妻", "spouse"),
      P("長男", "child"),
      P("次男", "child", { predeceased: true }),
      P("孫A", "grandchild", { substituteOf: "次男" }),
      P("孫B", "grandchild", { substituteOf: "次男" }),
    ];
    expect(shares(ps, "civil")).toEqual({ 妻: "1/2", 長男: "1/4", 孫A: "1/8", 孫B: "1/8" });
    expect(determineHeirs(ps, "tax").count).toBe(4);
  });

  it("再代襲：孫も先に亡くなっていればひ孫が代襲する", () => {
    const ps = [
      P("長男", "child", { predeceased: true }),
      P("孫", "grandchild", { substituteOf: "長男", predeceased: true }),
      P("ひ孫", "greatGrandchild", { substituteOf: "孫" }),
      P("長女", "child"),
    ];
    expect(shares(ps, "civil")).toEqual({ ひ孫: "1/2", 長女: "1/2" });
  });

  it("兄弟姉妹の代襲は甥姪まで（再代襲なし）", () => {
    const ps = [
      P("兄", "sibling"),
      P("弟", "sibling", { predeceased: true }),
      P("甥", "nephewNiece", { substituteOf: "弟", predeceased: true }),
      P("甥の子", "other", { substituteOf: "甥" }),
    ];
    expect(shares(ps, "civil")).toEqual({ 兄: "1" });
  });

  it("配偶者＋兄＋亡妹の子2人 → 3/4・1/8・1/16・1/16", () => {
    const ps = [
      P("妻", "spouse"),
      P("兄", "sibling"),
      P("妹", "sibling", { predeceased: true }),
      P("姪A", "nephewNiece", { substituteOf: "妹" }),
      P("姪B", "nephewNiece", { substituteOf: "妹" }),
    ];
    expect(shares(ps, "civil")).toEqual({ 妻: "3/4", 兄: "1/8", 姪A: "1/16", 姪B: "1/16" });
  });

  it("相続放棄した子の子は代襲しない（939条）", () => {
    const ps = [
      P("長男", "child", { renounced: true }),
      P("孫", "grandchild", { substituteOf: "長男" }),
      P("長女", "child"),
    ];
    expect(shares(ps, "civil")).toEqual({ 長女: "1" });
  });
});

describe("相続放棄と相続税法15条・16条", () => {
  it("子1人が放棄しても法定相続人の数は放棄がなかったものとして3人", () => {
    const ps = [P("妻", "spouse"), P("長男", "child", { renounced: true }), P("長女", "child")];
    expect(shares(ps, "civil")).toEqual({ 妻: "1/2", 長女: "1/2" });
    const tax = determineHeirs(ps, "tax");
    expect(tax.count).toBe(3);
    expect(tax.slots.map((s) => toString(s.share))).toEqual(["1/2", "1/4", "1/4"]);
  });

  it("子全員が放棄すると民法上は父母が相続人、税法上は子で計算", () => {
    const ps = [
      P("妻", "spouse"),
      P("長男", "child", { renounced: true }),
      P("母", "parent"),
    ];
    const civil = determineHeirs(ps, "civil");
    expect(civil.rank).toBe(2);
    expect(shares(ps, "civil")).toEqual({ 妻: "2/3", 母: "1/3" });
    const tax = determineHeirs(ps, "tax");
    expect(tax.rank).toBe(1);
    expect(tax.count).toBe(2);
  });
});

describe("養子の数の制限（相続税法15条2項・3項）", () => {
  it("実子1＋養子2（配偶者なし）→ 法定相続人2人、各1/2で総額計算", () => {
    const ps = [P("長男", "child"), P("養子A", "adoptedChild"), P("養子B", "adoptedChild")];
    expect(shares(ps, "civil")).toEqual({ 長男: "1/3", 養子A: "1/3", 養子B: "1/3" });
    const tax = determineHeirs(ps, "tax");
    expect(tax.count).toBe(2);
    expect(tax.slots.map((s) => toString(s.share))).toEqual(["1/2", "1/2"]);
  });

  it("実子なし＋養子3 → 2人まで算入", () => {
    const ps = [P("妻", "spouse"), ...["A", "B", "C"].map((x) => P(x, "adoptedChild"))];
    const tax = determineHeirs(ps, "tax");
    expect(tax.count).toBe(3);
    expect(tax.slots.map((s) => toString(s.share))).toEqual(["1/2", "1/4", "1/4"]);
  });

  it("特別養子・配偶者の連れ子養子は実子とみなして制限しない", () => {
    const ps = [
      P("長男", "child"),
      P("養子A", "adoptedChild"),
      P("連れ子", "adoptedChild", { adoptedCountsAsBiological: true }),
    ];
    expect(determineHeirs(ps, "tax").count).toBe(3);
  });

  it("亡くなった養子の代襲相続人は実子とみなす", () => {
    const ps = [
      P("長男", "child"),
      P("養子A", "adoptedChild"),
      P("養子B", "adoptedChild", { predeceased: true }),
      P("孫", "grandchild", { substituteOf: "養子B" }),
    ];
    expect(determineHeirs(ps, "tax").count).toBe(3);
  });
});

describe("2割加算（相続税法18条）", () => {
  const none = new Set<string>();
  it("配偶者・子・父母・代襲相続人の孫は対象外", () => {
    expect(isSurchargeTarget(P("a", "spouse"), none)).toBe(false);
    expect(isSurchargeTarget(P("a", "child"), none)).toBe(false);
    expect(isSurchargeTarget(P("a", "parent"), none)).toBe(false);
    expect(isSurchargeTarget(P("a", "grandchild", { substituteOf: "x" }), new Set(["a"]))).toBe(false);
  });
  it("兄弟姉妹・甥姪・孫養子・相続人でない受遺者は対象", () => {
    expect(isSurchargeTarget(P("a", "sibling"), none)).toBe(true);
    expect(isSurchargeTarget(P("a", "nephewNiece", { substituteOf: "x" }), new Set(["a"]))).toBe(true);
    expect(isSurchargeTarget(P("a", "adoptedChild", { grandchildAdopted: true }), none)).toBe(true);
    expect(isSurchargeTarget(P("a", "other"), none)).toBe(true);
  });
  it("孫養子でも代襲相続人なら対象外", () => {
    expect(
      isSurchargeTarget(P("a", "adoptedChild", { grandchildAdopted: true, substituteOf: "x" }), new Set(["a"])),
    ).toBe(false);
  });

  const surcharged = (ps: Person[], id: string) =>
    isSurchargeTarget(ps.find((p) => p.id === id)!, determineHeirs(ps, "civil").substitutes);

  it("先に亡くなった子の子は代襲相続人なので対象外", () => {
    const ps = [P("長男", "child", { predeceased: true }), P("孫", "grandchild", { substituteOf: "長男" }), P("長女", "child")];
    expect(determineHeirs(ps, "civil").substitutes).toEqual(new Set(["孫"]));
    expect(surcharged(ps, "孫")).toBe(false);
  });
  it("親が相続放棄しただけの孫は代襲相続人ではないので対象（被代襲者の欄が残っていても）", () => {
    const ps = [P("長男", "child", { renounced: true }), P("孫", "grandchild", { substituteOf: "長男" }), P("長女", "child")];
    expect(surcharged(ps, "孫")).toBe(true);
  });
  it("代襲相続人の孫が自分で相続放棄した場合は対象（遺贈や保険金で受け取ったとき）", () => {
    const ps = [P("長男", "child", { predeceased: true }), P("孫", "grandchild", { substituteOf: "長男", renounced: true }), P("長女", "child")];
    expect(surcharged(ps, "孫")).toBe(true);
  });
  it("親が生きている孫（被代襲者の欄だけ残っている）は対象", () => {
    const ps = [P("長男", "child"), P("孫", "grandchild", { substituteOf: "長男" })];
    expect(surcharged(ps, "孫")).toBe(true);
  });
  it("再代襲のひ孫は対象外", () => {
    const ps = [
      P("長男", "child", { predeceased: true }),
      P("孫", "grandchild", { substituteOf: "長男", predeceased: true }),
      P("ひ孫", "greatGrandchild", { substituteOf: "孫" }),
    ];
    expect(surcharged(ps, "ひ孫")).toBe(false);
  });
});

describe("壊れた入力への備え", () => {
  it("同じ id の人が大量に重複していても、すぐに終わり1人として数える", () => {
    // 重複をそのまま展開すると 8^7 通りの枝になる入力
    const ps: Person[] = [P("c", "child", { predeceased: true })];
    for (let level = 0; level < 7; level++) {
      for (let k = 0; k < 8; k++) {
        ps.push(P(`g${level}`, "grandchild", { substituteOf: level === 0 ? "c" : `g${level - 1}`, predeceased: level < 6 }));
      }
    }
    const t0 = Date.now();
    const r = determineHeirs(ps, "civil");
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(shares(ps, "civil")).toEqual({ g6: "1" });
    expect(r.count).toBe(1);
  });
  it("代襲の親子関係が輪になっていても止まる", () => {
    const ps = [
      P("長男", "child", { predeceased: true }),
      P("A", "grandchild", { substituteOf: "B", predeceased: true }),
      P("B", "grandchild", { substituteOf: "A", predeceased: true }),
      P("自分", "grandchild", { substituteOf: "自分" }),
      P("長女", "child"),
    ];
    expect(shares(ps, "civil")).toEqual({ 長女: "1" });
  });
});
