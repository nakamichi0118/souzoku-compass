import { describe, expect, it } from "vitest";
import { SR_MAX_PERMUTE, apportionRatios, calculate, progressiveTax } from "../tax/engine";
import type { Asset, Case, Person } from "../types";
import { demoCase } from "@/data/demo";

const decedent = { name: "相続 太郎", birthDate: "1950-01-01", deathDate: "2026-03-15", address: "東京都千代田区" };
const dep = (id: string, amount: number): Asset => ({ id, kind: "deposit", label: id, amount });
const all = (assetId: string, ...s: [string, number, number][]) => ({
  assetId,
  shares: s.map(([personId, numerator, denominator]) => ({ personId, numerator, denominator })),
});
const mk = (persons: Person[], assets: Asset[], allocations: Case["allocations"], extra: Partial<Case> = {}): Case => ({
  id: "t",
  title: "t",
  decedent,
  persons,
  assets,
  allocations,
  debts: [],
  priorGifts: [],
  ...extra,
});
const spouse: Person = { id: "s", name: "妻", relation: "spouse" };
const c1: Person = { id: "c1", name: "長男", relation: "child" };
const c2: Person = { id: "c2", name: "長女", relation: "child" };

describe("速算表（相続税法16条）", () => {
  it.each([
    [10_000_000, 1_000_000],
    [25_500_000, 3_325_000],
    [51_000_000, 8_300_000],
    [1_000_000_000, 478_000_000],
  ])("%d円 → %d円", (amt, tax) => {
    expect(progressiveTax(amt)).toBe(Math.floor(tax));
  });
});

describe("相続税の総額と各人の税額", () => {
  it("配偶者＋子2人、課税価格1.5億円を法定相続分どおり → 総額14,950,000円、配偶者は軽減で0円", () => {
    const r = calculate(
      mk([spouse, c1, c2], [dep("預金", 150_000_000)], [all("預金", ["s", 1, 2], ["c1", 1, 4], ["c2", 1, 4])]),
    );
    expect(r.basicDeduction).toBe(48_000_000);
    expect(r.taxableEstate).toBe(102_000_000);
    expect(r.slots.map((s) => s.amount)).toEqual([51_000_000, 25_500_000, 25_500_000]);
    expect(r.totalTax).toBe(14_950_000);
    const [s, a, b] = r.persons;
    expect(s.computed).toBe(7_475_000);
    expect(s.spouseCredit).toBe(7_475_000);
    expect(s.payable).toBe(0);
    expect(a.payable).toBe(3_737_500);
    expect(b.payable).toBe(3_737_500);
    expect(r.totalPayable).toBe(7_475_000);
    expect(r.blockers).toEqual([]);
  });

  it("配偶者が1億6千万円を超えて取得 → 法定相続分相当額（1.6億円未満なら1.6億円）まで軽減", () => {
    // 課税価格4億円、配偶者3億円取得：法定相続分相当額 2億円 > 1.6億円 → 2億円まで
    const r = calculate(
      mk([spouse, c1], [dep("預金", 400_000_000)], [all("預金", ["s", 3, 4], ["c1", 1, 4])]),
    );
    expect(r.spouse?.legalShareAmount).toBe(200_000_000);
    expect(r.spouse?.base).toBe(200_000_000);
    // 課税遺産総額 4億−4,200万=3億5,800万、各1億7,900万 → 各 54,600,000 → 総額 109,200,000
    expect(r.totalTax).toBe(109_200_000);
    expect(r.spouse?.creditBase).toBe(54_600_000);
    const s = r.persons[0];
    expect(s.computed).toBe(81_900_000);
    expect(s.payable).toBe(81_900_000 - 54_600_000);
  });

  it("兄弟姉妹のみが相続 → 2割加算", () => {
    const sib: Person = { id: "b", name: "兄", relation: "sibling" };
    const r = calculate(mk([sib], [dep("預金", 60_000_000)], [all("預金", ["b", 1, 1])]));
    expect(r.basicDeduction).toBe(36_000_000);
    expect(r.totalTax).toBe(3_100_000);
    expect(r.persons[0].surcharge).toBe(620_000);
    expect(r.persons[0].payable).toBe(3_720_000);
  });

  it("基礎控除以下なら税額0・申告不要", () => {
    const r = calculate(mk([spouse, c1], [dep("預金", 42_000_000)], [all("預金", ["s", 1, 2], ["c1", 1, 2])]));
    expect(r.totalTax).toBe(0);
    expect(r.needsFiling).toBe(false);
  });

  it("課税価格は各人ごとに1,000円未満切捨て", () => {
    const r = calculate(mk([c1], [dep("預金", 50_123_999)], [all("預金", ["c1", 1, 1])]));
    expect(r.persons[0].taxable).toBe(50_123_000);
  });
});

describe("生命保険金の非課税（相続税法12条1項5号）", () => {
  it("非課税限度額＝500万円×法定相続人の数。放棄者は非課税の適用なし", () => {
    const c2r: Person = { ...c2, renounced: true };
    const r = calculate(
      mk(
        [spouse, c1, c2r],
        [
          dep("預金", 100_000_000),
          { id: "保険1", kind: "insurance", label: "保険1", amount: 20_000_000, recipientId: "s" },
          { id: "保険2", kind: "insurance", label: "保険2", amount: 5_000_000, recipientId: "c2" },
        ],
        [all("預金", ["s", 1, 2], ["c1", 1, 2])],
      ),
    );
    expect(r.insuranceExemptLimit).toBe(15_000_000);
    const s = r.persons.find((p) => p.person.id === "s")!;
    const b = r.persons.find((p) => p.person.id === "c2")!;
    expect(s.insuranceExempt).toBe(15_000_000);
    expect(s.acquired).toBe(50_000_000 + 5_000_000);
    expect(b.insuranceExempt).toBe(0);
    expect(b.acquired).toBe(5_000_000);
    expect(b.isLegalHeir).toBe(true);
    expect(b.isCivilHeir).toBe(false);
  });

  it("受取額の比で按分する", () => {
    const r = calculate(
      mk(
        [spouse, c1],
        [
          { id: "i1", kind: "insurance", label: "i1", amount: 15_000_000, recipientId: "s" },
          { id: "i2", kind: "insurance", label: "i2", amount: 5_000_000, recipientId: "c1" },
        ],
        [],
      ),
    );
    // 限度1,000万円を 15:5 で按分
    expect(r.persons.map((p) => p.insuranceExempt)).toEqual([7_500_000, 2_500_000]);
  });
});

describe("債務控除・贈与加算・未成年者控除", () => {
  it("債務・葬式費用を控除し、純資産価額は0未満にしない", () => {
    const r = calculate(
      mk([c1, c2], [dep("預金", 60_000_000)], [all("預金", ["c1", 1, 1])], {
        debts: [
          { id: "d", kind: "debt", label: "借入", amount: 3_000_000, bearers: [{ personId: "c1", amount: 2_000_000 }, { personId: "c2", amount: 1_000_000 }] },
          { id: "f", kind: "funeral", label: "葬式", amount: 1_500_000, bearers: [{ personId: "c1", amount: 1_500_000 }] },
        ],
      }),
    );
    expect(r.persons[0].debts).toBe(3_500_000);
    expect(r.persons[0].net).toBe(56_500_000);
    expect(r.persons[1].net).toBe(0);
  });

  it("令和8年中の相続開始は相続開始前3年以内の贈与を加算", () => {
    const r = calculate(
      mk([c1], [dep("預金", 50_000_000)], [all("預金", ["c1", 1, 1])], {
        priorGifts: [
          { personId: "c1", date: "2023-03-15", amount: 1_000_000, giftTaxPaid: 0 },
          { personId: "c1", date: "2023-03-14", amount: 9_000_000, giftTaxPaid: 0 },
          { personId: "c1", date: "2025-05-01", amount: 3_000_000, giftTaxPaid: 190_000 },
        ],
      }),
    );
    expect(r.persons[0].gifts).toBe(4_000_000);
    expect(r.persons[0].giftTaxCredit).toBe(190_000);
  });

  it("未成年者控除：(18歳−相続開始時の年齢)×10万円", () => {
    const minor: Person = { id: "m", name: "孫", relation: "child", birthDate: "2010-09-01" }; // 15歳
    const r = calculate(mk([minor], [dep("預金", 60_000_000)], [all("預金", ["m", 1, 1])]));
    expect(r.persons[0].minorCredit).toBe(300_000);
    expect(r.persons[0].payable).toBe(3_100_000 - 300_000);
  });

  it("国外財産・非居住者は自動完結の対象外", () => {
    const r = calculate(
      mk([{ ...c1, nonResident: true }], [{ ...dep("海外口座", 1), foreign: true } as Asset], []),
    );
    expect(r.blockers.filter((b) => b.includes("国外")).length).toBe(2);
  });
});

describe("按分割合（相基通17-1）", () => {
  it("小数点以下2位にそろえ合計を1にする", () => {
    expect(apportionRatios([1, 1, 1])).toEqual([0.34, 0.33, 0.33]);
    expect(apportionRatios([75, 25])).toEqual([0.75, 0.25]);
  });
});

describe("小規模宅地等の特例", () => {
  it("配偶者が取得した自宅敷地を80%減額", () => {
    const land: Asset = {
      id: "自宅",
      kind: "land",
      label: "自宅敷地",
      location: "x",
      areaSqm: 200,
      landUse: "宅地",
      method: { type: "manual", value: 50_000_000 },
      smallResidential: { applies: true, acquirerId: "s" },
    };
    const r = calculate(mk([spouse, c1], [land, dep("預金", 40_000_000)], [all("自宅", ["s", 1, 1]), all("預金", ["c1", 1, 1])]));
    expect(r.assets[0].reduction).toBe(40_000_000);
    expect(r.persons[0].acquired).toBe(10_000_000);
    // 特例適用後 5,000万 < 基礎控除4,200万? → 5,000万 > 4,200万なので申告必要
    expect(r.needsFiling).toBe(true);
  });

  it("確認の答えがあれば、取得者を変えたときに判定し直す（別居の子は自動では適用しない）", () => {
    const land = (acquirerId: string): Asset => ({
      id: "自宅",
      kind: "land",
      label: "自宅敷地",
      location: "x",
      areaSqm: 200,
      landUse: "宅地",
      method: { type: "manual", value: 50_000_000 },
      // 画面で配偶者を選んだときに保存された applies: true のまま、取得者だけ子に変わった
      smallResidential: { applies: true, acquirerId, check: { ownHome: "yes", special: "no" } },
    });
    const toSpouse = calculate(mk([spouse, c1], [land("s")], [all("自宅", ["s", 1, 1])]));
    expect(toSpouse.assets[0].reduction).toBe(40_000_000);
    const toChild = calculate(mk([spouse, c1], [land("c1")], [all("自宅", ["c1", 1, 1])]));
    expect(toChild.assets[0].reduction).toBe(0);
  });
});

describe("土地の入力漏れ", () => {
  const land = (over: Partial<Extract<Asset, { kind: "land" }>>): Asset => ({
    id: "l",
    kind: "land",
    label: "土地",
    location: "x",
    areaSqm: 100,
    landUse: "宅地",
    method: { type: "rosenka", routePrice: 300_000, depthCorrection: 1 },
    ...over,
  } as Asset);
  it("路線価・地積が0のままなら0円で計算せず止める", () => {
    for (const a of [land({ areaSqm: 0 }), land({ method: { type: "rosenka", routePrice: 0, depthCorrection: 1 } }), land({ method: { type: "rosenka", routePrice: 300_000, depthCorrection: 1, roads: [{ edge: 0, price: 300_000, depth: 0 }] } })]) {
      const r = calculate(mk([c1], [a], [all("l", ["c1", 1, 1])]));
      expect(r.blockers.some((b) => b.includes("未入力"))).toBe(true);
    }
  });
  it("そろっていれば計算する", () => {
    const r = calculate(mk([c1], [land({})], [all("l", ["c1", 1, 1])]));
    expect(r.blockers).toEqual([]);
    expect(r.assets[0].valuation.value).toBe(30_000_000);
  });
  it("誰でも通り抜けできる私道と選んだ土地は0円で止めずに計算する（財産評価基本通達24）", () => {
    const road = land({ label: "私道持分", method: { type: "manual", value: 0, publicPrivateRoad: true } });
    const r = calculate(mk([c1], [road, dep("預金", 50_000_000)], [all("l", ["c1", 1, 1]), all("預金", ["c1", 1, 1])]));
    expect(r.blockers).toEqual([]);
    expect(r.assets[0].valuation.value).toBe(0);
    expect(r.totalTaxable).toBe(50_000_000);
    const unset = calculate(mk([c1], [land({ method: { type: "manual", value: 0 } })], [all("l", ["c1", 1, 1])]));
    expect(unset.blockers.some((b) => b.includes("未入力"))).toBe(true);
  });
});

describe("配偶者の法定相続分相当額（相続税法19条の2）", () => {
  it("1,000円単位に切り捨てない（課税価格の合計 400,001,000円 × 1/2 ＝ 200,000,500円）", () => {
    const r = calculate(
      mk([spouse, c1], [dep("A", 300_001_000), dep("B", 100_000_000)], [all("A", ["s", 1, 1]), all("B", ["c1", 1, 1])]),
    );
    expect(r.totalTaxable).toBe(400_001_000);
    expect(r.spouse?.legalShareAmount).toBe(200_000_500);
    expect(r.spouse?.base).toBe(200_000_500);
  });
});

describe("債務・葬式費用を差し引ける人（相続税法13条、相基通13-1）", () => {
  const naien: Person = { id: "n", name: "内縁の妻", relation: "other" };
  it("相続人でない受遺者が負担した葬式費用は差し引かず、止める", () => {
    const r = calculate(
      mk([c1, naien], [dep("預金", 80_000_000), dep("遺贈", 10_000_000)], [all("預金", ["c1", 1, 1]), all("遺贈", ["n", 1, 1])], {
        debts: [{ id: "f", kind: "funeral", label: "葬式", amount: 2_000_000, bearers: [{ personId: "n", amount: 2_000_000 }] }],
      }),
    );
    const n = r.persons.find((p) => p.person.id === "n")!;
    expect(n.funeralOnly).toBe(0);
    expect(n.debts).toBe(0);
    expect(n.taxable).toBe(10_000_000);
    expect(r.blockers.some((b) => b.includes("内縁の妻さんは相続人ではない"))).toBe(true);
  });
  it("相続を放棄した人は葬式費用だけ差し引ける（債務は差し引かない）", () => {
    const r = calculate(
      mk(
        [c1, { ...c2, renounced: true }],
        [dep("預金", 80_000_000), { id: "保険", kind: "insurance", label: "保険", amount: 10_000_000, recipientId: "c2" }],
        [all("預金", ["c1", 1, 1])],
        {
          debts: [
            { id: "f", kind: "funeral", label: "葬式", amount: 1_000_000, bearers: [{ personId: "c2", amount: 1_000_000 }] },
            { id: "d", kind: "debt", label: "借入", amount: 500_000, bearers: [{ personId: "c2", amount: 500_000 }] },
          ],
        },
      ),
    );
    const b = r.persons.find((p) => p.person.id === "c2")!;
    expect(b.funeralOnly).toBe(1_000_000);
    expect(b.debtOnly).toBe(0);
    expect(b.net).toBe(9_000_000);
    expect(r.blockers).toEqual([]);
    expect(r.warnings.some((w) => w.includes("放棄"))).toBe(true);
  });
});

describe("3年以内の贈与の入力漏れ", () => {
  const base = (g: Case["priorGifts"][number], persons: Person[] = [c1]) =>
    calculate(mk(persons, [dep("預金", 50_000_000)], [all("預金", ["c1", 1, 1])], { priorGifts: [g] }));
  it.each([
    ["受け取った人が空欄", { personId: "", date: "2025-05-01", amount: 1_000_000, giftTaxPaid: 0 }, "受け取った人"],
    ["一覧にいない人", { personId: "deleted", date: "2025-05-01", amount: 1_000_000, giftTaxPaid: 0 }, "受け取った人"],
    ["日付が空欄", { personId: "c1", date: "", amount: 1_000_000, giftTaxPaid: 0 }, "贈与の日"],
    ["実在しない日付", { personId: "c1", date: "2025-02-30", amount: 1_000_000, giftTaxPaid: 0 }, "贈与の日"],
    ["亡くなった日より後", { personId: "c1", date: "2026-04-01", amount: 1_000_000, giftTaxPaid: 0 }, "亡くなった日より後"],
    ["納めた贈与税だけ入っている", { personId: "", date: "", amount: 0, giftTaxPaid: 100_000 }, "受け取った人"],
  ])("%s なら止める", (_, g, word) => {
    const r = base(g);
    expect(r.blockers.some((b) => b.includes(word))).toBe(true);
    expect(r.persons[0].gifts).toBe(0);
  });
  it("先に亡くなった人への贈与は止めて削除を案内する", () => {
    const r = base({ personId: "c2", date: "2025-05-01", amount: 1_000_000, giftTaxPaid: 0 }, [c1, { ...c2, predeceased: true }]);
    expect(r.blockers.some((b) => b.includes("先に亡くなって"))).toBe(true);
  });
  it("金額が0円の空の行は止めない", () => {
    expect(base({ personId: "", date: "", amount: 0, giftTaxPaid: 0 }).blockers).toEqual([]);
  });
  it("相続や遺贈で何も受け取らない人への贈与は足さず、その旨を知らせる", () => {
    const r = base({ personId: "c2", date: "2025-05-01", amount: 1_000_000, giftTaxPaid: 0 }, [c1, c2]);
    expect(r.blockers).toEqual([]);
    expect(r.persons.find((p) => p.person.id === "c2")!.gifts).toBe(0);
    expect(r.warnings.some((w) => w.includes("贈与は相続税の計算に足していません"))).toBe(true);
  });
});

describe("未成年者控除・障害者控除の対象", () => {
  it("何も受け取らない未成年の法定相続人には控除しない", () => {
    const minor: Person = { id: "m", name: "次男", relation: "child", birthDate: "2015-01-01" };
    const r = calculate(mk([c1, minor], [dep("預金", 80_000_000)], [all("預金", ["c1", 1, 1])]));
    const m = r.persons.find((p) => p.person.id === "m")!;
    expect(m.acquiresSomething).toBe(false);
    expect(m.minorCredit + m.minorExcess).toBe(0);
    expect(r.blockers).toEqual([]);
  });
  it("亡くなった後に生まれた子は0歳として18年分（180万円）", () => {
    const baby: Person = { id: "b", name: "胎児", relation: "child", birthDate: "2026-08-01" };
    const r = calculate(mk([baby], [dep("預金", 100_000_000)], [all("預金", ["b", 1, 1])]));
    const b = r.persons[0];
    expect(b.age).toBe(0);
    expect(b.minorCredit + b.minorExcess).toBe(1_800_000);
  });
  it("引ききれない控除は、ほかに税額のある扶養義務者の相続税から引く（相続税法19条の3第2項）", () => {
    // 総額 500万（課税遺産総額 4,000万）。算出税額 長男 4,878,048・次男 121,951（按分割合10桁）
    // 次男（2歳）の未成年者控除 160万：本人 121,951、残り 1,478,049 を長男から → 3,399,999 → 3,399,900円
    const minor: Person = { id: "m", name: "次男", relation: "child", birthDate: "2024-01-01" }; // 2歳 → 160万円
    const r = calculate(mk([c1, minor], [dep("預金", 80_000_000), dep("少し", 2_000_000)], [all("預金", ["c1", 1, 1]), all("少し", ["m", 1, 1])]));
    const m = r.persons.find((p) => p.person.id === "m")!;
    expect(m.minorCredit).toBe(121_951);
    expect(m.minorExcess).toBe(1_478_049);
    expect(m.beforeOtherCredits).toBe(m.minorCredit);
    const a = r.persons.find((p) => p.person.id === "c1")!;
    expect(a.transfersIn).toEqual([{ fromId: "m", kind: "minor", amount: 1_478_049 }]);
    expect(a.payable).toBe(3_399_900);
    expect(r.blockers).toEqual([]);
  });
  it("ほかに税額のある人がいなければ止めずに知らせるだけ", () => {
    const minor: Person = { id: "m", name: "長男", relation: "child", birthDate: "2024-01-01" };
    const r = calculate(mk([minor], [dep("預金", 40_000_000)], [all("預金", ["m", 1, 1])]));
    expect(r.persons[0].minorExcess).toBeGreaterThan(0);
    expect(r.blockers).toEqual([]);
    expect(r.warnings.some((w) => w.includes("引ききれません"))).toBe(true);
  });
});

describe("2割加算と代襲", () => {
  it("親が相続放棄しただけの孫は、被代襲者の欄が残っていても2割加算", () => {
    const grand: Person = { id: "g", name: "孫", relation: "grandchild", substituteOf: "c2" };
    const r = calculate(
      mk([c1, { ...c2, renounced: true }, grand], [dep("預金", 100_000_000)], [all("預金", ["c1", 1, 2], ["g", 1, 2])]),
    );
    const g = r.persons.find((p) => p.person.id === "g")!;
    expect(g.surcharge).toBe(Math.floor(g.computed / 5));
    expect(g.surcharge).toBeGreaterThan(0);
  });
  it("先に亡くなった子の代襲相続人の孫は2割加算しない", () => {
    const grand: Person = { id: "g", name: "孫", relation: "grandchild", substituteOf: "c2" };
    const r = calculate(
      mk([c1, { ...c2, predeceased: true }, grand], [dep("預金", 100_000_000)], [all("預金", ["c1", 1, 2], ["g", 1, 2])]),
    );
    expect(r.persons.find((p) => p.person.id === "g")!.surcharge).toBe(0);
  });
});

describe("自動では計算できない事項", () => {
  it("相続時精算課税を選んだと答えたのに、その贈与が入っていなければ止める", () => {
    const r = calculate({ ...mk([c1], [dep("預金", 50_000_000)], [all("預金", ["c1", 1, 1])]), decedent: { ...decedent, settlementGift: true } });
    expect(r.blockers.some((b) => b.includes("相続時精算課税"))).toBe(true);
  });
  it("孫養子が代襲相続人でもある（二重の資格）なら止める", () => {
    const ga: Person = { id: "ga", name: "孫養子", relation: "adoptedChild", grandchildAdopted: true, alsoSubstituteHeir: true };
    const r = calculate(mk([c1, ga], [dep("預金", 50_000_000)], [all("預金", ["c1", 1, 1])]));
    expect(r.blockers.some((b) => b.includes("二重の資格"))).toBe(true);
  });
  it("書類から読み取って確かめていない財産があれば止める", () => {
    const r = calculate(mk([c1], [{ ...dep("預金", 50_000_000), pending: ["残高"] } as Asset], [all("預金", ["c1", 1, 1])]));
    expect(r.blockers.some((b) => b.includes("確かめていない"))).toBe(true);
  });
  it("同じ id の人が二重に登録されていれば止める", () => {
    const r = calculate(mk([c1, c1], [dep("預金", 50_000_000)], [all("預金", ["c1", 1, 1])]));
    expect(r.blockers.some((b) => b.includes("二重に登録"))).toBe(true);
  });
});

describe("小規模宅地等の330㎡の割り当て順", () => {
  const lot = (id: string, areaSqm: number, value: number, acquirerId = "s"): Asset => ({
    id,
    kind: "land",
    label: id,
    location: "x",
    areaSqm,
    landUse: "宅地",
    method: { type: "manual", value },
    smallResidential: { applies: true, acquirerId },
  });
  it("相続税の合計が同じなら、入力順ではなく減額が大きくなる（1㎡あたりの価額が高い）宅地から割り当てる", () => {
    // A：330㎡ 5,000万円（約15万円/㎡）を先に入力、B：200㎡ 6,000万円（30万円/㎡）
    const r = calculate(mk([spouse, c1], [lot("A", 330, 50_000_000), lot("B", 200, 60_000_000)], [all("A", ["s", 1, 1]), all("B", ["s", 1, 1])]));
    const [a, b] = r.assets;
    expect(b.reduction).toBe(48_000_000);
    expect(b.small?.selectedArea).toBe(200);
    expect(a.small?.selectedArea).toBe(130);
    expect(a.reduction).toBe(Math.floor((Math.floor((50_000_000 * 130) / 330) * 8) / 10));
    expect(r.warnings.some((w) => w.includes("「A」は残り130㎡分"))).toBe(true);
  });

  it("税額が0円の配偶者の宅地より、相続税を納める子の宅地を先に選び、家族全体の相続税を少なくする", () => {
    // A：配偶者 200㎡ 6,000万円（30万円/㎡）、B：同居の子 250㎡ 7,000万円（28万円/㎡）、預金1億円を半分ずつ。
    // 1㎡あたりの価額が高いAから割り当てる（A 200㎡＋B 130㎡）と、納める相続税の合計は 11,451,500円になる
    const r = calculate(
      mk(
        [spouse, c1],
        [lot("A", 200, 60_000_000, "s"), lot("B", 250, 70_000_000, "c1"), dep("預金", 100_000_000)],
        [all("A", ["s", 1, 1]), all("B", ["c1", 1, 1]), all("預金", ["s", 1, 2], ["c1", 1, 2])],
      ),
    );
    const [a, b] = r.assets;
    expect(b.small?.selectedArea).toBe(250);
    expect(b.reduction).toBe(56_000_000);
    expect(a.small?.selectedArea).toBe(80);
    expect(a.reduction).toBe(19_200_000);
    expect(r.totalPayable).toBe(8_202_500);
    expect(r.persons.find((p) => p.person.id === "s")?.payable).toBe(0);
    const w = r.warnings.find((x) => x.includes("330㎡"));
    expect(w).toContain("「B」に250㎡、「A」は残り80㎡分");
    expect(w).toContain("税理士");
    expect(r.blockers).toEqual([]);
  });

  it("特例の宅地が1筆だけのデモの案件は、これまでどおりの税額になる", () => {
    const r = calculate(demoCase);
    expect(r.assets.find((l) => l.asset.id === "home-land")?.reduction).toBe(55_608_000);
    expect(r.totalPayable).toBe(3_928_200);
    expect(r.warnings.some((w) => w.includes("330㎡"))).toBe(false);
  });

  it("同じ宅地どうしなら入力順に割り当てる", () => {
    const r = calculate(mk([spouse, c1], [lot("A", 200, 60_000_000, "c1"), lot("B", 200, 60_000_000, "c1")], [all("A", ["c1", 1, 1]), all("B", ["c1", 1, 1])]));
    const [a, b] = r.assets;
    expect(a.small?.selectedArea).toBe(200);
    expect(b.small?.selectedArea).toBe(130);
  });

  it(`宅地が${SR_MAX_PERMUTE + 1}筆以上（すべての順を試すには多すぎる）なら、1㎡あたりの価額が高い順に割り当て、その旨を知らせる`, () => {
    const lots = [
      lot("A", 60, 3_000_000, "s"),
      lot("B", 60, 12_000_000, "c1"),
      lot("C", 60, 9_000_000, "s"),
      lot("D", 60, 18_000_000, "c1"),
      lot("E", 60, 15_000_000, "s"),
      lot("F", 60, 6_000_000, "c1"),
      lot("G", 60, 1_200_000, "s"),
      lot("H", 60, 600_000, "c1"),
    ];
    expect(lots.length).toBeGreaterThan(SR_MAX_PERMUTE);
    const r = calculate(mk([spouse, c1], lots, lots.map((l) => all(l.id, [(l as Extract<Asset, { kind: "land" }>).smallResidential!.acquirerId!, 1, 1]))));
    expect(r.assets.map((l) => l.small?.selectedArea)).toEqual([30, 60, 60, 60, 60, 60, undefined, undefined]);
    const w = r.warnings.find((x) => x.includes("330㎡"))!;
    expect(w).toContain("1㎡あたりの価額が高い土地から順に");
    expect(w).toContain("「A」は残り30㎡分");
    expect(w).toContain("「G」・「H」には適用していません");
  });
});
