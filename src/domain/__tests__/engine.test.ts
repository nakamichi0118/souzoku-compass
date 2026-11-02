import { describe, expect, it } from "vitest";
import { apportionRatios, calculate, progressiveTax } from "../tax/engine";
import type { Asset, Case, Person } from "../types";

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
    expect(r.blockers.length).toBe(2);
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
});
