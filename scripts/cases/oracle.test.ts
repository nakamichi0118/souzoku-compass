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
