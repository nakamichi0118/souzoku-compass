/**
 * オラクル（oracle.ts）の確認。教科書どおりの答えが分かっている例で確かめる。
 * 実行：npx vitest run --root scripts/cases
 */
import { describe, expect, it } from "vitest";
import type { Scenario, Member, EstateItem } from "./scenario";
import {
  expected,
  sokusan,
  totalTaxFor,
  heirStructure,
  sharesOf,
  depthRate,
  rosenkaUnitPrice,
  condoCorrection,
  ageAt,
  isSupporter,
  smallPersonFails,
  TABLES,
} from "./oracle";

const DEATH = "2026-04-10";
function mem(id: string, relation: Member["relation"], birthDate = "1970-01-01", extra: Partial<Member> = {}): Member {
  return { id, name: id, relation, birthDate, ...extra };
}
function scen(
  members: Member[],
  estate: EstateItem[],
  shares: Record<string, [string, number, number][]> | null,
  extra: Partial<Scenario> = {},
): Scenario {
  return {
    id: "t",
    title: "テスト",
    tags: [],
    decedent: { name: "被相続人", birthDate: "1945-01-01", deathDate: DEATH, address: "東京都" },
    members,
    estate,
    debts: [],
    gifts: [],
    division:
      shares === null
        ? { kind: "undivided" }
        : {
            kind: "agreed",
            shares: Object.fromEntries(Object.entries(shares).map(([k, v]) => [k, v.map(([who, n, d]) => ({ who, n, d }))])),
          },
    ...extra,
  };
}
const cash = (id: string, amount: number): EstateItem => ({ id, type: "deposit", label: id, amount });
const pay = (e: ReturnType<typeof expected>, id: string): number => e.persons.find((p) => p.id === id)?.payable ?? -1;
const tp = (e: ReturnType<typeof expected>, id: string): number => e.persons.find((p) => p.id === id)?.taxablePrice ?? -1;

describe("相続税の総額（16条・速算表）", () => {
  it("配偶者と子2人：課税価格の合計1億円 → 630万円、2億円 → 2,700万円", () => {
    const shares = new Map([
      ["s", { n: 1n, d: 2n }],
      ["a", { n: 1n, d: 4n }],
      ["b", { n: 1n, d: 4n }],
    ]);
    expect(totalTaxFor(100_000_000, 48_000_000, shares).total).toBe(6_300_000);
    expect(totalTaxFor(200_000_000, 48_000_000, shares).total).toBe(27_000_000);
  });
  it("速算表", () => {
    expect(sokusan(10_000_000)).toBe(1_000_000);
    expect(sokusan(26_000_000)).toBe(3_400_000);
    expect(sokusan(76_000_000)).toBe(15_800_000);
    expect(sokusan(700_000_000)).toBe(313_000_000);
  });
});

describe("全体の計算", () => {
  it("配偶者と子2人が法定相続分どおり1億円 → 子が各157万5千円、配偶者0円", () => {
    const s = scen([mem("s", "spouse"), mem("a", "child"), mem("b", "child")], [cash("d", 100_000_000)], {
      d: [
        ["s", 1, 2],
        ["a", 1, 4],
        ["b", 1, 4],
      ],
    });
    const e = expected(s);
    expect(e.computable).toBe(true);
    expect(e.legalHeirCount).toBe(3);
    expect(e.basicDeduction).toBe(48_000_000);
    expect(e.totalTax).toBe(6_300_000);
    expect(pay(e, "s")).toBe(0);
    expect(pay(e, "a")).toBe(1_575_000);
    expect(pay(e, "b")).toBe(1_575_000);
    expect(e.filingRequired).toBe(true);
  });
  it("子1人だけで1億円 → 1,220万円", () => {
    const e = expected(scen([mem("a", "child")], [cash("d", 100_000_000)], { d: [["a", 1, 1]] }));
    expect(e.totalTax).toBe(12_200_000);
    expect(pay(e, "a")).toBe(12_200_000);
  });
  it("配偶者と子1人、2億円を配偶者が全部 → 総額 2,700万円？ではなく基礎控除4,200万で計算", () => {
    // 課税遺産総額 1億5,800万 → 各7,900万 → 7,900万×30%−700万 = 1,670万 ×2 = 3,340万
    const e = expected(scen([mem("s", "spouse"), mem("a", "child")], [cash("d", 200_000_000)], { d: [["s", 1, 1]] }));
    expect(e.totalTax).toBe(33_400_000);
    // 配偶者は1億6千万まで軽減：3,340万×1.6億/2億 = 2,672万 → 納付 668万
    expect(pay(e, "s")).toBe(6_680_000);
  });
  it("未分割：法定相続分で課税価格、配偶者の税額軽減なし", () => {
    const e = expected(scen([mem("s", "spouse"), mem("a", "child"), mem("b", "child")], [cash("d", 100_000_000)], null));
    expect(tp(e, "s")).toBe(50_000_000);
    expect(pay(e, "s")).toBe(3_150_000);
    expect(pay(e, "a")).toBe(1_575_000);
  });
  it("2割加算：兄弟姉妹（全血・半血）", () => {
    const s = scen([mem("x", "sibling"), mem("y", "sibling", "1972-01-01", { halfBlood: true })], [cash("d", 90_000_000)], {
      d: [
        ["x", 2, 3],
        ["y", 1, 3],
      ],
    });
    const h = sharesOf(heirStructure(s.members, false), false);
    expect(h.get("x")).toEqual({ n: 2n, d: 3n });
    expect(h.get("y")).toEqual({ n: 1n, d: 3n });
    const e = expected(s);
    // 基礎控除4,200万、課税遺産総額4,800万 → x 3,200万→440万、y 1,600万→190万 → 630万
    expect(e.totalTax).toBe(6_300_000);
    expect(pay(e, "x")).toBe(5_040_000); // 420万×1.2
    expect(pay(e, "y")).toBe(2_520_000); // 210万×1.2
  });
  it("代襲相続：先に死亡した子の子2人", () => {
    const ms = [
      mem("a", "child"),
      mem("b", "child", "1968-01-01", { predeceased: true }),
      mem("g1", "grandchild", "1995-01-01", { substituteOf: "b" }),
      mem("g2", "grandchild", "1997-01-01", { substituteOf: "b" }),
    ];
    const h = sharesOf(heirStructure(ms, false), false);
    expect(h.get("a")).toEqual({ n: 1n, d: 2n });
    expect(h.get("g1")).toEqual({ n: 1n, d: 4n });
    const e = expected(
      scen(ms, [cash("d", 100_000_000)], {
        d: [
          ["a", 1, 2],
          ["g1", 1, 4],
          ["g2", 1, 4],
        ],
      }),
    );
    expect(e.legalHeirCount).toBe(3);
    // 代襲相続人の孫は2割加算なし
    expect(pay(e, "g1") * 2).toBe(pay(e, "a"));
  });
  it("養子の数の制限：実子1人・養子2人 → 法定相続人2人", () => {
    const ms = [mem("a", "child"), mem("p", "adoptedChild"), mem("q", "adoptedChild")];
    const e = expected(
      scen(ms, [cash("d", 100_000_000)], {
        d: [
          ["a", 1, 3],
          ["p", 1, 3],
          ["q", 1, 3],
        ],
      }),
    );
    expect(e.legalHeirCount).toBe(2);
    expect(e.basicDeduction).toBe(42_000_000);
  });
  it("子が全員放棄 → 父母が相続人。15条の数は放棄がなかったものとして子で数える", () => {
    const ms = [
      mem("a", "child", "1970-01-01", { renounced: true }),
      mem("b", "child", "1972-01-01", { renounced: true }),
      mem("f", "parent", "1920-01-01"),
    ];
    const civ = sharesOf(heirStructure(ms, false), false);
    expect([...civ.keys()]).toEqual(["f"]);
    const e = expected(scen(ms, [cash("d", 60_000_000)], { d: [["f", 1, 1]] }));
    expect(e.legalHeirCount).toBe(2);
    expect(e.basicDeduction).toBe(42_000_000);
  });
  it("生命保険金の非課税（500万円×法定相続人の数）と放棄者", () => {
    const ms = [mem("s", "spouse"), mem("a", "child"), mem("b", "child", "1975-01-01", { renounced: true })];
    const estate: EstateItem[] = [
      cash("d", 60_000_000),
      { id: "i1", type: "insurance", label: "保険1", amount: 20_000_000, recipient: "s" },
      { id: "i2", type: "insurance", label: "保険2", amount: 10_000_000, recipient: "b" },
    ];
    const e = expected(
      scen(ms, estate, {
        d: [
          ["s", 1, 2],
          ["a", 1, 2],
        ],
      }),
    );
    // 非課税限度 1,500万（法定相続人3人）。相続人の受取は配偶者2,000万だけ → 1,500万非課税
    expect(tp(e, "s")).toBe(30_000_000 + 5_000_000);
    expect(tp(e, "b")).toBe(10_000_000); // 放棄者は非課税なし
  });
  it("未成年者控除：15歳 → 30万円", () => {
    expect(ageAt("2011-01-01", DEATH)).toBe(15);
    const ms = [mem("a", "child"), mem("m", "child", "2011-01-01")];
    const e = expected(
      scen(ms, [cash("d", 100_000_000)], {
        d: [
          ["a", 1, 2],
          ["m", 1, 2],
        ],
      }),
    );
    expect(pay(e, "a")).toBe(3_850_000);
    expect(pay(e, "m")).toBe(3_550_000);
  });
  it("相次相続控除", () => {
    // A=1,000万 B=1億 C=8,000万 E=3：総額 = 1,000万×(8,000万/9,000万)×7/10 = 6,222,222
    const ms = [mem("a", "child"), mem("b", "child")];
    const e = expected(
      scen(
        ms,
        [cash("d", 80_000_000)],
        {
          d: [
            ["a", 1, 2],
            ["b", 1, 2],
          ],
        },
        {
          decedent: {
            name: "x",
            birthDate: "1940-01-01",
            deathDate: DEATH,
            address: "",
            priorInheritance: { yearsAgo: 3, prevTax: 10_000_000, prevAcquired: 100_000_000 },
          },
        },
      ),
    );
    // 総額：基礎控除4,200万 → 3,800万 → 各1,900万→235万 → 470万。各235万 − 相次 3,111,111 → 0
    expect(e.totalTax).toBe(4_700_000);
    expect(pay(e, "a")).toBe(0);
  });
  it("3年以内の贈与加算（3年前の同じ日以後）と贈与税額控除", () => {
    const ms = [mem("a", "child")];
    const e = expected(
      scen(
        ms,
        [cash("d", 50_000_000)],
        { d: [["a", 1, 1]] },
        {
          gifts: [
            // 同じ令和5年の贈与2回（合計810万円、特例税率で贈与税120万円）。加算するのは3年前の同じ日の分だけ
            { to: "a", date: "2023-04-10", amount: 3_100_000, giftTaxPaid: 459_259 },
            { to: "a", date: "2023-04-09", amount: 5_000_000, giftTaxPaid: 740_741 },
          ],
        },
      ),
    );
    expect(tp(e, "a")).toBe(53_100_000);
    // 基礎控除3,600万 → 1,710万 → 15%−50万 = 2,065,000
    // 贈与税額控除 = 120万 × 310万/810万 = 459,259 → 1,605,741 → 1,605,700
    expect(pay(e, "a")).toBe(1_605_700);
  });
  it("相続時精算課税：令和6年以後は年110万円控除後を加算、贈与税は還付", () => {
    const ms = [mem("a", "child"), mem("g", "grandchild", "2000-01-01")];
    const e = expected(
      scen(
        ms,
        [cash("d", 30_000_000)],
        { d: [["a", 1, 1]] },
        {
          gifts: [{ to: "g", date: "2024-05-01", amount: 31_100_000, giftTaxPaid: 1_000_000, settlement: true }],
        },
      ),
    );
    expect(tp(e, "g")).toBe(30_000_000);
    expect(e.totalTaxablePrice).toBe(60_000_000);
  });
});

describe("土地・マンションの評価", () => {
  it("補正率表の形（付表1は29区分、付表6は8区分、付表7は8区分）", () => {
    for (const v of Object.values(TABLES.DEPTH_TABLE)) expect(v.length).toBe(TABLES.DEPTH_UPPER.length + 1);
    for (const v of Object.values(TABLES.FRONTAGE_TABLE)) expect(v.length).toBe(TABLES.FRONTAGE_UPPER.length + 1);
    for (const v of Object.values(TABLES.LONG_TABLE)) expect(v.length).toBe(TABLES.LONG_LOWER.length + 1);
  });
  it("奥行価格補正率（付表1）", () => {
    expect(depthRate("普通住宅地区", 9.9)).toBe(97);
    expect(depthRate("普通住宅地区", 10)).toBe(100);
    expect(depthRate("普通住宅地区", 25)).toBe(97);
    expect(depthRate("普通住宅地区", 30)).toBe(95);
    expect(depthRate("普通商業・併用住宅地区", 33)).toBe(97);
    expect(depthRate("高度商業地区", 50)).toBe(99);
    expect(depthRate("中小工場地区", 62)).toBe(99);
    expect(depthRate("ビル街地区", 100)).toBe(95);
  });
  it("角地（側方路線影響加算）", () => {
    const r = rosenkaUnitPrice("普通住宅地区", [
      { position: "front", price: 300_000, depth: 20, frontage: 15, leaseLetter: "C" },
      { position: "side", price: 200_000, depth: 15, frontage: 20, leaseLetter: "C" },
    ]);
    expect(r.unit).toBe(306_000);
  });
  it("正面路線の選び直し（路線価×奥行補正率の高い方）と奥行長大補正", () => {
    const r = rosenkaUnitPrice("普通住宅地区", [
      { position: "front", price: 200_000, depth: 30, frontage: 10, leaseLetter: "D" },
    ]);
    // 200,000×0.95 = 190,000 → 奥行長大（30/10=3）0.96 → 182,400
    expect(r.unit).toBe(182_400);
  });
  it("居住用の区分所有財産（国税庁 タックスアンサー No.4667 の計算例）", () => {
    const c: EstateItem = {
      id: "c",
      type: "condo",
      label: "マンション",
      landValue: 10_500_000,
      buildingFixedAssetValue: 4_000_000,
      builtYears: 27,
      builtMonths: 0,
      totalFloors: 11,
      floor: 3,
      landShareSqm: 21,
      exclusiveAreaSqm: 60,
    };
    if (c.type !== "condo") throw new Error();
    const cc = condoCorrection(c);
    expect(cc.divergenceE3).toBe(2043);
    expect(cc.rate).toEqual({ n: 6129n, d: 5000n }); // 1.2258
    const e = expected(scen([mem("a", "child")], [c], { c: [["a", 1, 1]] }));
    expect(tp(e, "a")).toBe(floorK(4_903_200 + 12_870_900));
  });
  it("小規模宅地等（特定居住用 200㎡・80%）", () => {
    const land: EstateItem = {
      id: "l",
      type: "land",
      label: "自宅",
      areaSqm: 200,
      landUse: "宅地",
      valuation: {
        kind: "rosenka",
        district: "普通住宅地区",
        roads: [{ position: "front", price: 300_000, depth: 20, frontage: 10, leaseLetter: "C" }],
      },
      use: "self",
      smallLand: { kind: "residence", acquirer: "s" },
    };
    const e = expected(
      scen([mem("s", "spouse"), mem("a", "child")], [land, cash("d", 40_000_000)], { l: [["s", 1, 1]], d: [["a", 1, 1]] }),
    );
    // 300,000×1.00×0.98（奥行長大 20/10=2）= 294,000 ×200 = 58,800,000 → 減額 47,040,000
    expect(tp(e, "s")).toBe(11_760_000);
  });
  it("小規模宅地等の限度面積の調整（特定居住用と貸付事業用）", () => {
    const home: EstateItem = {
      id: "h",
      type: "land",
      label: "自宅",
      areaSqm: 330,
      landUse: "宅地",
      valuation: { kind: "multiplier", fixedAssetValue: 30_000_000, rate: 1.1 },
      use: "self",
      smallLand: { kind: "residence", acquirer: "a" },
    };
    const apt: EstateItem = {
      id: "p",
      type: "land",
      label: "アパート",
      areaSqm: 200,
      landUse: "宅地",
      valuation: { kind: "multiplier", fixedAssetValue: 100_000_000, rate: 1.1, leaseRatio: 0.5 },
      use: "rentedHouse",
      smallLand: { kind: "rental", acquirer: "a" },
    };
    const e = expected(scen([mem("a", "child")], [home, apt], { h: [["a", 1, 1]], p: [["a", 1, 1]] }));
    // 自宅 3,300万（1㎡10万）、アパート 1億1,000万×(1−0.15)=9,350万（1㎡46.75万）
    // 居住用330㎡：減額 2,640万。貸付200㎡：減額 4,675万 → 貸付を選ぶ方が得
    expect(tp(e, "a")).toBe(33_000_000 + 93_500_000 - 46_750_000);
  });
});

function floorK(x: number): number {
  return Math.floor(x / 1000) * 1000;
}

/* ------------------------------------------------------------------ */
/* 見直しで直した決まり（扶養義務者・空室・貸家建付借地権・前の控除・穴埋め・還付・代償金・正面路線・補正率） */
/* ------------------------------------------------------------------ */

type LandItem = Extract<EstateItem, { type: "land" }>;
function landR(id: string, roads: LandItem["valuation"] extends infer V ? (V extends { kind: "rosenka"; roads: infer R } ? R : never) : never, area: number, extra: Partial<LandItem> = {}): EstateItem {
  return { id, type: "land", label: id, areaSqm: area, landUse: "宅地", valuation: { kind: "rosenka", district: "普通住宅地区", roads }, use: "self", ...extra } as EstateItem;
}
const ref = (e: ReturnType<typeof expected>, id: string): number => e.persons.find((p) => p.id === id)?.refund ?? 0;

describe("扶養義務者（相基通1の2-1：配偶者・直系血族・兄弟姉妹）", () => {
  const sp = mem("sp", "spouse");
  const c1 = mem("c1", "child");
  const c2 = mem("c2", "child", "1975-01-01", { predeceased: true });
  const g1 = mem("g1", "grandchild", "2021-01-01", { substituteOf: "c2" });
  const g2 = mem("g2", "grandchild", "2006-01-01", { substituteOf: "c2" });
  // c3（先に亡くなった子）は g3 の被代襲者。人としては使わない
  mem("c3", "child", "1976-01-01", { predeceased: true });
  const g3 = mem("g3", "grandchild", "2004-01-01", { substituteOf: "c3" });
  const fa = mem("fa", "parent", "1940-01-01");
  const mo = mem("mo", "parent", "1942-01-01");
  const gp = mem("gp", "grandparent", "1920-01-01");
  const sFull = mem("sf", "sibling");
  const sHalf = mem("sh", "sibling", "1971-01-01", { halfBlood: true });
  const sHalf2 = mem("sh2", "sibling", "1972-01-01", { halfBlood: true });
  const o = mem("o", "other");
  it("子：配偶者（親）・ほかの子・亡くなった方の父母祖父母。兄弟姉妹（おじ・おば）・受遺者は含めない", () => {
    expect([sp, c1, fa, gp].every((q) => isSupporter(mem("x", "child"), q))).toBe(true);
    expect(isSupporter(mem("x", "child"), mem("y", "adoptedChild"))).toBe(true);
    expect([sFull, o, g3, c2].some((q) => isSupporter(mem("x", "child"), q))).toBe(false);
  });
  it("代襲相続人の孫：配偶者（祖母）・同じ親の兄弟。おじ（亡くなった方の子）・いとこは含めない", () => {
    expect(isSupporter(g1, sp)).toBe(true);
    expect(isSupporter(g1, g2)).toBe(true);
    expect(isSupporter(g1, fa)).toBe(true);
    expect(isSupporter(g1, c1)).toBe(false);
    expect(isSupporter(g1, g3)).toBe(false);
  });
  it("配偶者：子と代襲相続人。亡くなった方の父母・兄弟姉妹（姻族）は含めない", () => {
    expect(isSupporter(sp, c1)).toBe(true);
    expect(isSupporter(sp, g1)).toBe(true);
    expect(isSupporter(sp, fa)).toBe(false);
    expect(isSupporter(sp, sFull)).toBe(false);
    expect(isSupporter(sp, mem("gx", "grandchild", "2000-01-01"))).toBe(false);
  });
  it("父母：ほかの父母と全血の兄弟姉妹。半血・配偶者・祖父母は含めない", () => {
    expect(isSupporter(mo, fa)).toBe(true);
    expect(isSupporter(mo, sFull)).toBe(true);
    expect(isSupporter(mo, sHalf)).toBe(false);
    expect(isSupporter(mo, sp)).toBe(false);
    expect(isSupporter(mo, gp)).toBe(false);
  });
  it("兄弟姉妹：どちらかが全血なら兄弟姉妹、半血どうしは含めない。父母は本人が全血のときだけ", () => {
    expect(isSupporter(sHalf, sFull)).toBe(true);
    expect(isSupporter(sFull, sHalf)).toBe(true);
    expect(isSupporter(sHalf, sHalf2)).toBe(false);
    expect(isSupporter(sFull, mo)).toBe(true);
    expect(isSupporter(sHalf, mo)).toBe(false);
  });
  it("甥姪：同じ親の甥姪だけ。おじ・おば（亡くなった方の兄弟姉妹）・いとこは含めない", () => {
    const n1 = mem("n1", "nephewNiece", "2016-01-01", { substituteOf: "bx" });
    const n2 = mem("n2", "nephewNiece", "2000-01-01", { substituteOf: "bx" });
    const n3 = mem("n3", "nephewNiece", "1990-01-01", { substituteOf: "by" });
    expect(isSupporter(n1, n2)).toBe(true);
    expect(isSupporter(n1, n3)).toBe(false);
    expect(isSupporter(n1, sFull)).toBe(false);
  });
  it("先に亡くなった人は扶養義務者にならない", () => {
    expect(isSupporter(g1, mem("sp0", "spouse", "1950-01-01", { predeceased: true }))).toBe(false);
  });
  it("特別障害者の配偶者（子なし）：控除しきれない分を亡くなった方の兄弟姉妹から引かない", () => {
    const ms = [mem("s", "spouse", "1956-01-01", { disability: "special" }), mem("b1", "sibling"), mem("b2", "sibling", "1972-01-01")];
    const e = expected(scen(ms, [cash("d1", 96_000_000), cash("d2", 24_000_000)], { d1: [["s", 1, 1]], d2: [["b1", 1, 2], ["b2", 1, 2]] }));
    // 基礎控除4,800万 → 7,200万：配偶者5,400万→920万、兄弟各900万→90万 → 総額1,100万。兄弟は110万×1.2 = 132万（振替なし）
    expect(e.totalTax).toBe(11_000_000);
    expect(pay(e, "b1")).toBe(1_320_000);
    expect(pay(e, "b2")).toBe(1_320_000);
    expect(pay(e, "s")).toBe(0);
  });
  it("未成年の代襲相続人（5歳）：控除しきれない分は同じ親の兄から引き、おじからは引かない", () => {
    const ms = [mem("s", "spouse", "1957-01-01"), mem("c1", "child"), c2, g1, g2];
    const e = expected(
      scen(ms, [cash("d1", 70_000_000), cash("d2", 35_000_000), cash("d3", 1_000_000), cash("d4", 34_000_000)], {
        d1: [["s", 1, 1]],
        d2: [["c1", 1, 1]],
        d3: [["g1", 1, 1]],
        d4: [["g2", 1, 1]],
      }),
    );
    // 基礎控除5,400万 → 8,600万：配偶者4,300万→660万、子2,150万→272.5万、孫各1,075万→111.25万 → 総額1,155万
    expect(e.totalTax).toBe(11_550_000);
    // おじ（c1）は 1,155万×35/140 = 2,887,500 のまま（配偶者は税額軽減で0なので引く先にならない）
    expect(pay(e, "c1")).toBe(2_887_500);
    // g1：算出 82,500、控除130万 → 不足 1,217,500 を兄 g2（2,805,000）から → 1,587,500
    expect(pay(e, "g1")).toBe(0);
    expect(pay(e, "g2")).toBe(1_587_500);
  });
  it("特別障害者の母：控除しきれない分を父と全血の兄弟から引き、半血の兄・配偶者からは引かない", () => {
    const ms = [mem("s", "spouse", "1978-01-01"), fa, mem("mo", "parent", "1950-01-01", { disability: "special" }), sFull, sHalf];
    const deps = [cash("d1", 100_000_000), cash("d2", 30_000_000), cash("d3", 2_000_000), cash("d4", 10_000_000), cash("d5", 10_000_000)];
    const e = expected(scen(ms, deps, { d1: [["s", 1, 1]], d2: [["fa", 1, 1]], d3: [["mo", 1, 1]], d4: [["sf", 1, 1]], d5: [["sh", 1, 1]] }));
    // 総額 17,999,800。半血の兄は 17,999,800×10/152 = 1,184,197 ×1.2 → 1,421,036 → 1,421,000（振替なし）
    expect(e.totalTax).toBe(17_999_800);
    expect(pay(e, "sh")).toBe(1_421_000);
    expect(pay(e, "mo")).toBe(0);
    // 母の不足 1,800,000 − 236,839 = 1,563,161 を父（3,552,592）と全血の兄弟（1,421,036）が相続税額の比で
    expect(pay(e, "fa") + pay(e, "sf")).toBeLessThanOrEqual(3_552_592 + 1_421_036 - 1_563_161);
    expect(pay(e, "fa") + pay(e, "sf")).toBeGreaterThan(3_552_592 + 1_421_036 - 1_563_161 - 200);
    expect(pay(e, "sf")).toBeLessThan(1_421_000);
  });
});

describe("前の相続でも受けた未成年者控除・障害者控除（19条の3第3項・19条の4第3項、相基通19の3-5）", () => {
  const two = (m2: Member): Scenario =>
    scen([mem("a", "child"), m2], [cash("d", 100_000_000)], { d: [["a", 1, 2], [m2.id, 1, 2]] });
  // 基礎控除4,200万 → 5,800万、各2,900万 → 385万。総額770万、各人の算出税額 385万
  it("前の相続で最初の控除額（9歳→90万円）を使い切った → 今回は0円", () => {
    const e = expected(two(mem("m", "child", "2014-03-01", { priorMinorCredit: { date: "2023-04-10", amount: 900_000 } })));
    expect(pay(e, "m")).toBe(3_850_000);
  });
  it("一部だけ使った：最初の控除額 − 控除済み の残りまで（今回の60万円より少なければ残り）", () => {
    expect(pay(expected(two(mem("m", "child", "2014-03-01"))), "m")).toBe(3_250_000);
    expect(pay(expected(two(mem("m", "child", "2014-03-01", { priorMinorCredit: { date: "2023-04-10", amount: 300_000 } }))), "m")).toBe(3_250_000);
    expect(pay(expected(two(mem("m", "child", "2014-03-01", { priorMinorCredit: { date: "2023-04-10", amount: 500_000 } }))), "m")).toBe(3_450_000);
  });
  it("前の相続が令和4年3月以前でも、今回の相続が令和4年4月以後なら18歳までの年数で計算（相基通19の3-5（注）(2)）", () => {
    // 2021-09-15 に8歳 → 10万×(18−8)=100万 − 控除済み65万 = 35万（今回の控除額50万より少ない）
    const e = expected(two(mem("m", "child", "2013-03-01", { priorMinorCredit: { date: "2021-09-15", amount: 650_000 } })));
    expect(pay(e, "m")).toBe(3_500_000);
  });
  it("障害者控除：前の相続（44歳）の最初の控除額410万円 − 控除済み200万円 = 210万円まで", () => {
    const e = expected(two(mem("m", "child", "1975-08-01", { disability: "general", priorDisabilityCredit: { date: "2020-03-01", amount: 2_000_000 } })));
    expect(pay(e, "m")).toBe(1_750_000);
  });
  // 1960-05-01 生まれ：前の相続 2021-04-10 に60歳（X）、今回 2026-04-10 に65歳（Y）。今回の特別障害者の控除額は 20万×20 = 400万
  it("前の相続のときは一般障害者で今は特別障害者：{20万×(85−Y)＋10万×(Y−X)} − A（相基通19の4-4）", () => {
    const m = mem("m", "child", "1960-05-01", { disability: "special", priorDisabilityCredit: { date: "2021-04-10", amount: 2_500_000, special: false } });
    // 20万×20 + 10万×5 = 450万 − 250万 = 200万（今回の400万より少ない）。算出税額385万 − 200万
    expect(pay(expected(two(m)), "m")).toBe(1_850_000);
    // 区分を書かなければ今と同じ（特別）だったものとして 20万×25 − 250万 = 250万
    const same = mem("m", "child", "1960-05-01", { disability: "special", priorDisabilityCredit: { date: "2021-04-10", amount: 2_500_000 } });
    expect(pay(expected(two(same)), "m")).toBe(1_350_000);
  });
  it("前の相続のときは特別障害者で今は一般障害者：限度は最初の相続のときの 20万×(85−X)", () => {
    // 20万×25 = 500万 − 300万 = 200万。今回の一般障害者の控除額 10万×20 = 200万 → 200万
    const m = mem("m", "child", "1960-05-01", { disability: "general", priorDisabilityCredit: { date: "2021-04-10", amount: 3_000_000, special: true } });
    expect(pay(expected(two(m)), "m")).toBe(1_850_000);
    // 400万控除済みなら 100万まで
    const m2 = mem("m", "child", "1960-05-01", { disability: "general", priorDisabilityCredit: { date: "2021-04-10", amount: 4_000_000, special: true } });
    expect(pay(expected(two(m2)), "m")).toBe(2_850_000);
  });
  it("控除済みの額がそのときの区分で受けられる額を超える（入力の矛盾）→ 計算の対象外", () => {
    // 今と同じ一般障害者なら最初の相続のときの額は 10万×25 = 250万。300万は受けられない
    const m = mem("m", "child", "1960-05-01", { disability: "general", priorDisabilityCredit: { date: "2021-04-10", amount: 3_000_000 } });
    const e = expected(two(m));
    expect(e.computable).toBe(false);
    expect(e.outOfScope).toContain("障害者控除");
  });
});

describe("一部が空室の貸付事業用宅地等（貸している部分だけ）", () => {
  it("国税庁の例：自用地4,000万円・借地権割合0.7・賃貸割合0.9 → 貸している部分 2,844万円、減額 1,422万円、課税価格に入る額 1,822万円", () => {
    const land = landR("l", [{ position: "front", price: 200_000, depth: 16, frontage: 12.5, leaseLetter: "C" }], 200, {
      use: "rentedHouse",
      rentRatio: 0.9,
      smallLand: { kind: "rental", acquirer: "a" },
    });
    const e = expected(scen([mem("a", "child")], [land], { l: [["a", 1, 1]] }));
    // 評価額 4,000万×(1−0.7×0.3×0.9) = 3,244万。空室の部分 400万（自用地）は特例の外
    expect(tp(e, "a")).toBe(18_220_000);
  });
  it("賃貸中のマンション（賃貸割合0.5）：敷地の貸している部分 = 敷地利用権 × 0.5 × (1−0.6×0.3)", () => {
    const condo: EstateItem = {
      id: "m",
      type: "condo",
      label: "マンション",
      landValue: 20_000_000,
      buildingFixedAssetValue: 5_000_000,
      builtYears: 20,
      builtMonths: 0,
      totalFloors: 2,
      floor: 1,
      landShareSqm: 30,
      exclusiveAreaSqm: 60,
      rented: true,
      smallLand: { kind: "rental", acquirer: "a" },
    };
    Object.assign(condo, { leaseRatio: 0.6, rentRatio: 0.5 });
    const e = expected(scen([mem("a", "child")], [condo], { m: [["a", 1, 1]] }));
    // 建物 425万、敷地 2,000万×(1−0.09) = 1,820万、貸している部分 820万 → 減額 410万
    expect(tp(e, "a")).toBe(4_250_000 + 18_200_000 - 4_100_000);
  });
  it("貸家建付借地権（評基通28）：自用地×借地権割合×(1−0.3×賃貸割合)、貸付事業用は 自用地×借地権割合×賃貸割合×0.7（200㎡まで）", () => {
    const land = landR("l", [{ position: "front", price: 300_000, depth: 20, frontage: 15, leaseLetter: "D" }], 300, {
      use: "rentedLeasehold",
      rentRatio: 0.8,
      smallLand: { kind: "rental", acquirer: "a" },
    });
    const e = expected(scen([mem("a", "child")], [land], { l: [["a", 1, 1]] }));
    // 9,000万×0.6×(1−0.24) = 4,104万。貸している部分 9,000万×0.6×0.8×0.7 = 3,024万（240㎡）→ 200㎡分 2,520万の50% = 1,260万
    expect(tp(e, "a")).toBe(41_040_000 - 12_600_000);
  });
});

describe("一部未分割（穴埋め方式）", () => {
  it("自宅を配偶者が取得、残りの未分割は 法定相続分×合計 − 取得額 の不足分の割合で", () => {
    const ms = [mem("s", "spouse"), mem("a", "child"), mem("b", "child", "1972-01-01")];
    const sc = scen(ms, [cash("d1", 60_000_000), cash("d2", 20_000_000), cash("d3", 40_000_000)], { d1: [["s", 1, 1]], d2: [["b", 1, 1]] });
    if (sc.division.kind === "agreed") sc.division.partlyUndivided = true;
    const e = expected(sc);
    // T=1.2億：配偶者 6,000万−6,000万=0、a 3,000万−0、b 3,000万−2,000万=1,000万 → 未分割4,000万を 3:1
    expect(tp(e, "s")).toBe(60_000_000);
    expect(tp(e, "a")).toBe(30_000_000);
    expect(tp(e, "b")).toBe(30_000_000);
    expect(pay(e, "a")).toBe(2_400_000);
    expect(pay(e, "s")).toBe(0);
  });
  it("1つの財産の持分の一部だけ決まった：残りの持分を不足分の割合で（法定相続分を超えた人は0）", () => {
    const ms = [mem("a", "child"), mem("b", "child", "1972-01-01"), mem("c", "child", "1974-01-01")];
    const sc = scen(ms, [cash("d1", 50_000_000), cash("d2", 30_000_000)], { d1: [["a", 1, 2]], d2: [["b", 1, 1]] });
    if (sc.division.kind === "agreed") sc.division.partlyUndivided = true;
    const e = expected(sc);
    // T=8,000万、各1/3：a 1/3×8,000万−2,500万、b は超えるので0、c 1/3×8,000万 → 2,500万を 5:80
    expect(tp(e, "a")).toBe(26_470_000);
    expect(tp(e, "b")).toBe(30_000_000);
    expect(tp(e, "c")).toBe(23_529_000);
  });
  it("一部分割で代償金を払った：代償金は払った人の取得額から引き、受け取った人の取得額に足して不足額を出す（相基通11の2-9）", () => {
    // 家6,000万を a が取得し b に代償金3,000万。預金6,000万は未分割。分割で得たもの a 3,000万・b 3,000万 → 未分割は半分ずつ
    const sc = scen([mem("a", "child", "1975-01-01"), mem("b", "child", "1978-01-01")], [cash("h", 60_000_000), cash("d", 60_000_000)], { h: [["a", 1, 1]] });
    if (sc.division.kind === "agreed") {
      sc.division.partlyUndivided = true;
      sc.division.compensation = [{ from: "a", to: "b", amount: 30_000_000 }];
    }
    const e = expected(sc);
    expect(tp(e, "a")).toBe(60_000_000);
    expect(tp(e, "b")).toBe(60_000_000);
  });
  it("代償金を時価をもとに決めたときは、評価額に直した額（代償金×評価額÷時価）で取得額を直す", () => {
    // 土地（評価2,000万、時価3,000万）を a が取得し b に1,500万（評価額に直して1,000万）。預金4,000万は未分割。
    // T=6,000万：a 3,000万 −（2,000万−1,000万）= 2,000万、b 3,000万 − 1,000万 = 2,000万 → 未分割は半分ずつ
    const land: EstateItem = { id: "l", type: "land", label: "土地", areaSqm: 200, landUse: "宅地", valuation: { kind: "multiplier", fixedAssetValue: 20_000_000, rate: 1 }, use: "self" };
    const sc = scen([mem("a", "child", "1975-01-01"), mem("b", "child", "1978-01-01")], [land, cash("d", 40_000_000)], { l: [["a", 1, 1]] });
    if (sc.division.kind === "agreed") {
      sc.division.partlyUndivided = true;
      sc.division.compensation = [{ from: "a", to: "b", amount: 15_000_000, basis: { item: "l", marketValue: 30_000_000 } }];
    }
    const e = expected(sc);
    expect(tp(e, "a")).toBe(30_000_000);
    expect(tp(e, "b")).toBe(30_000_000);
  });
  it("配偶者と兄弟（2割加算）：代償金を入れた不足額で分けると各人の課税価格と配偶者の軽減が変わる", () => {
    // 配偶者3/4・兄1/4。家4,000万を兄が取得し配偶者に代償金2,000万。預金8,000万は未分割。
    // 分割で得たもの 配偶者2,000万・兄2,000万、T=1.2億：不足 7,000万・1,000万 → 未分割8,000万を 7:1
    const sc = scen([mem("s", "spouse"), mem("x", "sibling", "1950-01-01")], [cash("h", 40_000_000), cash("d", 80_000_000)], { h: [["x", 1, 1]] });
    if (sc.division.kind === "agreed") {
      sc.division.partlyUndivided = true;
      sc.division.compensation = [{ from: "x", to: "s", amount: 20_000_000 }];
    }
    const e = expected(sc);
    expect(tp(e, "s")).toBe(90_000_000);
    expect(tp(e, "x")).toBe(30_000_000);
    expect(pay(e, "s") + pay(e, "x")).toBe(11_461_200);
  });
});

describe("未分割の財産と相続時精算課税の贈与（相続税法55条・民法903条）", () => {
  it("国税庁の質疑応答事例：遺産10億円、A・Bが生計の資本として精算課税で1億円ずつ → 各人の課税価格3億円", () => {
    // （10億＋1億×2）×1/4 − 1億 = 2億（A・B）＋精算課税の1億 = 3億。C・D は（10億＋2億）×1/4 = 3億
    const ms = [mem("A", "child", "1960-01-01"), mem("B", "child", "1962-01-01"), mem("C", "child", "1964-01-01"), mem("D", "child", "1966-01-01")];
    const gifts = ["A", "B"].map((to) => ({ to, date: "2020-06-01", amount: 100_000_000, giftTaxPaid: 15_000_000, settlement: true }));
    const e = expected(scen(ms, [cash("d", 1_000_000_000)], null, { gifts }));
    expect(e.computable).toBe(true);
    for (const id of ["A", "B", "C", "D"]) expect(tp(e, id)).toBe(300_000_000);
    expect(e.totalTaxablePrice).toBe(1_200_000_000);
  });
  it("一部だけ分けたときも、精算課税の贈与を足した合計で穴埋めする。暦年課税の贈与は足さない", () => {
    // 子2人。預金A 4,000万を a が取得、預金B 6,000万は未分割。a が精算課税で2,000万（令和5年）。
    // T'=1.2億：a 6,000万 −（4,000万＋2,000万）= 0、b 6,000万 → 未分割は全部 b
    const ms = [mem("a", "child", "1975-01-01"), mem("b", "child", "1978-01-01")];
    const gifts = [{ to: "a", date: "2023-05-01", amount: 20_000_000, giftTaxPaid: 0, settlement: true }];
    const sc = scen(ms, [cash("d1", 40_000_000), cash("d2", 60_000_000)], { d1: [["a", 1, 1]] }, { gifts });
    if (sc.division.kind === "agreed") sc.division.partlyUndivided = true;
    const e = expected(sc);
    expect(tp(e, "a")).toBe(60_000_000);
    expect(tp(e, "b")).toBe(60_000_000);
    // 暦年課税の贈与（3年以内で加算される）なら未分割の分け方は変わらない：T=1億、a 5,000万−4,000万=1,000万、b 5,000万 → 1:5
    const cal = [{ to: "a", date: "2025-05-01", amount: 2_000_000, giftTaxPaid: 90_000 }];
    const sc2 = scen(ms, [cash("d1", 40_000_000), cash("d2", 60_000_000)], { d1: [["a", 1, 1]] }, { gifts: cal });
    if (sc2.division.kind === "agreed") sc2.division.partlyUndivided = true;
    const e2 = expected(sc2);
    expect(tp(e2, "a")).toBe(40_000_000 + 10_000_000 + 2_000_000);
    expect(tp(e2, "b")).toBe(50_000_000);
  });
  it("令和6年以後の精算課税の贈与は、特別受益には贈与の額そのもの、課税価格には110万円を引いた額", () => {
    // 子2人、遺産1億は全部未分割。a に2024年 1,000万 → T'=1.1億：a 5,500万−1,000万=4,500万、b 5,500万 → 9:11
    const ms = [mem("a", "child", "1975-01-01"), mem("b", "child", "1978-01-01")];
    const gifts = [{ to: "a", date: "2024-05-01", amount: 10_000_000, giftTaxPaid: 0, settlement: true }];
    const e = expected(scen(ms, [cash("d", 100_000_000)], null, { gifts }));
    expect(tp(e, "a")).toBe(45_000_000 + 8_900_000);
    expect(tp(e, "b")).toBe(55_000_000);
  });
});

describe("相続時精算課税の贈与税の還付と⑰の端数", () => {
  it("基礎控除以下でも、精算課税の贈与税が戻るときは申告が要る", () => {
    const e = expected(
      scen([mem("a", "child")], [cash("d", 5_000_000)], { d: [["a", 1, 1]] }, { gifts: [{ to: "a", date: "2019-06-01", amount: 28_000_000, giftTaxPaid: 600_000, settlement: true }] }),
    );
    expect(e.totalTaxablePrice).toBe(33_000_000);
    expect(e.totalTax).toBe(0);
    expect(ref(e, "a")).toBe(600_000);
    expect(e.filingRequired).toBe(true);
  });
  it("⑰ 精算課税分の贈与税額控除は100円未満を切り捨てる", () => {
    const e = expected(
      scen([mem("a", "child")], [cash("d", 5_000_000)], { d: [["a", 1, 1]] }, { gifts: [{ to: "a", date: "2019-06-01", amount: 28_000_000, giftTaxPaid: 600_050, settlement: true }] }),
    );
    expect(ref(e, "a")).toBe(600_000);
  });
  it("還付がなく基礎控除以下なら申告は要らない", () => {
    const e = expected(scen([mem("a", "child")], [cash("d", 30_000_000)], { d: [["a", 1, 1]] }));
    expect(e.filingRequired).toBe(false);
  });
});

describe("代償分割（相基通11の2-10）", () => {
  const land: EstateItem = { id: "l", type: "land", label: "土地", areaSqm: 200, landUse: "宅地", valuation: { kind: "multiplier", fixedAssetValue: 20_000_000, rate: 1 }, use: "self" };
  it("代償金を土地の時価をもとに決めた：代償金×評価額÷時価", () => {
    const sc = scen([mem("a", "child"), mem("b", "child", "1972-01-01")], [land, cash("d", 10_000_000)], { l: [["a", 1, 1]], d: [["a", 1, 1]] });
    if (sc.division.kind === "agreed") sc.division.compensation = [{ from: "a", to: "b", amount: 15_000_000, basis: { item: "l", marketValue: 30_000_000 } }];
    const e = expected(sc);
    // 1,500万 × 2,000万 ÷ 3,000万 = 1,000万
    expect(tp(e, "a")).toBe(20_000_000);
    expect(tp(e, "b")).toBe(10_000_000);
  });
  it("時価をもとにしていなければ額面", () => {
    const sc = scen([mem("a", "child"), mem("b", "child", "1972-01-01")], [land, cash("d", 10_000_000)], { l: [["a", 1, 1]], d: [["a", 1, 1]] });
    if (sc.division.kind === "agreed") sc.division.compensation = [{ from: "a", to: "b", amount: 15_000_000 }];
    expect(tp(expected(sc), "b")).toBe(15_000_000);
  });
  it("代償金を払う人が分割で遺産を取得していない → 計算の対象外（税理士に相談）", () => {
    const ms = [mem("a", "child"), mem("b", "child", "1972-01-01"), mem("c", "child", "1974-01-01")];
    const sc = scen(ms, [cash("d", 40_000_000), { id: "i", type: "insurance", label: "保険", amount: 20_000_000, recipient: "b" }], { d: [["a", 1, 1]] });
    if (sc.division.kind === "agreed") sc.division.compensation = [{ from: "b", to: "c", amount: 5_000_000 }];
    const e = expected(sc);
    expect(e.computable).toBe(false);
    expect(e.outOfScope).toContain("代償金");
  });
});

describe("正面路線の判定（路線価×奥行価格補正率が同じとき）", () => {
  it("間口の長い方を正面にする（質疑応答事例「正面路線の判定(1)」）。並べ方によらない", () => {
    const roads = [
      { position: "front" as const, price: 200_000, depth: 25, frontage: 12, leaseLetter: "D" as const },
      { position: "side" as const, price: 194_000, depth: 12, frontage: 25, leaseLetter: "D" as const },
    ];
    const r = rosenkaUnitPrice("普通住宅地区", roads);
    // 194,000（正面）+ 200,000×0.97×0.03 = 199,820。間口25m・奥行12mなので間口狭小・奥行長大なし
    expect(r.front.price).toBe(194_000);
    expect(r.unit).toBe(199_820);
    expect(rosenkaUnitPrice("普通住宅地区", [...roads].reverse()).unit).toBe(199_820);
  });
  it("間口も同じなら路線価の高い方（借地権割合もその路線の記号）", () => {
    const r = rosenkaUnitPrice("普通住宅地区", [
      { position: "front", price: 194_000, depth: 12, frontage: 20, leaseLetter: "D" },
      { position: "side", price: 200_000, depth: 25, frontage: 20, leaseLetter: "C" },
    ]);
    expect(r.front.leaseLetter).toBe("C");
    expect(r.unit).toBe(199_820);
  });
  it("すべて同じなら入力の順（正面・側方・裏面の順）", () => {
    const r = rosenkaUnitPrice("普通住宅地区", [
      { position: "back", price: 250_000, depth: 20, frontage: 15, leaseLetter: "D" },
      { position: "front", price: 250_000, depth: 20, frontage: 15, leaseLetter: "C" },
    ]);
    expect(r.front.leaseLetter).toBe("C");
    expect(r.unit).toBe(255_000);
  });
});

describe("税理士に確かめた補正率", () => {
  const one = (land: EstateItem) => expected(scen([mem("a", "child")], [land], { l: [["a", 1, 1]] }));
  const narrow = [{ position: "front" as const, price: 200_000, depth: 30, frontage: 5, leaseLetter: "D" as const }];
  it("不整形地：不整形地補正率だけを掛け、間口狭小・奥行長大は重ねない（評基通20-4・付表5（注）3）", () => {
    // 200,000×0.95 = 190,000 × 0.81 = 153,900 × 150㎡（間口狭小0.94・奥行長大0.92 は掛けない）
    const e = one(landR("l", narrow, 150, { needsReduction: "irregular", advisorRate: 0.81 }));
    expect(e.computable).toBe(true);
    expect(tp(e, "a")).toBe(23_085_000);
  });
  it("不整形地で補正率1（減額なし）は、間口狭小・奥行長大をふつうに掛ける（付表5（注）3：不整形地補正率は間口狭小×奥行長大を超えない）", () => {
    // 200,000×0.95 = 190,000 → 間口狭小0.94×奥行長大0.90 = 160,740 × 150㎡。条件を付けないときと同じで、高くはならない
    const e = one(landR("l", narrow, 150, { needsReduction: "irregular", advisorRate: 1 }));
    expect(e.computable).toBe(true);
    expect(tp(e, "a")).toBe(24_111_000);
    expect(tp(one(landR("l", narrow, 150)), "a")).toBe(24_111_000);
  });
  it("倍率方式の宅地は形がいびつでも 固定資産税評価額×倍率（評基通21-2）。雑種地は対象外のまま", () => {
    const m = (landUse: LandItem["landUse"]): EstateItem =>
      ({ id: "l", type: "land", label: "土地", areaSqm: 300, landUse, valuation: { kind: "multiplier", fixedAssetValue: 10_000_000, rate: 1.1 }, use: "self", needsReduction: "irregular" }) as EstateItem;
    const e = one(m("宅地"));
    expect(e.computable).toBe(true);
    expect(tp(e, "a")).toBe(11_000_000);
    expect(one(m("雑種地")).computable).toBe(false);
    // セットバックは止めず、減額しない評価額で計算する（相談するかは本人が選ぶ）
    const sb = { ...(m("宅地") as LandItem), needsReduction: "setback" as const };
    expect(one(sb).computable).toBe(true);
    expect(tp(one(sb), "a")).toBe(11_000_000);
  });
  it("補正率がなければ計算の対象外のまま", () => {
    expect(one(landR("l", narrow, 150, { needsReduction: "irregular" })).computable).toBe(false);
    // セットバックは補正率がなくても計算する（減額しない）。補正率があればそれを掛ける
    expect(one(landR("l", narrow, 150, { needsReduction: "setback" })).computable).toBe(true);
    expect(one(landR("l", narrow, 150, { needsReduction: "setback", advisorRate: 0.9 })).computable).toBe(true);
  });
  it("地積規模の大きな宅地：規模格差補正率は奥行長大の補正のあとに掛ける。補正率1も確かめた答え", () => {
    const roads = [{ position: "front" as const, price: 95_000, depth: 52.5, frontage: 20, leaseLetter: "E" as const }];
    // 95,000×0.88 = 83,600 → 奥行長大（52.5/20=2.6）0.98 → 81,928 → ×0.78 = 63,903 × 1,050㎡
    expect(tp(one(landR("l", roads, 1050, { needsReduction: "largeLot", advisorRate: 0.78 })), "a")).toBe(Math.floor(67_098_150 / 1000) * 1000);
    expect(tp(one(landR("l", roads, 1050, { needsReduction: "largeLot", advisorRate: 1 })), "a")).toBe(Math.floor((81_928 * 1050) / 1000) * 1000);
  });
});

/* ------------------------------------------------------------------ */
/* 小規模宅地等：1つの宅地を何人かで取得して、それぞれの持分に使う／使う面積を選ぶ（付表1の⑤）    */
/* ------------------------------------------------------------------ */

describe("小規模宅地等：共有で何人も使う・使う面積を選ぶ（措法69条の4、付表1）", () => {
  // 倍率方式の宅地（1㎡あたり10万円）。貸家建付地は借地権割合0.5（1㎡あたり 17万×0.85 … のように面積×単価で作る）
  const lot = (id: string, area: number, perSqm: number, extra: Partial<LandItem> = {}): EstateItem =>
    ({
      id,
      type: "land",
      label: id,
      areaSqm: area,
      landUse: "宅地",
      valuation: { kind: "multiplier", fixedAssetValue: area * perSqm, rate: 1, ...(extra.use === "rentedHouse" ? { leaseRatio: 0.5 } : {}) },
      use: "self",
      ...extra,
    }) as EstateItem;
  const notesOf = (e: ReturnType<typeof expected>) => e.notes.join("\n");

  it("取得した人ごとの要件（措法69条の4第3項）：配偶者は要件なし、同居の親族は住み続け・持ち続け、事業用・貸付用は続け・持ち続け", () => {
    expect(smallPersonFails("residence", { relation: "spouse" }, { livedTogether: false, keep: false })).toBeNull();
    expect(smallPersonFails("residence", { relation: "child" }, {})).toBeNull();
    expect(smallPersonFails("residence", { relation: "child" }, { livedTogether: false })).toMatch(/同居していない/);
    expect(smallPersonFails("residence", { relation: "child" }, { keep: false })).toMatch(/住み続け/);
    expect(smallPersonFails("rental", { relation: "spouse" }, { continues: false })).toMatch(/貸付事業/);
    expect(smallPersonFails("rental", { relation: "child" }, { keep: false })).toMatch(/持ち続けない/);
    expect(smallPersonFails("business", { relation: "child" }, { continues: false })).toMatch(/事業/);
    expect(smallPersonFails("business", { relation: "child" }, {})).toBeNull();
  });

  it("自宅400㎡を配偶者と同居の子が半分ずつ：330㎡までを子の持分（200㎡）から割り当て、配偶者は残り130㎡", () => {
    const run = (sSqm?: number, aSqm?: number) =>
      expected(
        scen(
          [mem("s", "spouse"), mem("a", "child")],
          [lot("h", 400, 100_000, { smallLand: { kind: "residence", acquirer: "s", selectedSqm: sSqm, others: [{ acquirer: "a", selectedSqm: aSqm }] } }), cash("d", 100_000_000), cash("e", 30_000_000)],
          {
            h: [
              ["s", 1, 2],
              ["a", 1, 2],
            ],
            d: [["a", 1, 1]],
            e: [["s", 1, 1]],
          },
        ),
      );
    // 子 200㎡・配偶者 130㎡（面積を入れて決めたとき）。子：2,000万 − 200㎡×10万×80%（1,600万） + 1億。配偶者：2,000万 − 130㎡×10万×80%（1,040万） + 3,000万
    const fixed = run(130, 200);
    expect(tp(fixed, "a")).toBe(104_000_000);
    expect(tp(fixed, "s")).toBe(39_600_000);
    // 面積を入れなければ、限度面積を2人のあいだで0.01㎡刻みで分け直して比べる（措法69条の4第1項：どの人の持分にどれだけ使うかは同意で選べる）。
    // 子 199.99㎡（減額 15,999,200）・配偶者 130.01㎡（10,400,800）にすると、課税価格は 104,000,800 → 104,000,000、39,599,200 → 39,599,000
    // （1,000円未満切捨て）で合計が1,000円下がり、法定相続分 50,799,500 → 50,799,000 で総額が 16,480,000 → 16,479,400。
    // 子の納付は 11,935,300 → 11,935,000（配偶者は税額軽減で0円）
    const free = run();
    expect(tp(free, "a")).toBe(104_000_000);
    expect(tp(free, "s")).toBe(39_599_000);
    expect(pay(fixed, "a")).toBe(11_935_300);
    expect(pay(free, "a")).toBe(11_935_000);
    expect(pay(free, "s")).toBe(0);
    expect(notesOf(free)).toMatch(/（residence、a）199\.99㎡/);
  });

  it("限度面積を分け直す：2人とも贈与税額控除を引ききれないときは、330㎡を2人に分ける", () => {
    // 自宅 660㎡（1㎡ 136,363.6…円 → 9,000万円）を同居の子2人が1/2ずつ。2人とも贈与 1,000万円（贈与税177万円）を加算する。
    // 1人に330㎡を寄せると、その人は算出税額（約97.6万）より控除が多く引ききれず、合計 1,054,300円。
    // 165㎡ずつなら課税価格 3,700万ずつ・算出税額 190万ずつ − 177万 → 13万ずつ、合計 260,000円（切捨てでさらに少し下がる）
    const h = lot("h", 660, 0, { valuation: { kind: "multiplier", fixedAssetValue: 90_000_000, rate: 1 }, smallLand: { kind: "residence", acquirer: "a", others: [{ acquirer: "b" }] } });
    const gifts = ["a", "b"].map((to) => ({ to, date: "2025-01-15", amount: 10_000_000, giftTaxPaid: 1_770_000 }));
    const e = expected(
      scen(
        [mem("a", "child"), mem("b", "child")],
        [h],
        {
          h: [
            ["a", 1, 2],
            ["b", 1, 2],
          ],
        },
        { gifts },
      ),
    );
    const total = e.persons.reduce((x, p) => x + p.payable, 0);
    expect(total).toBeLessThanOrEqual(260_000);
    expect(total).toBeGreaterThan(250_000);
    const areas = [...notesOf(e).matchAll(/（residence、[ab]）([\d.]+)㎡/g)].map((m) => Number(m[1]));
    expect(areas).toHaveLength(2);
    expect(Math.round(areas[0] * 100 + areas[1] * 100)).toBe(33_000);
  });

  it("配偶者と別居の子（持ち家あり）が共有：子の持分には使えず、配偶者の持分200㎡だけ", () => {
    const h = lot("h", 400, 100_000, { smallLand: { kind: "residence", acquirer: "s", others: [{ acquirer: "a", livedTogether: false }] } });
    const e = expected(
      scen([mem("s", "spouse"), mem("a", "child")], [h, cash("d", 100_000_000), cash("e", 30_000_000)], {
        h: [
          ["s", 1, 2],
          ["a", 1, 2],
        ],
        d: [["a", 1, 1]],
        e: [["s", 1, 1]],
      }),
    );
    expect(tp(e, "a")).toBe(120_000_000);
    expect(tp(e, "s")).toBe(34_000_000);
    expect(notesOf(e)).toMatch(/aの分）：亡くなる直前に同居していない/);
  });

  it("1人目に書いた人が要件を満たさなくても、2人目以降の人は自分の要件で使える", () => {
    const h = lot("h", 300, 100_000, { smallLand: { kind: "residence", acquirer: "a", livedTogether: false, others: [{ acquirer: "s" }] } });
    const e = expected(
      scen([mem("s", "spouse"), mem("a", "child")], [h, cash("d", 50_000_000)], {
        h: [
          ["a", 1, 3],
          ["s", 2, 3],
        ],
        d: [["a", 1, 1]],
      }),
    );
    expect(tp(e, "a")).toBe(10_000_000 + 50_000_000);
    expect(tp(e, "s")).toBe(20_000_000 - 16_000_000);
  });

  it("同居の子2人の共有で、1人は申告期限までに持分を売る：売る人の持分には使えない", () => {
    const h = lot("h", 200, 100_000, { smallLand: { kind: "residence", acquirer: "a", others: [{ acquirer: "b", keep: false }] } });
    const e = expected(
      scen([mem("a", "child"), mem("b", "child")], [h, cash("d", 60_000_000)], {
        h: [
          ["a", 1, 2],
          ["b", 1, 2],
        ],
        d: [
          ["a", 1, 2],
          ["b", 1, 2],
        ],
      }),
    );
    expect(tp(e, "a")).toBe(10_000_000 - 8_000_000 + 30_000_000);
    expect(tp(e, "b")).toBe(10_000_000 + 30_000_000);
  });

  it("使う面積を選ぶ：300㎡のうち150㎡だけ（付表1の⑤）→ 減額は150㎡分", () => {
    const h = lot("h", 300, 100_000, { smallLand: { kind: "residence", acquirer: "s", selectedSqm: 150 } });
    const e = expected(scen([mem("s", "spouse"), mem("a", "child")], [h, cash("d", 80_000_000)], { h: [["s", 1, 1]], d: [["a", 1, 1]] }));
    expect(tp(e, "s")).toBe(30_000_000 - 12_000_000);
  });

  it("使う面積の上限は持分に応ずる面積（③）まで：持分より広い面積を入れても③まで", () => {
    const h = lot("h", 300, 100_000, { smallLand: { kind: "residence", acquirer: "s", selectedSqm: 500 } });
    const e = expected(scen([mem("s", "spouse"), mem("a", "child")], [h, cash("d", 80_000_000)], { h: [["s", 1, 1]], d: [["a", 1, 1]] }));
    expect(tp(e, "s")).toBe(30_000_000 - 24_000_000);
  });

  it("自宅の一部（165㎡まで）とアパート：限度面積の残り（200−165×200/330＝100㎡）をアパートに", () => {
    const h = lot("h", 300, 100_000, { smallLand: { kind: "residence", acquirer: "a", selectedSqm: 165 } });
    // アパートの敷地：4,000万×(1−0.5×0.3) = 3,400万（1㎡17万）。貸付事業用は1㎡8.5万の減額
    const p = lot("p", 200, 200_000, { use: "rentedHouse", smallLand: { kind: "rental", acquirer: "a" } });
    const e = expected(scen([mem("a", "child")], [h, p], { h: [["a", 1, 1]], p: [["a", 1, 1]] }));
    // 自宅165㎡ 1,320万 ＋ アパート100㎡ 850万（面積を選ばないと、自宅300㎡→換算181.81㎡でアパートは18.18㎡だけ）
    expect(tp(e, "a")).toBe(floorK(30_000_000 + 34_000_000 - 13_200_000 - 8_500_000));
  });

  it("種類の違う候補のあいだでも分け直す：配偶者の自宅の一部と子のアパートの大部分を組み合わせる", () => {
    // 自宅 330㎡ 2億円（配偶者）・アパートの敷地 200㎡ 2億×(1−0.5×0.3)＝1.7億円（子）。
    // 自宅だけ（330㎡）・アパートだけ（200㎡）より、自宅 82.5㎡（減額 4,000万）＋アパート 150㎡（減額 6,375万）の方が少ない
    // （82.5×200/330 ＋ 150 ＝ 200㎡。配偶者は税額軽減で0円なので、子の減額を増やしつつ配偶者の課税価格も下げる）
    const run = (hs?: number, ps?: number) => {
      const h = lot("h", 330, 0, { valuation: { kind: "multiplier", fixedAssetValue: 200_000_000, rate: 1 }, smallLand: { kind: "residence", acquirer: "sp", ...(hs ? { selectedSqm: hs } : {}) } });
      const p = lot("p", 200, 1_000_000, { use: "rentedHouse", smallLand: { kind: "rental", acquirer: "a", ...(ps ? { selectedSqm: ps } : {}) } });
      return expected(scen([mem("sp", "spouse", "1948-01-01"), mem("a", "child")], [h, p], { h: [["sp", 1, 1]], p: [["a", 1, 1]] }));
    };
    const total = (e: ReturnType<typeof expected>) => e.persons.reduce((x, q) => x + q.payable, 0);
    const e = run();
    expect(notesOf(e)).toMatch(/（residence、sp）82\.50㎡/);
    expect(notesOf(e)).toMatch(/（rental、a）150\.00㎡/);
    expect(total(e)).toBe(total(run(82.5, 150)));
    expect(total(e)).toBeLessThan(total(run(330, 0.01)));
    expect(total(e)).toBeLessThan(total(run(0.01, 200)));
  });

  it("限度面積を超えないときは分け直さない（減らすと減額が減るだけ）", () => {
    const h = lot("h", 100, 100_000, { smallLand: { kind: "residence", acquirer: "a" } });
    const p = lot("p", 50, 200_000, { use: "rentedHouse", smallLand: { kind: "rental", acquirer: "a" } });
    const e = expected(scen([mem("a", "child")], [h, p], { h: [["a", 1, 1]], p: [["a", 1, 1]] }));
    // 100×200/330 ＋ 50 ＝ 110.6㎡ ≦ 200㎡：両方とも全部に使う（自宅 800万・アパート 50㎡×17万×50%＝425万の減額）
    expect(tp(e, "a")).toBe(floorK(10_000_000 + 8_500_000 - 8_000_000 - 4_250_000));
  });

  it("アパートの敷地を配偶者と子が共有し、2人とも貸付を続ける：200㎡を子の120㎡（入れた150㎡は持分まで）、配偶者の80㎡に", () => {
    const run = (sSqm?: number) =>
      expected(
        scen(
          [mem("s", "spouse"), mem("a", "child")],
          [lot("p", 240, 200_000, { use: "rentedHouse", smallLand: { kind: "rental", acquirer: "s", selectedSqm: sSqm, others: [{ acquirer: "a", selectedSqm: 150 }] } }), cash("d", 100_000_000), cash("e", 30_000_000)],
          {
            p: [
              ["s", 1, 2],
              ["a", 1, 2],
            ],
            d: [["a", 1, 1]],
            e: [["s", 1, 1]],
          },
        ),
      );
    // 4,800万×0.85 = 4,080万、各 2,040万（1㎡17万。貸付事業用の減額は1㎡8.5万）。配偶者の面積を80㎡と入れたとき
    const fixed = run(80);
    expect(tp(fixed, "a")).toBe(20_400_000 - 10_200_000 + 100_000_000);
    expect(tp(fixed, "s")).toBe(20_400_000 - 6_800_000 + 30_000_000);
    // 入れなければ0.01㎡刻みで分け直して比べる。子 119.99㎡（減額 10,199,150）・配偶者 80.01㎡（6,800,850）にすると、課税価格は
    // 子 110,200,850 → 110,200,000、配偶者 43,599,150 → 43,599,000（1,000円未満切捨て）で合計が1,000円下がり、
    // 法定相続分 55,900,000 → 55,899,000 で総額が 19,540,000 → 19,539,400。子の納付は 14,000,700 → 14,000,300
    const free = run();
    expect(tp(free, "a")).toBe(110_200_000);
    expect(tp(free, "s")).toBe(43_599_000);
    expect(pay(fixed, "a")).toBe(14_000_700);
    expect(pay(free, "a")).toBe(14_000_300);
    expect(pay(free, "s")).toBe(0);
    expect(notesOf(free)).toMatch(/（rental、s）80\.01㎡ 減額 6,800,850/);
  });

  it("共有の貸付事業用で、1人は申告期限までに貸付をやめる：やめる人の持分には使えない", () => {
    const p = lot("p", 200, 200_000, { use: "rentedHouse", smallLand: { kind: "rental", acquirer: "a", others: [{ acquirer: "b", continues: false }] } });
    const e = expected(
      scen([mem("a", "child"), mem("b", "child")], [p], {
        p: [
          ["a", 1, 2],
          ["b", 1, 2],
        ],
      }),
    );
    expect(tp(e, "a")).toBe(17_000_000 - 8_500_000);
    expect(tp(e, "b")).toBe(17_000_000);
  });

  it("一部が未分割の宅地：分割で取得した持分だけが対象（未分割の残りと、分割で取得していない人には使えない）", () => {
    const h = lot("h", 400, 100_000, { smallLand: { kind: "residence", acquirer: "s", others: [{ acquirer: "b" }] } });
    const s = scen([mem("s", "spouse"), mem("a", "child"), mem("b", "child")], [h, cash("d", 60_000_000)], { h: [["s", 1, 2]], d: [["a", 1, 1]] });
    if (s.division.kind === "agreed") s.division.partlyUndivided = true;
    const e = expected(s);
    const n = notesOf(e);
    expect(n).toMatch(/h：1\/2 が未分割/);
    expect(n).toMatch(/bの分）：小規模宅地等の取得者がこの土地を（分割で）取得していない/);
    expect(n).toMatch(/小規模宅地等：h（sの分）（residence、s）200\.00㎡ 減額 16,000,000/);
  });

  it("未分割の相続では、共有で使う人がいても特例は使えない", () => {
    const h = lot("h", 200, 100_000, { smallLand: { kind: "residence", acquirer: "s", others: [{ acquirer: "a" }] } });
    const e = expected(scen([mem("s", "spouse"), mem("a", "child")], [h, cash("d", 40_000_000)], null));
    expect(e.totalTaxablePrice).toBe(60_000_000);
  });
});
