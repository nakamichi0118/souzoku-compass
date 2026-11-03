/**
 * 小規模宅地等の特例：1つの宅地を何人かで受け継いだとき（共有）と、受け継いだ面積の一部だけに使うとき（付表1の⑤）。
 * 共有の宅地は、取得した人ごとに要件を見て、その人の持分に応ずる部分（③④）だけに使う（国税庁 タックスアンサー No.4124）。
 * ⑥ ＝ ④ × ⑤ ／ ③、減額 ＝ ⑥ × 減額割合（1円未満切捨て）。期待値はテストごとのコメントの手計算。亡くなった日は 2026-03-15。
 */
import { describe, expect, it } from "vitest";
import { calculate } from "../tax/engine";
import { consultPoints } from "@/lib/consult";
import { summarizeForAssistant } from "@/lib/summary";
import { CASE_LIMITS, checkCase } from "@/server/caseSchema";
import { valueAsset } from "../valuation";
import type { Asset, Case, CondoAsset, LandAsset, Person, SmallLandAcquirer } from "../types";
import type { SmallResidentialCheck } from "../valuation/smallResidential";

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
const c3: Person = { id: "c3", name: "二男", relation: "child" };
const of = (r: ReturnType<typeof calculate>, id: string) => r.persons.find((p) => p.person.id === id)!;
const amountOf = (r: ReturnType<typeof calculate>, assetId: string, personId: string) =>
  r.assets.find((l) => l.asset.id === assetId)!.byPerson.find((b) => b.personId === personId)!.amount;

/** 自宅の敷地（老人ホームなどの事情なし） */
const HOME: SmallResidentialCheck = { ownHome: "yes", special: "no" };
/** 同居していて、申告期限まで住み続け・持ち続ける */
const LIVING: SmallResidentialCheck = { livedTogether: "yes", keep: "yes" };
/** 貸付を続け、持ち続ける。3年以内に貸し始めたものでない */
const RENT_ON: SmallResidentialCheck = { continues: "yes", keep: "yes", recent: "no" };

const home = (
  id: string,
  areaSqm: number,
  value: number,
  acquirerId: string,
  check: SmallResidentialCheck,
  others?: SmallLandAcquirer[],
  over: Partial<LandAsset> & { selectedSqm?: number } = {},
): LandAsset => {
  const { selectedSqm, ...rest } = over;
  return {
    id,
    kind: "land",
    label: id,
    location: "x",
    areaSqm,
    landUse: "宅地",
    method: { type: "manual", value },
    smallResidential: { applies: true, acquirerId, check, ...(others ? { others } : {}), ...(selectedSqm !== undefined ? { selectedSqm } : {}) },
    ...rest,
  };
};
/** アパートを建てて貸している土地（貸家建付地）。評価額は 自用地 ×（1 − 0.6 × 0.3 × 賃貸割合） */
const rental = (id: string, areaSqm: number, selfValue: number, acquirerId: string, check: SmallResidentialCheck, others?: SmallLandAcquirer[], over: Partial<LandAsset> = {}) =>
  home(id, areaSqm, selfValue, acquirerId, check, others, { use: "rentedHouse", leaseRatio: 0.6, ...over });

describe("1つの自宅の敷地を、配偶者と同居の子が1/2ずつ受け継ぐ", () => {
  // 自宅 300㎡ 9,000万円。妻 1/2、長男 1/2（同居して住み続ける）。
  // 妻：③150㎡ ④4,500万円 ⑤150㎡ ⑥4,500万円 → 減額 3,600万円。長男も同じ。合計300㎡は330㎡以内なので両方とも全部使える
  const lot = home("自宅", 300, 90_000_000, "s", HOME, [{ acquirerId: "c1", check: LIVING }]);
  const r = calculate(mk([spouse, c1], [lot, dep("預金", 40_000_000)], [all("自宅", ["s", 1, 2], ["c1", 1, 2]), all("預金", ["c1", 1, 1])]));
  const line = r.assets[0];

  it("付表1は取得した人ごとに1行（③④⑤⑥）。土地の減額はその合計", () => {
    expect(r.blockers).toEqual([]);
    expect(line.small).toEqual({ acquirerId: "s", kind: "residence", rate: 80, area: 150, value: 45_000_000, selectedArea: 150, selectedValue: 45_000_000 });
    expect(line.smallExtra).toEqual([{ acquirerId: "c1", kind: "residence", rate: 80, area: 150, value: 45_000_000, selectedArea: 150, selectedValue: 45_000_000 }]);
    expect(line.reduction).toBe(72_000_000);
  });

  it("それぞれの取得価額から、本人の減額だけを引く", () => {
    expect(amountOf(r, "自宅", "s")).toBe(9_000_000);
    expect(amountOf(r, "自宅", "c1")).toBe(9_000_000);
    expect(of(r, "c1").acquired).toBe(49_000_000);
    // 330㎡以内なので、限度面積の割り当ての案内は出さない
    expect(r.warnings.some((w) => w.includes("330㎡"))).toBe(false);
  });

  it("相談の項目・要約にも入る", () => {
    expect(consultPoints(mk([spouse, c1], [lot], []), r)).toEqual([]);
    expect(summarizeForAssistant(mk([spouse, c1], [lot], []), r)).toContain("1つの土地を2人以上");
  });
});

describe("配偶者と、同居していなかった子が1/2ずつ受け継ぐ", () => {
  const notLiving: SmallResidentialCheck = { livedTogether: "no", keep: "yes" };
  const lotOf = (check: SmallResidentialCheck) => home("自宅", 300, 90_000_000, "s", HOME, [{ acquirerId: "c1", check }]);
  const allocations = [all("自宅", ["s", 1, 2], ["c1", 1, 2])];

  it("子の分には特例を使わない（配偶者の分の3,600万円だけ減らす）", () => {
    const r = calculate(mk([spouse, c1], [lotOf(notLiving)], allocations));
    expect(r.blockers).toEqual([]);
    expect(r.assets[0].small).toMatchObject({ acquirerId: "s", area: 150, selectedArea: 150 });
    expect(r.assets[0].smallExtra).toBeUndefined();
    expect(r.assets[0].reduction).toBe(36_000_000);
    expect(amountOf(r, "自宅", "c1")).toBe(45_000_000);
  });

  it("子の分は、税理士への相談の項目に名前つきで出す", () => {
    const c = mk([spouse, c1], [lotOf(notLiving)], allocations);
    const points = consultPoints(c, calculate(c));
    expect(points).toHaveLength(1);
    expect(points[0]).toContain("「自宅」の小規模宅地等の特例（長男さんの分）");
    expect(points[0]).toContain("家なき子");
  });

  it("税理士に確認して使うと決めたら、子の分にも使う", () => {
    const r = calculate(mk([spouse, c1], [lotOf({ ...notLiving, confirmedByAdvisor: true })], allocations));
    expect(r.assets[0].smallExtra).toEqual([expect.objectContaining({ acquirerId: "c1", selectedArea: 150 })]);
    expect(r.assets[0].reduction).toBe(72_000_000);
  });

  it("土地についての答え（自宅の敷地か）は1人目の答えを使う：2人目の check に書いても見ない", () => {
    // 2人目の答えに ownHome: "no" があっても、土地は1人目の答え（自宅の敷地）で判定する
    const r = calculate(mk([spouse, c1], [lotOf({ ...LIVING, ownHome: "no", business: "no" })], allocations));
    expect(r.assets[0].smallExtra).toEqual([expect.objectContaining({ acquirerId: "c1", kind: "residence" })]);
  });

  it("1人目が使えなくても、2人目（配偶者）の分には使う", () => {
    const lot = home("自宅", 300, 90_000_000, "c1", { ...HOME, ...notLiving }, [{ acquirerId: "s" }]);
    const r = calculate(mk([spouse, c1], [lot], [all("自宅", ["c1", 1, 2], ["s", 1, 2])]));
    // 特例を使うのは1人だけなので、要約に「2人以上」とは書かない
    expect(summarizeForAssistant(mk([spouse, c1], [lot], [all("自宅", ["c1", 1, 2], ["s", 1, 2])]), r)).not.toContain("1つの土地を2人以上");
    expect(r.assets[0].small).toBeUndefined();
    expect(r.assets[0].smallExtra).toEqual([expect.objectContaining({ acquirerId: "s", area: 150, selectedArea: 150, selectedValue: 45_000_000 })]);
    expect(r.assets[0].reduction).toBe(36_000_000);
    expect(amountOf(r, "自宅", "s")).toBe(9_000_000);
  });
});

describe("受け継いだ面積の一部だけに使う（付表1の⑤）", () => {
  it("1人で受け継いだ300㎡のうち100㎡だけ：⑥ ＝ 9,000万円 × 100 ／ 300 ＝ 3,000万円、減額2,400万円", () => {
    const r = calculate(mk([c1], [home("自宅", 300, 90_000_000, "c1", { ...HOME, ...LIVING }, undefined, { selectedSqm: 100 })], [all("自宅", ["c1", 1, 1])]));
    expect(r.blockers).toEqual([]);
    expect(r.assets[0].small).toEqual({ acquirerId: "c1", kind: "residence", rate: 80, area: 300, value: 90_000_000, selectedArea: 100, selectedValue: 30_000_000 });
    expect(r.assets[0].reduction).toBe(24_000_000);
  });

  it("持分の面積より小さい面積：妻は150㎡のうち100㎡、長男は150㎡全部", () => {
    // 妻：⑥ 4,500万 × 100/150 ＝ 3,000万 → 2,400万。長男：3,600万。合計 6,000万
    const lot = home("自宅", 300, 90_000_000, "s", HOME, [{ acquirerId: "c1", check: LIVING }], { selectedSqm: 100 });
    const r = calculate(mk([spouse, c1], [lot], [all("自宅", ["s", 1, 2], ["c1", 1, 2])]));
    expect(r.assets[0].small).toMatchObject({ area: 150, selectedArea: 100, selectedValue: 30_000_000 });
    expect(r.assets[0].smallExtra).toEqual([expect.objectContaining({ area: 150, selectedArea: 150, selectedValue: 45_000_000 })]);
    expect(r.assets[0].reduction).toBe(60_000_000);
    expect(amountOf(r, "自宅", "s")).toBe(21_000_000);
  });

  it("2人目の面積：長男は150㎡のうち50.5㎡だけ", () => {
    // 長男：⑥ 4,500万 × 50.5/150 ＝ 15,150,000 → 減額 12,120,000
    const lot = home("自宅", 300, 90_000_000, "s", HOME, [{ acquirerId: "c1", check: LIVING, selectedSqm: 50.5 }]);
    const r = calculate(mk([spouse, c1], [lot], [all("自宅", ["s", 1, 2], ["c1", 1, 2])]));
    expect(r.assets[0].smallExtra).toEqual([expect.objectContaining({ selectedArea: 50.5, selectedValue: 15_150_000 })]);
    expect(r.assets[0].reduction).toBe(36_000_000 + 12_120_000);
  });

  it("受け継いだ面積より大きい面積なら、受け継いだ面積（③）まで使う（止めない）", () => {
    const r = calculate(mk([c1], [home("自宅", 300, 90_000_000, "c1", { ...HOME, ...LIVING }, undefined, { selectedSqm: 500 })], [all("自宅", ["c1", 1, 1])]));
    expect(r.blockers).toEqual([]);
    expect(r.assets[0].small).toMatchObject({ area: 300, selectedArea: 300 });
    expect(r.assets[0].reduction).toBe(72_000_000);
  });

  it.each([0, -10, Number.NaN])("面積が正しくない（%s）ときは、直すか空けるよう止める", (v) => {
    const r = calculate(mk([c1], [home("自宅", 300, 90_000_000, "c1", { ...HOME, ...LIVING }, undefined, { selectedSqm: v })], [all("自宅", ["c1", 1, 1])]));
    expect(r.blockers.some((b) => b.includes("「自宅」で長男さんが小規模宅地等の特例を使う面積が正しくありません") && b.includes("空けて"))).toBe(true);
  });

  it("要約に「面積を指定」と出す", () => {
    const c = mk([c1], [home("自宅", 300, 90_000_000, "c1", { ...HOME, ...LIVING }, undefined, { selectedSqm: 100 })], [all("自宅", ["c1", 1, 1])]);
    expect(summarizeForAssistant(c, calculate(c))).toContain("特例を使う面積を指定");
  });
});

describe("面積を選んで、貸している土地にも限度面積を残す（措置法69条の4第2項）", () => {
  // 長男だけが相続。自宅 330㎡ 1億6,500万円（50万円/㎡）、アパートの敷地 200㎡ 自用地 4,000万円 → 貸家建付地 4,000万 × 0.82 ＝ 3,280万円。
  // 自宅に165㎡だけ選ぶ：165 × 200/330 ＝ 100㎡ → 貸している土地に 200 − 100 ＝ 100㎡ 残る（40×16,500 ＋ 66×10,000 ＝ 1,320,000）。
  // 自宅：⑥ 1億6,500万 × 165/330 ＝ 8,250万 → 6,600万。アパート：⑥ 3,280万 × 100/200 ＝ 1,640万 → 50% で 820万
  const persons = [c1];
  const allocations = [all("自宅", ["c1", 1, 1]), all("アパート", ["c1", 1, 1])];
  const apt = rental("アパート", 200, 40_000_000, "c1", RENT_ON);

  it("自宅に165㎡、アパートに100㎡を割り当てる", () => {
    const r = calculate(mk(persons, [home("自宅", 330, 165_000_000, "c1", { ...HOME, ...LIVING }, undefined, { selectedSqm: 165 }), apt], allocations));
    expect(r.blockers).toEqual([]);
    const [h, a] = r.assets;
    expect(a.valuation.value).toBe(32_800_000);
    expect(h.small).toMatchObject({ kind: "residence", area: 330, selectedArea: 165, selectedValue: 82_500_000 });
    expect(h.reduction).toBe(66_000_000);
    expect(a.small).toMatchObject({ kind: "rental", rate: 50, area: 200, selectedArea: 100, selectedValue: 16_400_000 });
    expect(a.reduction).toBe(8_200_000);
    // 限度面積の組み合わせ：自宅 × 200/330 ＋ 貸付 ≦ 200㎡
    expect((h.small!.selectedArea * 200) / 330 + a.small!.selectedArea).toBeLessThanOrEqual(200);
    const w = r.warnings.find((x) => x.includes("人に貸していた土地と合わせて200㎡まで"));
    expect(w).toContain("「自宅」に165㎡");
    expect(w).toContain("「アパート」は残り100㎡分");
  });

  it("面積を選ばなければ、これまでどおり自宅に330㎡全部を使い、アパートには使わない", () => {
    const r = calculate(mk(persons, [home("自宅", 330, 165_000_000, "c1", { ...HOME, ...LIVING }), apt], allocations));
    expect(r.assets[0].small).toMatchObject({ selectedArea: 330 });
    expect(r.assets[0].reduction).toBe(132_000_000);
    expect(r.assets[1].small).toBeUndefined();
    expect(r.assets[1].reduction).toBe(0);
  });
});

describe("アパートの敷地を2人で受け継ぎ、2人とも貸付を続ける", () => {
  // 300㎡ 自用地 6,000万円 → 貸家建付地 4,920万円。長男・長女 1/2 ずつ：③150㎡ ④2,460万円ずつ。
  // 貸付事業用は合計200㎡まで → 2人の分を合わせて200㎡（同じ価額なので、入力順に長男150㎡・長女は残り50㎡）
  const lot = rental("アパート", 300, 60_000_000, "c1", RENT_ON, [{ acquirerId: "c2", check: { continues: "yes", keep: "yes" } }]);
  const allocations = [all("アパート", ["c1", 1, 2], ["c2", 1, 2])];

  it("それぞれの持分の面積で付表1の行を作り、合わせて200㎡までにする", () => {
    const r = calculate(mk([c1, c2], [lot], allocations));
    expect(r.blockers).toEqual([]);
    const line = r.assets[0];
    expect(line.valuation.value).toBe(49_200_000);
    expect(line.small).toEqual({ acquirerId: "c1", kind: "rental", rate: 50, area: 150, value: 24_600_000, selectedArea: 150, selectedValue: 24_600_000 });
    expect(line.smallExtra).toEqual([{ acquirerId: "c2", kind: "rental", rate: 50, area: 150, value: 24_600_000, selectedArea: 50, selectedValue: 8_200_000 }]);
    expect(line.reduction).toBe(12_300_000 + 4_100_000);
    expect(amountOf(r, "アパート", "c1")).toBe(12_300_000);
    expect(amountOf(r, "アパート", "c2")).toBe(20_500_000);
    const w = r.warnings.find((x) => x.includes("200㎡まで"))!;
    expect(w).toContain("「アパート」（長男さんの分）に150㎡");
    expect(w).toContain("「アパート」（長女さんの分）は残り50㎡分");
    expect(w).toContain("どの土地（どの人の分）に割り当てるか");
  });

  it("長女が申告期限までに貸付をやめるなら、長女の分には使わない", () => {
    const stop = rental("アパート", 300, 60_000_000, "c1", RENT_ON, [{ acquirerId: "c2", check: { continues: "no", keep: "yes" } }]);
    const r = calculate(mk([c1, c2], [stop], allocations));
    expect(r.assets[0].small).toMatchObject({ acquirerId: "c1", selectedArea: 150 });
    expect(r.assets[0].smallExtra).toBeUndefined();
    expect(r.assets[0].reduction).toBe(12_300_000);
  });

  it("一部が空いているときは、貸している部分（面積×賃貸割合、価額は貸している部分の評価額×持分）だけ。案内は1回", () => {
    // 賃貸割合 0.8：③ 150 × 0.8 ＝ 120㎡ずつ、④ ＝ 貸している部分の評価額 × 1/2
    const part = rental("アパート", 300, 60_000_000, "c1", RENT_ON, [{ acquirerId: "c2", check: { continues: "yes", keep: "yes" } }], { rentRatio: 0.8 });
    const r = calculate(mk([c1, c2], [part], allocations));
    const v = valueAsset(part);
    expect(v.rentedLandPart).toBeGreaterThan(0);
    const half = Math.floor(v.rentedLandPart! / 2);
    expect(r.assets[0].small).toMatchObject({ area: 120, value: half, selectedArea: 120 });
    expect(r.assets[0].smallExtra).toEqual([expect.objectContaining({ area: 120, value: half, selectedArea: 80 })]);
    expect(r.warnings.filter((w) => w.includes("空き部屋があるため"))).toHaveLength(1);
  });
});

describe("限度面積を超えるときは、どの人の分に割り当てるかも家族全体の相続税で選ぶ", () => {
  // 自宅 400㎡ 1億2,000万円（30万円/㎡）を妻と同居の長男で1/2ずつ、預金1億円は長男。
  // 妻の税額は配偶者の税額軽減で0円なので、長男の分（200㎡）を先に、妻の分は残り130㎡にした方が家族全体の相続税が少ない
  const lot = home("自宅", 400, 120_000_000, "s", HOME, [{ acquirerId: "c1", check: LIVING }]);
  const r = calculate(mk([spouse, c1], [lot, dep("預金", 100_000_000)], [all("自宅", ["s", 1, 2], ["c1", 1, 2]), all("預金", ["c1", 1, 1])]));

  it("長男200㎡・妻130㎡", () => {
    expect(r.blockers).toEqual([]);
    expect(r.assets[0].smallExtra).toEqual([expect.objectContaining({ acquirerId: "c1", area: 200, selectedArea: 200, selectedValue: 60_000_000 })]);
    expect(r.assets[0].small).toMatchObject({ acquirerId: "s", area: 200, selectedArea: 130, selectedValue: 39_000_000 });
    expect(r.assets[0].reduction).toBe(48_000_000 + 31_200_000);
    expect(of(r, "s").payable).toBe(0);
    const w = r.warnings.find((x) => x.includes("330㎡"))!;
    expect(w).toContain("家族全体で納める相続税がいちばん少なくなるように");
    expect(w).toContain("「自宅」（長男さんの分）に200㎡、「自宅」（妻さんの分）は残り130㎡分");
  });

  it("妻の分を先にするより、納める相続税が少ない", () => {
    // 妻の分を先にした場合：長男の自宅の取得価額は 6,000万 − 3,120万（130㎡分）
    const spouseFirst = calculate(
      mk([spouse, c1], [home("自宅", 400, 120_000_000, "s", HOME, [{ acquirerId: "c1", check: LIVING, selectedSqm: 130 }]), dep("預金", 100_000_000)], [all("自宅", ["s", 1, 2], ["c1", 1, 2]), all("預金", ["c1", 1, 1])]),
    );
    expect(spouseFirst.assets[0].small).toMatchObject({ selectedArea: 200 });
    expect(r.totalPayable).toBeLessThan(spouseFirst.totalPayable);
  });

  // 自宅を妻と長男、アパート2つ（または3つ）を長男と長女で1/2ずつ。候補は6つ（または8つ）
  const apts = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      rental(`アパート${i + 1}`, 200, 100_000_000 + i * 20_000_000, i % 2 ? "c2" : "c1", RENT_ON, [{ acquirerId: i % 2 ? "c1" : "c2", check: RENT_ON }]),
    );
  const allocs = (n: number) => [
    all("自宅", ["s", 1, 2], ["c1", 1, 2]),
    ...Array.from({ length: n }, (_, i) => all(`アパート${i + 1}`, ["c1", 1, 2], ["c2", 1, 2])),
    all("預金", ["c2", 1, 1]),
  ];
  const twoOrders = (n: number) =>
    [
      home("自宅", 400, 200_000_000, "s", HOME, [{ acquirerId: "c1", check: LIVING }]),
      home("自宅", 400, 200_000_000, "c1", { ...HOME, ...LIVING }, [{ acquirerId: "s" }]),
    ].map((h) => calculate(mk([spouse, c1, c2], [h, ...apts(n), dep("預金", 100_000_000)], allocs(n))));

  it("候補が6つでも、妻と長男のどちらを先に入れたかで税額が変わらない（すべての割り当て順を試す）", () => {
    const [a, b] = twoOrders(2);
    expect(a.blockers).toEqual([]);
    expect(a.totalPayable).toBe(b.totalPayable);
    const sel = (r: ReturnType<typeof calculate>, id: string) =>
      [r.assets[0].small, ...(r.assets[0].smallExtra ?? [])].find((d) => d?.acquirerId === id)?.selectedArea ?? 0;
    expect(sel(a, "s")).toBe(sel(b, "s"));
    expect(sel(a, "c1")).toBe(sel(b, "c1"));
  });

  it("候補が多くて既定の順にするときも、同じ条件なら配偶者の分を後にする（入れた順で税額が変わらない）", () => {
    const [a, b] = twoOrders(3);
    expect(a.blockers).toEqual([]);
    expect(a.totalPayable).toBe(b.totalPayable);
    const s1 = [a.assets[0].small, ...(a.assets[0].smallExtra ?? [])].find((d) => d?.acquirerId === "c1");
    const s2 = [a.assets[0].small, ...(a.assets[0].smallExtra ?? [])].find((d) => d?.acquirerId === "s");
    expect(s1?.selectedArea ?? 0).toBeGreaterThanOrEqual(s2?.selectedArea ?? 0);
  });
});

describe("マンションの敷地権を2人で受け継ぐ", () => {
  it("③ ＝ 特例の対象にする敷地権の面積 × 持分、④ ＝ 敷地利用権の部分 × 持分", () => {
    const condo: CondoAsset = {
      id: "部屋",
      kind: "condo",
      label: "部屋",
      location: "x",
      landValueBeforeCorrection: 30_000_000,
      buildingFixedAssetValue: 10_000_000,
      builtYearsMonths: { years: 10, months: 0 },
      totalFloors: 10,
      floor: 3,
      landShareSqm: 40,
      exclusiveAreaSqm: 70,
      smallResidential: { applies: true, acquirerId: "s", check: HOME, landShareSqm: 30, others: [{ acquirerId: "c1", check: LIVING }] },
    };
    const r = calculate(mk([spouse, c1], [condo], [all("部屋", ["s", 1, 2], ["c1", 1, 2])]));
    expect(r.blockers).toEqual([]);
    const total = r.assets[0].valuation.value;
    const landOnly = valueAsset({ ...condo, buildingFixedAssetValue: 0 }).value;
    const half = Math.floor(total / 2);
    const landPart = Math.floor((half * landOnly) / total);
    expect(r.assets[0].small).toMatchObject({ acquirerId: "s", area: 15, selectedArea: 15 });
    expect(r.assets[0].smallExtra).toEqual([expect.objectContaining({ acquirerId: "c1", area: 15, selectedArea: 15 })]);
    // 端数は先頭の人（妻）に寄せるので、妻の④は長男の④以上
    expect(r.assets[0].smallExtra![0].value).toBe(landPart);
    expect(r.assets[0].small!.value).toBeGreaterThanOrEqual(landPart);
  });
});

describe("2人目以降の入力のまちがい", () => {
  const allocations = [all("自宅", ["s", 1, 2], ["c1", 1, 2])];

  it("家族の一覧にいない人は、その人の分を計算に入れず知らせる（止めない）", () => {
    const r = calculate(mk([spouse, c1], [home("自宅", 300, 90_000_000, "s", HOME, [{ acquirerId: "gone", check: LIVING }])], allocations));
    expect(r.blockers).toEqual([]);
    expect(r.assets[0].smallExtra).toBeUndefined();
    expect(r.assets[0].reduction).toBe(36_000_000);
    expect(r.warnings.some((w) => w.includes("家族の一覧にいない人が入っているため"))).toBe(true);
  });

  it("1人目と同じ人・同じ人を2回入れたときは、1回分だけ計算する", () => {
    const r = calculate(
      mk(
        [spouse, c1],
        [home("自宅", 300, 90_000_000, "s", HOME, [{ acquirerId: "s", check: LIVING }, { acquirerId: "c1", check: LIVING }, { acquirerId: "c1", check: LIVING }])],
        allocations,
      ),
    );
    expect(r.blockers).toEqual([]);
    expect(r.assets[0].smallExtra).toHaveLength(1);
    expect(r.assets[0].reduction).toBe(72_000_000);
    expect(r.warnings.filter((w) => w.includes("が2回入っています"))).toHaveLength(2);
  });

  it("まだ人を選んでいない行は何もしない", () => {
    const r = calculate(mk([spouse, c1], [home("自宅", 300, 90_000_000, "s", HOME, [{ acquirerId: "" }])], allocations));
    expect(r.blockers).toEqual([]);
    expect(r.assets[0].smallExtra).toBeUndefined();
    expect(r.warnings.some((w) => w.includes("小規模宅地等"))).toBe(false);
  });

  it("2人目がこの土地を受け継いでいなければ、名前つきで知らせる", () => {
    const r = calculate(mk([spouse, c1, c2], [home("自宅", 300, 90_000_000, "s", HOME, [{ acquirerId: "c2", check: LIVING }])], allocations));
    expect(r.warnings).toContain("「自宅」の小規模宅地等の特例を使う長女さんが、この土地を取得していません。");
    expect(r.assets[0].reduction).toBe(36_000_000);
  });

  it("2人目の分が未分割なら、特例を使わずに計算すると名前つきで1回知らせる", () => {
    const r = calculate(mk([spouse, c1], [home("自宅", 300, 90_000_000, "s", HOME, [{ acquirerId: "c1", check: LIVING }])], [all("自宅", ["s", 1, 2])], { undivided: true }));
    expect(r.assets[0].small).toMatchObject({ acquirerId: "s" });
    expect(r.assets[0].smallExtra).toBeUndefined();
    expect(r.warnings.filter((w) => w.includes("「自宅」（長男さんの分）は分け方が決まっていないため"))).toHaveLength(1);
  });
});

describe("課税価格が同じでも、端数のために納める税額が100円違うことを説明する", () => {
  it("子3人が1/3ずつ：総額930万円を按分割合 0.3333333334・0.3333333333・0.3333333333 で分ける", () => {
    // 預金1.2億円 − 基礎控除4,800万 ＝ 7,200万 → 2,400万ずつ × 15% − 50万 ＝ 310万 × 3 ＝ 930万。
    // 長男 930万 × 0.3333333334 ＝ 3,100,000.0（切捨て 3,100,000）、ほかの2人は 3,099,999 → 100円未満切捨てで 3,099,900
    const r = calculate(mk([c1, c2, c3], [dep("預金", 120_000_000)], [all("預金", ["c1", 1, 3], ["c2", 1, 3], ["c3", 1, 3])]));
    expect(r.totalTax).toBe(9_300_000);
    expect(r.persons.map((p) => p.payable)).toEqual([3_100_000, 3_099_900, 3_099_900]);
    const w = r.warnings.find((x) => x.includes("課税価格が同じですが"))!;
    expect(w).toContain("長男さん・長女さん・二男さんは課税価格が同じですが、納める相続税が100円違います。");
    expect(w).toContain("相続税法基本通達17-1");
    expect(w).toContain("100円未満を切り捨てる");
  });

  it("2割加算など本当の違いがあるときや、納める額が同じときは出さない", () => {
    const r = calculate(mk([c1, c2], [dep("預金", 120_000_000)], [all("預金", ["c1", 1, 2], ["c2", 1, 2])]));
    expect(r.persons[0].payable).toBe(r.persons[1].payable);
    expect(r.warnings.some((w) => w.includes("課税価格が同じですが"))).toBe(false);
  });
});

describe("書類を作る API に送られた入力の確認（2人目以降・特例を使う面積）", () => {
  const withRelief = (smallResidential: unknown) =>
    ({ ...mk([spouse, c1], [home("自宅", 300, 90_000_000, "s", HOME)], []), assets: [{ ...home("自宅", 300, 90_000_000, "s", HOME), smallResidential }] }) as unknown;

  it("ふつうの入力・空き（null）は通す", () => {
    expect(checkCase(withRelief({ applies: true, acquirerId: "s", selectedSqm: 120.5, others: [{ acquirerId: "c1", selectedSqm: 0 }, { acquirerId: "" }] })).ok).toBe(true);
    expect(checkCase(withRelief({ applies: true, acquirerId: "s", selectedSqm: null, others: [] })).ok).toBe(true);
  });

  it("人数が多すぎる・面積が負の数や数でない・id が文字でないときは断る", () => {
    const many = Array.from({ length: CASE_LIMITS.smallLandOthers + 1 }, (_, i) => ({ acquirerId: `p${i}` }));
    expect(checkCase(withRelief({ applies: true, others: many }))).toEqual({ ok: false, error: expect.stringContaining(`${CASE_LIMITS.smallLandOthers}件まで`) });
    expect(checkCase(withRelief({ applies: true, selectedSqm: -1 }))).toEqual({ ok: false, error: expect.stringContaining("0以上の数") });
    expect(checkCase(withRelief({ applies: true, others: [{ acquirerId: "c1", selectedSqm: "100" }] }))).toEqual({ ok: false, error: expect.stringContaining("0以上の数") });
    expect(checkCase(withRelief({ applies: true, others: [{ acquirerId: 1 }] })).ok).toBe(false);
    expect(checkCase(withRelief({ applies: true, others: "c1" })).ok).toBe(false);
  });
});
