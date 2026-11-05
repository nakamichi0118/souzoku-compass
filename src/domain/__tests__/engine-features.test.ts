/**
 * 未分割・代償金・相続時精算課税・相次相続控除・扶養義務者への控除の移し・相続人不存在・小規模宅地等の種類の計算。
 * 期待値は、テストごとのコメントの手計算（申告書の欄の順）で出したもの。亡くなった日はすべて 2026-03-15。
 */
import { describe, expect, it } from "vitest";
import { SR_MAX_PERMUTE, calculate } from "../tax/engine";
import { consultPoints } from "@/lib/consult";
import type { Asset, Case, Person } from "../types";
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
const of = (r: ReturnType<typeof calculate>, id: string) => r.persons.find((p) => p.person.id === id)!;
const land = (id: string, areaSqm: number, value: number, acquirerId: string, over: Partial<Extract<Asset, { kind: "land" }>> = {}, check?: SmallResidentialCheck): Asset => ({
  id,
  kind: "land",
  label: id,
  location: "x",
  areaSqm,
  landUse: "宅地",
  method: { type: "manual", value },
  smallResidential: { applies: true, acquirerId, ...(check ? { check } : {}) },
  ...over,
});

describe("未分割（相続税法55条）", () => {
  it("分け方が決まっていない財産は法定相続分で取得したものとし、配偶者の税額軽減は使えない", () => {
    // 預金1.5億円を未分割。妻 1/2 = 7,500万、子 1/4 = 3,750万ずつ（すべて未分割財産）
    // 課税遺産総額 1.5億 − 4,800万 = 1億200万 → 5,100万×30%−700万 = 830万、2,550万×15%−50万 = 332.5万×2 → 総額 1,495万
    // 第5表：③分割財産 0、⑤未分割 7,500万、⑧ 0 → 軽減 0。妻は 1,495万×1/2 = 747.5万を納める
    const r = calculate(mk([spouse, c1, c2], [dep("預金", 150_000_000)], [], { undivided: true }));
    expect(r.blockers).toEqual([]);
    expect(r.undivided).toBe(true);
    expect(r.assets[0].byPerson).toEqual([
      { personId: "s", amount: 75_000_000 },
      { personId: "c1", amount: 37_500_000 },
      { personId: "c2", amount: 37_500_000 },
    ]);
    expect(r.assets[0].undivided).toEqual(r.assets[0].byPerson);
    expect(of(r, "s").undivided).toBe(75_000_000);
    expect(of(r, "s").inherited).toBe(75_000_000);
    expect(r.totalTax).toBe(14_950_000);
    expect(r.spouse).toMatchObject({ divided: 0, undivided: 75_000_000, debtsOverUndivided: 0, spouseTaxable: 0, base: 0, credit: 0 });
    expect(of(r, "s").payable).toBe(7_475_000);
    expect(r.totalPayable).toBe(14_950_000);
    expect(r.warnings.some((w) => w.includes("申告期限後3年以内の分割見込書") && w.includes("更正の請求"))).toBe(true);
  });

  it("一部だけ決まった財産（穴埋め方式）：決まった分も合わせて法定相続分になるよう、足りない人に割り当てる。1円未満の端数は割合がいちばん大きい人に寄せる", () => {
    // 以前は残り1/2をさらに法定相続分（妻1/4・長男1/8・長女1/8）で分けていたが（積上げ）、相続税法55条の計算は
    // 「全体×法定相続分 − 分割で取得した額」の穴埋め方式（相基通55-1、税大ジャーナル22号）なので期待値を改めた。
    // 全体 100,000,001 × 妻1/2 = 50,000,000.5 − 分割分 50,000,000.5 = 0、長男・長女は 25,000,000.25 ずつ足りない
    // → 残り1/2を長男・長女で 1/4 ずつ。切捨て 50,000,000 + 25,000,000 + 25,000,000、残り1円は割合1/2（妻の分割分）へ
    const r = calculate(mk([spouse, c1, c2], [dep("預金", 100_000_001)], [all("預金", ["s", 1, 2])], { undivided: true }));
    expect(r.blockers).toEqual([]);
    expect(r.assets[0].byPerson).toEqual([
      { personId: "s", amount: 50_000_001 },
      { personId: "c1", amount: 25_000_000 },
      { personId: "c2", amount: 25_000_000 },
    ]);
    expect(r.assets[0].undivided).toEqual([
      { personId: "c1", amount: 25_000_000 },
      { personId: "c2", amount: 25_000_000 },
    ]);
    expect(of(r, "s").undivided).toBe(0);
    expect(r.warnings.some((w) => w.includes("すでに分け方が決まった財産も合わせて") && w.includes("遺言で相続分が決められている"))).toBe(true);
  });

  it("相続分が同じ人の端数は、生年月日の順で先の人（同じなら名前の順）に寄せる（家族の一覧の順や人のIDによらない）", () => {
    // 1,000,001円を長女（c2）・長男（c1）で 1/2 ずつ：500,000円ずつ、残り1円は年上の長男（c1）へ。一覧の順を変えても同じ
    const older = { ...c1, birthDate: "1970-04-01" };
    const younger = { ...c2, birthDate: "1973-08-01" };
    for (const persons of [
      [younger, older],
      [older, younger],
    ]) {
      const r = calculate(mk(persons, [dep("預金", 1_000_001)], [], { undivided: true }));
      const by = Object.fromEntries(r.assets[0].byPerson.map((b) => [b.personId, b.amount]));
      expect(by).toEqual({ c1: 500_001, c2: 500_000 });
    }
    // 人のIDを入れ替えても、同じ人（年上の長男）に寄せる
    const r = calculate(mk([{ ...older, id: "z9" }, { ...younger, id: "a1" }], [dep("預金", 1_000_001)], [], { undivided: true }));
    expect(Object.fromEntries(r.assets[0].byPerson.map((b) => [b.personId, b.amount]))).toEqual({ z9: 500_001, a1: 500_000 });
  });

  it("小規模宅地等は取得者が受け継ぐと決まった部分だけに使い、配偶者の税額軽減の基は第5表のとおり（未分割の部分は穴埋め方式）", () => {
    // 自宅 200㎡ 6,000万円のうち妻に1/2（3,000万・100㎡）。預金1億円は長男。残りの自宅1/2（3,000万）は未分割。
    // 以前は未分割の部分を法定相続分で 1,500万ずつにしていたが、穴埋め方式（相続税法55条・相基通55-1）に改めた：
    // 全体 1億6,000万 × 1/2 = 8,000万。妻 8,000万 − 3,000万 = 5,000万足りない、長男 8,000万 − 1億 < 0 → 0。未分割の3,000万は全部妻
    // 小規模宅地等：妻の分割分 3,000万×80% = 2,400万を減額（未分割の部分には使わない）→ 妻 6,000万−2,400万 = 3,600万、長男 1億
    // 課税価格 1億3,600万 − 4,200万 = 9,400万 → 4,700万×20%−200万 = 740万×2 → 総額 1,480万
    // 按分（10桁）：妻 0.2647058824 → 3,917,647円、長男 0.7352941176 → 10,882,352円
    // 第5表：③分割財産 3,600万−3,000万 = 600万、⑤未分割 3,000万、⑥ 0、⑧ 600万 → 1,480万×600万/1億3,600万 = 652,941円
    // 妻 3,917,647−652,941 = 3,264,706 → 3,264,700円、長男 10,882,300円
    const r = calculate(
      mk([spouse, c1], [land("自宅", 200, 60_000_000, "s"), dep("預金", 100_000_000)], [all("自宅", ["s", 1, 2]), all("預金", ["c1", 1, 1])], { undivided: true }),
    );
    expect(r.blockers).toEqual([]);
    expect(r.assets[0].byPerson).toEqual([{ personId: "s", amount: 36_000_000 }]);
    expect(r.assets[0].undivided).toEqual([{ personId: "s", amount: 30_000_000 }]);
    expect(r.assets[0].reduction).toBe(24_000_000);
    expect(r.assets[0].small).toMatchObject({ area: 100, value: 30_000_000, selectedArea: 100, kind: "residence", rate: 80 });
    expect(of(r, "s").taxable).toBe(36_000_000);
    expect(of(r, "c1").taxable).toBe(100_000_000);
    expect(r.totalTax).toBe(14_800_000);
    expect(r.spouse).toMatchObject({ divided: 6_000_000, debts: 0, undivided: 30_000_000, spouseTaxable: 6_000_000, base: 6_000_000, creditBase: 652_941, credit: 652_941 });
    expect(of(r, "s").computed).toBe(3_917_647);
    expect(of(r, "s").payable).toBe(3_264_700);
    expect(of(r, "c1").payable).toBe(10_882_300);
  });

  it("穴埋め方式：配偶者が分割で多く取得し、残りが未分割なら、未分割の財産は足りない兄弟姉妹へ（2割加算も正しくなる）", () => {
    // 配偶者・兄。預金A 1.2億は妻（分割済み）、預金B 1.2億は未分割。全体 2.4億 × 妻3/4 = 1.8億 − 1.2億 = 6,000万、兄 2.4億 × 1/4 = 6,000万
    // → B は 6,000万ずつ（積上げなら 9,000万/3,000万）。課税価格 妻 1.8億・兄 6,000万。課税遺産総額 2.4億 − 4,200万 = 1億9,800万
    // 妻 1億4,850万 × 40% − 1,700万 = 4,240万、兄 4,950万 × 20% − 200万 = 790万 → 総額 5,030万
    // 妻：算出税額 5,030万 × 0.75 = 3,772.5万。税額軽減は、法定相続分相当額 1.8億と第5表⑧（分割財産 1.2億）の少ない方 1.2億
    // → 5,030万 × 1.2億/2.4億 = 2,515万。納付 3,772.5万 − 2,515万 = 1,257.5万
    // 兄 5,030万 × 0.25 = 1,257.5万 ＋ 2割加算 251.5万 = 1,509万。合計 2,766.5万
    const w: Person = { id: "w", name: "妻", relation: "spouse" };
    const b: Person = { id: "b", name: "兄", relation: "sibling" };
    const r = calculate(mk([w, b], [dep("A", 120_000_000), dep("B", 120_000_000)], [all("A", ["w", 1, 1])], { undivided: true }));
    expect(r.blockers).toEqual([]);
    expect(r.assets[1].byPerson).toEqual([
      { personId: "w", amount: 60_000_000 },
      { personId: "b", amount: 60_000_000 },
    ]);
    expect(r.totalTax).toBe(50_300_000);
    expect(of(r, "w")).toMatchObject({ taxable: 180_000_000, spouseCredit: 25_150_000, payable: 12_575_000 });
    expect(of(r, "b")).toMatchObject({ taxable: 60_000_000, surcharge: 2_515_000, payable: 15_090_000 });
    expect(r.totalPayable).toBe(27_665_000);
  });

  it("穴埋め方式：法定相続分より多く分割で取得した人には未分割の部分を割り当てず、相続人でない人への分は全体から除く", () => {
    // 預金A 9,000万は長男、預金B 3,000万を内縁の妻（相続人でない受遺者）、預金C 6,000万は未分割。子2人
    // 相続人で分ける全体 = 9,000万 + 3,000万 + 6,000万 − 3,000万（内縁の妻）= 1億5,000万、× 1/2 = 7,500万
    // 長男 7,500万 − 9,000万 < 0 → 0、長女 7,500万 → C 6,000万は全部長女
    const naien: Person = { id: "n", name: "内縁の妻", relation: "other" };
    const r = calculate(
      mk([c1, c2, naien], [dep("A", 90_000_000), dep("B", 30_000_000), dep("C", 60_000_000)], [all("A", ["c1", 1, 1]), all("B", ["n", 1, 1])], { undivided: true }),
    );
    expect(r.blockers).toEqual([]);
    expect(r.assets[2].byPerson).toEqual([{ personId: "c2", amount: 60_000_000 }]);
    expect(of(r, "c2").undivided).toBe(60_000_000);
    expect(of(r, "c1").undivided).toBe(0);
  });

  it("全部が未分割の宅地には小規模宅地等を使わず、その旨と後から使う方法を知らせる", () => {
    const r = calculate(mk([spouse, c1], [land("自宅", 200, 60_000_000, "s"), dep("預金", 40_000_000)], [all("預金", ["c1", 1, 1])], { undivided: true }));
    expect(r.blockers).toEqual([]);
    expect(r.assets[0].reduction).toBe(0);
    expect(r.assets[0].small).toBeUndefined();
    expect(r.warnings.some((w) => w.includes("「自宅」は分け方が決まっていないため") && w.includes("更正の請求"))).toBe(true);
  });

  it("配偶者の債務が未分割財産より多いときは、その差を分割財産から引く（第5表⑥）", () => {
    // 預金1億円を未分割（妻・長男 5,000万ずつ）、保険金2,000万（妻。非課税1,000万）は分割財産と同じ扱い。
    // 妻の葬式費用 6,000万（説明のための大きな額）→ ⑥ = 6,000万−5,000万 = 1,000万、③ 1,000万 → ⑧ 0
    const r = calculate(
      mk([spouse, c1], [dep("預金", 100_000_000), { id: "保険", kind: "insurance", label: "保険", amount: 20_000_000, recipientId: "s" }], [], {
        undivided: true,
        debts: [{ id: "f", kind: "funeral", label: "葬式", amount: 60_000_000, bearers: [{ personId: "s", amount: 60_000_000 }] }],
      }),
    );
    expect(r.blockers).toEqual([]);
    expect(r.spouse).toMatchObject({ divided: 10_000_000, debts: 60_000_000, undivided: 50_000_000, debtsOverUndivided: 10_000_000, spouseTaxable: 0 });
  });

  it("負担する人を入れていない債務は、未分割なら法定相続分で負担したものとする", () => {
    // 1,000,001円 → 妻 500,000（+端数1円）、長男・長女 250,000
    const r = calculate(
      mk([spouse, c1, c2], [dep("預金", 100_000_000)], [], {
        undivided: true,
        debts: [{ id: "d", kind: "debt", label: "借入", amount: 1_000_001, bearers: [] }],
      }),
    );
    expect(r.blockers).toEqual([]);
    expect([of(r, "s").debts, of(r, "c1").debts, of(r, "c2").debts]).toEqual([500_001, 250_000, 250_000]);
    expect(r.warnings.some((w) => w.includes("「借入」は負担する人が決まっていない"))).toBe(true);
  });

  it("チェックがないときは、取得者が決まっていない財産で止め、分け方の画面のチェックを案内する", () => {
    const none = calculate(mk([spouse, c1], [dep("預金", 50_000_000)], []));
    expect(none.blockers.some((b) => b.includes("「分け方がまだ決まっていない」にチェック"))).toBe(true);
    const part = calculate(mk([spouse, c1], [dep("預金", 50_000_000)], [all("預金", ["s", 1, 2])]));
    expect(part.blockers.some((b) => b.includes("（いま 50%）") && b.includes("「分け方がまだ決まっていない」"))).toBe(true);
    // 合計が1を超えるときは、チェックがあっても止める
    const over = calculate(mk([spouse, c1], [dep("預金", 50_000_000)], [all("預金", ["s", 1, 2], ["c1", 2, 3])], { undivided: true }));
    expect(over.blockers.some((b) => b.includes("取得割合の合計が1になっていません"))).toBe(true);
  });

  it("全部の財産の分け方が決まっていれば、チェックがあってもなくても結果は同じ。チェックがあるときは、そのことを知らせる", () => {
    // 「すべて法定相続分どおりにする」を押したあとにチェックが残っていると、分け方が決まったものとして計算される（税額軽減・特例も使う）ので、知らせる
    const assets = [land("自宅", 200, 50_000_000, "s"), dep("預金", 80_000_000)];
    const allocs = [all("自宅", ["s", 1, 1]), all("預金", ["s", 1, 4], ["c1", 3, 4])];
    const a = calculate(mk([spouse, c1], assets, allocs));
    const b = calculate(mk([spouse, c1], assets, allocs, { undivided: true }));
    expect(b.undivided).toBe(false);
    expect(b.persons.map((p) => [p.taxable, p.spouseCredit, p.payable])).toEqual(a.persons.map((p) => [p.taxable, p.spouseCredit, p.payable]));
    expect(b.spouse).toEqual(a.spouse);
    const notice = (w: string) => w.includes("「分け方がまだ決まっていない」にチェックがありますが、すべての財産の分け方が入っている");
    expect(b.warnings.filter(notice)).toHaveLength(1);
    expect(b.warnings.filter((w) => !notice(w))).toEqual(a.warnings);
    expect(a.warnings.some(notice)).toBe(false);
  });
});

describe("代償金（相基通11の2-9）", () => {
  it("払う人の取得財産から引き、受け取る人に足す", () => {
    // 預金1億円を長男、長男→長女 3,000万。長男 7,000万・長女 3,000万
    // 課税遺産総額 1億−4,200万 = 5,800万 → 2,900万×15%−50万 = 385万×2 → 総額 770万。長男 539万、長女 231万
    const r = calculate(mk([c1, c2], [dep("預金", 100_000_000)], [all("預金", ["c1", 1, 1])], { compensation: [{ fromId: "c1", toId: "c2", amount: 30_000_000 }] }));
    expect(r.blockers).toEqual([]);
    expect(of(r, "c1")).toMatchObject({ inherited: 70_000_000, compensationOut: 30_000_000, compensationIn: 0, taxable: 70_000_000, payable: 5_390_000 });
    expect(of(r, "c2")).toMatchObject({ inherited: 30_000_000, compensationIn: 30_000_000, acquiresSomething: true, taxable: 30_000_000, payable: 2_310_000 });
  });

  it("代償金だけを受け取った人も財産を取得した人なので、3年以内の贈与を足す", () => {
    const r = calculate(
      mk([c1, c2], [dep("預金", 100_000_000)], [all("預金", ["c1", 1, 1])], {
        compensation: [{ fromId: "c1", toId: "c2", amount: 30_000_000 }],
        priorGifts: [{ personId: "c2", date: "2025-05-01", amount: 1_000_000, giftTaxPaid: 0 }],
      }),
    );
    expect(of(r, "c2").gifts).toBe(1_000_000);
    expect(of(r, "c2").taxable).toBe(31_000_000);
  });

  it("保険金を代償金にあてる：保険金も払う人が受け取った財産として数え、取得財産の価額から引く", () => {
    // 長男：預金2,000万＋保険金5,000万（非課税1,000万）− 代償金4,000万 = 2,000万。長女：預金3,000万＋4,000万 = 7,000万
    const r = calculate(
      mk(
        [c1, c2],
        [dep("A", 20_000_000), dep("B", 30_000_000), { id: "保険", kind: "insurance", label: "保険", amount: 50_000_000, recipientId: "c1" }],
        [all("A", ["c1", 1, 1]), all("B", ["c2", 1, 1])],
        { compensation: [{ fromId: "c1", toId: "c2", amount: 40_000_000 }] },
      ),
    );
    expect(r.blockers).toEqual([]);
    expect(of(r, "c1")).toMatchObject({ inherited: -20_000_000, acquired: 20_000_000, taxable: 20_000_000 });
    expect(of(r, "c2").taxable).toBe(70_000_000);
  });

  it.each([
    ["金額が0円", { fromId: "c1", toId: "c2", amount: 0 }, "1円以上の整数"],
    ["金額が整数でない", { fromId: "c1", toId: "c2", amount: 1.5 }, "1円以上の整数"],
    ["同じ人", { fromId: "c1", toId: "c1", amount: 1_000_000 }, "同じ人"],
    ["一覧にいない人", { fromId: "c1", toId: "x", amount: 1_000_000 }, "相続人の一覧から選んで"],
    ["受け継ぐ財産より多い", { fromId: "c1", toId: "c2", amount: 30_000_001 }, "受け継ぐ財産の評価額（30,000,000円）より多く"],
  ])("%s なら止める", (_, comp, word) => {
    const r = calculate(mk([c1, c2], [dep("A", 30_000_000), dep("B", 70_000_000)], [all("A", ["c1", 1, 1]), all("B", ["c2", 1, 1])], { compensation: [comp] }));
    expect(r.blockers.some((b) => b.includes(word))).toBe(true);
  });
});

describe("相続時精算課税（相続税法21条の15・21条の16）", () => {
  const settled = (gifts: Case["priorGifts"], deposit = 50_000_000) =>
    calculate({ ...mk([c1], [dep("預金", deposit)], [all("預金", ["c1", 1, 1])], { priorGifts: gifts }), decedent: { ...decedent, settlementGift: true } });

  it("期間に関係なく足し、令和6年以後の贈与は年110万円を引く。納めた贈与税は⑰で引く", () => {
    // ② = 2023年 2,000万（全額）＋ 2024年 (1,000万+100万)−110万 = 990万 ＋ 2025年 100万−110万 → 0 = 2,990万
    // 課税価格 5,000万+2,990万 = 7,990万、課税遺産総額 7,990万−3,600万 = 4,390万 → 4,390万×20%−200万 = 678万
    // ⑯ 678万 − ⑰ 98万 = 580万
    const r = settled([
      { personId: "c1", date: "2023-06-01", amount: 20_000_000, giftTaxPaid: 0, settlement: true },
      { personId: "c1", date: "2024-05-10", amount: 10_000_000, giftTaxPaid: 980_000, settlement: true },
      { personId: "c1", date: "2024-08-01", amount: 1_000_000, giftTaxPaid: 0, settlement: true },
      { personId: "c1", date: "2025-05-10", amount: 1_000_000, giftTaxPaid: 0, settlement: true },
    ]);
    expect(r.blockers).toEqual([]);
    const p = r.persons[0];
    expect(p.settlementGifts).toBe(29_900_000);
    expect(p.gifts).toBe(0); // 3年以内でも暦年課税の加算には入れない
    expect(p.giftTaxCredit).toBe(0);
    expect(p.net).toBe(79_900_000);
    expect(r.totalTax).toBe(6_780_000);
    expect(p.afterCredits).toBe(6_780_000);
    expect(p.settlementCredit).toBe(980_000);
    expect(p.payable).toBe(5_800_000);
    expect(p.refund).toBe(0);
    expect(r.warnings.some((w) => w.includes("110万円"))).toBe(true);
  });

  it("引ききれない贈与税は還付（1円単位）", () => {
    // 課税価格 1,000万+3,000万 = 4,000万 → 課税遺産総額 400万 → 40万。⑯ 40万 − ⑰ 100万 = −60万 → 還付 60万
    const r = settled([{ personId: "c1", date: "2021-04-01", amount: 30_000_000, giftTaxPaid: 1_000_000, settlement: true }], 10_000_000);
    expect(r.persons[0].payable).toBe(0);
    expect(r.persons[0].refund).toBe(600_000);
    expect(r.totalRefund).toBe(600_000);
    expect(r.warnings.some((w) => w.includes("還付"))).toBe(true);
  });

  it("精算課税の贈与だけを受けた人も財産を取得したものとし、3年以内の暦年課税の贈与も足す", () => {
    // 長女：② 500万−110万 = 390万、⑤ 100万 → ⑥ 490万。長男 6,000万。合計 6,490万 − 4,200万 = 2,290万
    // 1,145万×15%−50万 = 1,217,500 ×2 = 2,435,000。長女 2,435,000×490/6,490 → 183,844円、長男 2,251,155円
    const r = calculate(
      mk([c1, c2], [dep("預金", 60_000_000)], [all("預金", ["c1", 1, 1])], {
        priorGifts: [
          { personId: "c2", date: "2023-05-01", amount: 1_000_000, giftTaxPaid: 0 },
          { personId: "c2", date: "2024-06-01", amount: 5_000_000, giftTaxPaid: 0, settlement: true },
        ],
      }),
    );
    const b = of(r, "c2");
    expect(b.acquiresSomething).toBe(true);
    expect(b.settlementGifts).toBe(3_900_000);
    expect(b.gifts).toBe(1_000_000);
    expect(b.taxable).toBe(4_900_000);
    expect(r.totalTax).toBe(2_435_000);
    expect(b.computed).toBe(183_844);
    expect(b.payable).toBe(183_800);
    expect(of(r, "c1").payable).toBe(2_251_100);
  });

  it("精算課税を選んだと答えたのに、その贈与が入っていなければ贈与の一覧への入力を案内する", () => {
    const r = settled([]);
    const b = r.blockers.find((x) => x.includes("相続時精算課税"));
    expect(b).toContain("贈与の一覧");
    expect(b).not.toContain("税理士");
  });

  it("贈与の入力漏れは精算課税でも止める", () => {
    const r = settled([{ personId: "", date: "2024-05-10", amount: 10_000_000, giftTaxPaid: 0, settlement: true }]);
    expect(r.blockers.some((b) => b.includes("相続時精算課税の贈与（1件目") && b.includes("受け取った人"))).toBe(true);
  });
});

describe("相次相続控除（相続税法20条・第7表）", () => {
  const prior = (date: string, prevTax: number, prevAcquired: number) => ({ ...decedent, priorInheritanceTax: true, priorInheritance: { date, prevTax, prevAcquired } });
  const base = (d: Case["decedent"], persons: Person[] = [spouse, c1]) =>
    calculate({ ...mk(persons, [dep("預金", 100_000_000)], [all("預金", ...persons.map((p) => [p.id, 1, persons.length] as [string, number, number]))]), decedent: d });

  it("C/(B−A) が1を超えるときは1。相続人の純資産価額の割合で分け、税額を限度にする", () => {
    // E = 2020-01-10 → 2026-03-15 で6年。A 500万、B−A 5,500万、C 1億 → 1。総額 500万×4/10 = 200万
    // 妻・長男 100万ずつ。妻は配偶者の税額軽減で0円のため0、長男は 385万−100万 = 285万
    const r = base(prior("2020-01-10", 5_000_000, 60_000_000));
    expect(r.blockers).toEqual([]);
    expect(r.successive).toEqual({ prevTax: 5_000_000, prevAcquired: 60_000_000, netTotal: 100_000_000, years: 6, total: 2_000_000 });
    expect(of(r, "s").successiveCredit).toBe(0);
    expect(of(r, "c1").successiveCredit).toBe(1_000_000);
    expect(of(r, "c1").otherCredits).toBe(1_000_000);
    expect(of(r, "c1").payable).toBe(2_850_000);
  });

  it("C/(B−A) が1未満なら按分する（円未満切捨て）", () => {
    // A 3,000万、B−A 2億7,000万、C 1億、E 6 → 3,000万×1億/2.7億×4/10 = 4,444,444円。長男 2,222,222円
    const r = base(prior("2020-01-10", 30_000_000, 300_000_000));
    expect(r.successive?.total).toBe(4_444_444);
    expect(of(r, "c1").successiveCredit).toBe(2_222_222);
    expect(of(r, "c1").payable).toBe(1_627_700);
  });

  it("相続人でない受遺者は控除を受けないが、C には入る", () => {
    // 預金1億円を長男1/2・内縁の妻1/2。C 1億、総額 200万、長男 100万、内縁の妻 0
    const naien: Person = { id: "n", name: "内縁の妻", relation: "other" };
    const r = base(prior("2020-01-10", 5_000_000, 60_000_000), [c1, naien]);
    expect(r.successive?.netTotal).toBe(100_000_000);
    expect(of(r, "c1").successiveCredit).toBe(1_000_000);
    expect(of(r, "n").successiveCredit).toBe(0);
  });

  it("10年以上たっていれば使えない（1年未満切捨てで10年）", () => {
    const ten = base(prior("2016-03-15", 5_000_000, 60_000_000));
    expect(ten.successive).toBeUndefined();
    expect(ten.persons.every((p) => p.successiveCredit === 0)).toBe(true);
    expect(ten.warnings.some((w) => w.includes("10年以上"))).toBe(true);
    const nine = base(prior("2016-03-16", 5_000_000, 60_000_000));
    expect(nine.successive?.years).toBe(9);
    expect(nine.successive?.total).toBe(500_000);
  });

  it("前の相続の内容が入っていなければ、亡くなった方の画面での入力を案内する", () => {
    const r = base({ ...decedent, priorInheritanceTax: true });
    const b = r.blockers.find((x) => x.includes("相次相続控除"));
    expect(b).toContain("亡くなった方の画面");
    expect(b).not.toContain("税理士");
    expect(base(prior("2026-04-01", 5_000_000, 60_000_000)).blockers.some((x) => x.includes("前の相続の日"))).toBe(true);
  });
});

describe("10年以内の相続・相続時精算課税の「分からない」", () => {
  const one = (d: Partial<Case["decedent"]>) => calculate(mk([c1], [dep("預金", 80_000_000)], [all("預金", ["c1", 1, 1])], { decedent: { ...decedent, ...d } }));
  it("精算課税が分からないときは、確かめるまで税額を出さず、開示請求か税理士への相談を案内する", () => {
    const b = one({ settlementGift: "unknown" }).blockers.find((x) => x.includes("相続時精算課税"));
    expect(b).toContain("開示請求");
    expect(b).toContain("税理士");
    expect(consultPoints({ ...mk([c1], [], []), decedent: { ...decedent, settlementGift: "unknown" } }, null).some((x) => x.includes("相続時精算課税"))).toBe(true);
  });
  it("10年以内の相続が分からないときは、控除を見込まずに計算する（止めない）", () => {
    const r = one({ priorInheritanceTax: "unknown" });
    expect(r.blockers).toEqual([]);
    expect(r.successive).toBeUndefined();
    expect(consultPoints({ ...mk([c1], [], []), decedent: { ...decedent, priorInheritanceTax: "unknown" } }, null).some((x) => x.includes("10年以内"))).toBe(true);
  });
});

describe("扶養義務者の相続税額から引く未成年者控除・障害者控除（相続税法19条の3第2項・19条の4第3項）", () => {
  it("引ききれない分を、ほかの家族の相続税額の割合で引く。残りの1円は切り捨てた端数が大きい人に配る", () => {
    // 長男6,000万・長女3,000万・次男（9歳）1,000万。課税遺産総額 5,200万 → 1,733.3万×15%−50万 = 2,099,950 ×3 → 総額 6,299,800
    // 算出税額 長男 3,779,880・長女 1,889,940・次男 629,980。次男の未成年者控除 90万 → 本人 629,980、残り 270,020
    // 長男 270,020×2/3 = 180,013.3 → 180,013、長女 90,006.6 → 90,006、残り1円は端数（.6）が大きい長女 → 90,007
    const minor: Person = { id: "m", name: "次男", relation: "child", birthDate: "2016-06-01" };
    const r = calculate(
      mk([c1, c2, minor], [dep("A", 60_000_000), dep("B", 30_000_000), dep("C", 10_000_000)], [all("A", ["c1", 1, 1]), all("B", ["c2", 1, 1]), all("C", ["m", 1, 1])]),
    );
    expect(r.blockers).toEqual([]);
    expect(r.totalTax).toBe(6_299_800);
    const m = of(r, "m");
    expect(m.minorCredit).toBe(629_980);
    expect(m.minorExcess).toBe(270_020);
    expect(of(r, "c1").transfersIn).toEqual([{ fromId: "m", kind: "minor", amount: 180_013 }]);
    expect(of(r, "c2").transfersIn).toEqual([{ fromId: "m", kind: "minor", amount: 90_007 }]);
    expect(of(r, "c1").otherCredits).toBe(180_013);
    expect(of(r, "c1").payable).toBe(3_599_800);
    expect(of(r, "c2").payable).toBe(1_799_900);
    expect(m.payable).toBe(0);
    expect(r.warnings.some((w) => w.includes("相続税額の割合") && w.includes("話し合って"))).toBe(true);
  });

  it("順番：全員の未成年者控除 → その移し → 全員の障害者控除 → その移し", () => {
    // 総額 6,299,800 を X（障害者40歳）10%・M（15歳）1%・Y 89% → 629,980・62,998・5,606,822
    // M の未成年者控除 30万：本人 62,998、残り 237,002 → X 23,939.6・Y 213,062.4、残り1円は端数が大きい X → 23,940
    // X の障害者控除 450万：残りの税額 606,040 だけ本人から引き、残り 3,893,960 を Y から引く → Y 1,499,800
    const X: Person = { id: "x", name: "長男", relation: "child", birthDate: "1985-06-01", disability: "general" };
    const M: Person = { id: "m", name: "次男", relation: "child", birthDate: "2010-06-01" };
    const Y: Person = { id: "y", name: "長女", relation: "child", birthDate: "1980-01-01" };
    const r = calculate(mk([X, M, Y], [dep("A", 10_000_000), dep("B", 1_000_000), dep("C", 89_000_000)], [all("A", ["x", 1, 1]), all("B", ["m", 1, 1]), all("C", ["y", 1, 1])]));
    expect(r.blockers).toEqual([]);
    expect(of(r, "m")).toMatchObject({ minorCredit: 62_998, minorExcess: 237_002, payable: 0 });
    expect(of(r, "x")).toMatchObject({ disabilityCredit: 606_040, disabilityExcess: 3_893_960, payable: 0 });
    expect(of(r, "x").transfersIn).toEqual([{ fromId: "m", kind: "minor", amount: 23_940 }]);
    expect(of(r, "y").transfersIn).toEqual([
      { fromId: "m", kind: "minor", amount: 213_062 },
      { fromId: "x", kind: "disability", amount: 3_893_960 },
    ]);
    expect(of(r, "y").payable).toBe(1_499_800);
  });

  it("相続人でない受遺者（親族でない人）からは引かない", () => {
    const minor: Person = { id: "m", name: "長男", relation: "child", birthDate: "2024-01-01" };
    const naien: Person = { id: "n", name: "内縁の妻", relation: "other" };
    const r = calculate(mk([minor, naien], [dep("A", 2_000_000), dep("B", 80_000_000)], [all("A", ["m", 1, 1]), all("B", ["n", 1, 1])]));
    expect(of(r, "n").transfersIn).toEqual([]);
    expect(r.warnings.some((w) => w.includes("引ききれません"))).toBe(true);
  });
});

describe("数次相続", () => {
  it("亡くなった方より後に亡くなった人がいるときは、数次相続の案内だけを出す（取得者・贈与の食い違いの案内を重ねない）", () => {
    const later: Person = { id: "c2", name: "長女", relation: "child", predeceased: true, deathDate: "2026-05-01" };
    const r = calculate(mk([c1, later], [dep("預金", 80_000_000)], [all("預金", ["c1", 1, 2], ["c2", 1, 2])], { priorGifts: [{ personId: "c2", date: "2025-01-01", amount: 1_000_000, giftTaxPaid: 0 }] }));
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0]).toContain("数次相続");
  });
});

describe("相続人がいない", () => {
  it("全員が放棄した、または受遺者しかいないときは止めて税理士を案内する", () => {
    const naien: Person = { id: "n", name: "内縁の妻", relation: "other" };
    for (const persons of [[{ ...c1, renounced: true }, naien], [naien]]) {
      const r = calculate(mk(persons, [dep("預金", 50_000_000)], [all("預金", ["n", 1, 1])]));
      expect(r.blockers.some((b) => b.includes("民法上の相続人がいません") && b.includes("税理士"))).toBe(true);
    }
  });
  it("家族をまだ入れていなければ、入力を案内する", () => {
    const r = calculate(mk([], [dep("預金", 50_000_000)], []));
    expect(r.blockers.some((b) => b.includes("相続人がまだ入っていません"))).toBe(true);
  });
});

describe("小規模宅地等の種類（措置法69条の4）", () => {
  const bizCheck: SmallResidentialCheck = { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "no" };

  it("特定事業用宅地等は400㎡まで80%", () => {
    // 500㎡ 1億円 → 400㎡分 8,000万 × 80% = 6,400万
    const r = calculate(mk([c1], [land("店", 500, 100_000_000, "c1", {}, bizCheck), dep("預金", 20_000_000)], [all("店", ["c1", 1, 1]), all("預金", ["c1", 1, 1])]));
    expect(r.blockers).toEqual([]);
    expect(r.assets[0].small).toEqual({ acquirerId: "c1", kind: "business", rate: 80, area: 500, value: 100_000_000, selectedArea: 400, selectedValue: 80_000_000 });
    expect(r.assets[0].reduction).toBe(64_000_000);
    expect(r.warnings.some((w) => w.includes("事業に使っていた土地") && w.includes("400㎡まで"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("330㎡"))).toBe(false);
  });

  it("貸している土地は貸付事業用宅地等として200㎡まで50%", () => {
    const r = calculate(mk([c1], [land("アパート", 300, 60_000_000, "c1", { use: "rentedHouse", leaseRatio: 0.6 })], [all("アパート", ["c1", 1, 1])]));
    const l = r.assets[0];
    const v = l.valuation.value; // 貸家建付地の評価は財産の評価に任せる
    expect(l.small).toMatchObject({ kind: "rental", rate: 50, selectedArea: 200 });
    expect(l.small?.selectedValue).toBe(Math.floor((v * 2) / 3));
    expect(l.reduction).toBe(Math.floor(Math.floor((v * 2) / 3) / 2));
    expect(r.warnings.some((w) => w.includes("人に貸していた土地") && w.includes("200㎡まで"))).toBe(true);
  });

  it("空き部屋がある貸家の敷地は、貸している部分だけを貸家建付地として評価した額が貸付事業用宅地等（国税庁の設例）", () => {
    // 国税庁 情報（平成22年7月13日）「貸家建付地等の一部が空室の場合」の設例：200㎡、自用地 4,000万、借地権割合 0.7、賃貸割合 0.9
    // 全体の評価額 = 4,000万 × (1 − 0.7×0.3×0.9) = 3,244万
    // 貸している部分 = 4,000万 × 0.9 × (1 − 0.7×0.3) = 2,844万（180㎡）、空いている部分 20㎡ は自用地 400万で特例の対象外
    // 減額 2,844万 × 50% = 1,422万（180㎡ ≦ 200㎡）、課税価格に入る額 3,244万 − 1,422万 = 1,822万
    // 以前は全体の評価額を面積で割っていた（3,244万 × 0.9 = 2,919.6万）が、借家権の減額が空いている部分にも配られて特例が大きくなりすぎるので改めた
    const r = calculate(mk([c1], [land("アパート", 200, 40_000_000, "c1", { use: "rentedHouse", leaseRatio: 0.7, rentRatio: 0.9 })], [all("アパート", ["c1", 1, 1])]));
    const l = r.assets[0];
    expect(l.valuation.value).toBe(32_440_000);
    expect(l.valuation.rentedLandPart).toBe(28_440_000);
    expect(l.small).toMatchObject({ kind: "rental", rate: 50, area: 180, value: 28_440_000, selectedArea: 180, selectedValue: 28_440_000 });
    expect(l.reduction).toBe(14_220_000);
    expect(l.byPerson).toEqual([{ personId: "c1", amount: 18_220_000 }]);
    expect(r.warnings.some((w) => w.includes("空き部屋") && w.includes("0.9"))).toBe(true);
  });

  it("空き部屋がある貸家の敷地を持分で取得したときは、貸している部分の評価額×持分", () => {
    // 上の設例の土地を長男1/2・長女1/2。長男に特例：貸している部分 2,844万 × 1/2 = 1,422万、面積 100㎡ × 0.9 = 90㎡、減額 711万
    const r = calculate(
      mk([c1, c2], [land("アパート", 200, 40_000_000, "c1", { use: "rentedHouse", leaseRatio: 0.7, rentRatio: 0.9 })], [all("アパート", ["c1", 1, 2], ["c2", 1, 2])]),
    );
    const l = r.assets[0];
    expect(l.small).toMatchObject({ kind: "rental", area: 90, value: 14_220_000, selectedArea: 90 });
    expect(l.reduction).toBe(7_110_000);
  });

  it("貸付事業用宅地等を含むときは、特定居住用を200/330に換算して合わせて200㎡まで", () => {
    // 自宅 100㎡ 3,000万（減額 24万/㎡、換算 39.6万）、アパート 200㎡（減額 25万/㎡ 程度）→ 自宅を先に100㎡
    // 残りは 200 − 100×200/330 = 139.393…㎡ → 0.01㎡未満切捨てで 139.39㎡
    const r = calculate(
      mk([c1], [land("自宅", 100, 30_000_000, "c1"), land("アパート", 200, 100_000_000, "c1", { use: "rentedHouse", leaseRatio: 0.6 })], [all("自宅", ["c1", 1, 1]), all("アパート", ["c1", 1, 1])]),
    );
    const [home, apt] = r.assets;
    expect(home.small).toMatchObject({ kind: "residence", selectedArea: 100 });
    expect(home.reduction).toBe(24_000_000);
    expect(apt.small).toMatchObject({ kind: "rental", rate: 50, selectedArea: 139.39 });
    const sv = Math.floor((apt.valuation.value * 13939) / 20000);
    expect(apt.small?.selectedValue).toBe(sv);
    expect(apt.reduction).toBe(Math.floor(sv / 2));
    const w = r.warnings.find((x) => x.includes("人に貸していた土地も選ぶときは"));
    expect(w).toContain("「自宅」に100㎡、「アパート」に139.39㎡");
  });

  it("貸付事業用宅地等がなければ、特定居住用330㎡と特定事業用400㎡は別々に使える", () => {
    const r = calculate(
      mk([c1], [land("自宅", 330, 33_000_000, "c1"), land("店", 400, 40_000_000, "c1", {}, bizCheck)], [all("自宅", ["c1", 1, 1]), all("店", ["c1", 1, 1])]),
    );
    expect(r.assets.map((l) => [l.small?.kind, l.small?.selectedArea, l.reduction])).toEqual([
      ["residence", 330, 26_400_000],
      ["business", 400, 32_000_000],
    ]);
    expect(r.warnings.some((w) => w.includes("㎡まで"))).toBe(false);
  });

  it(`宅地が${SR_MAX_PERMUTE + 1}筆以上なら、限度面積1㎡あたりの減額が大きい順に割り当てる（貸付事業用を含むとき）`, () => {
    // 自宅 100㎡ 3,000万：減額 24万/㎡ × 330/200 = 39.6万。アパート 50㎡×7：貸家建付地でも減額は 25万/㎡ × 50% 以下
    // 自宅に100㎡ → 残りは 139.39㎡ → アパート1・2に50㎡、3に39.39㎡、4〜7は0
    const apts = [1, 2, 3, 4, 5, 6, 7].map((i) => land(`アパート${i}`, 50, 25_000_000, "c1", { use: "rentedHouse", leaseRatio: 0.6 }));
    const assets = [...apts, land("自宅", 100, 30_000_000, "c1")];
    expect(assets.length).toBeGreaterThan(SR_MAX_PERMUTE);
    const r = calculate(mk([c1], assets, assets.map((a) => all(a.id, ["c1", 1, 1]))));
    expect(r.assets.map((l) => l.small?.selectedArea)).toEqual([50, 50, 39.39, undefined, undefined, undefined, undefined, 100]);
    const w = r.warnings.find((x) => x.includes("人に貸していた土地も選ぶときは"))!;
    expect(w).toContain("減額できる額が大きい土地から順に");
    expect(w).toContain("「アパート4」・「アパート5」・「アパート6」・「アパート7」には適用していません");
  });

  it("貸している部屋（マンション）は貸付事業用宅地等", () => {
    const condo: Asset = {
      id: "部屋",
      kind: "condo",
      label: "部屋",
      location: "x",
      landValueBeforeCorrection: 20_000_000,
      buildingFixedAssetValue: 10_000_000,
      builtYearsMonths: { years: 10, months: 0 },
      totalFloors: 2,
      floor: 1,
      landShareSqm: 30,
      exclusiveAreaSqm: 60,
      rented: true,
      leaseRatio: 0.6,
      smallResidential: { applies: true, acquirerId: "c1" },
    };
    const r = calculate(mk([c1], [condo], [all("部屋", ["c1", 1, 1])]));
    expect(r.assets[0].small).toMatchObject({ kind: "rental", rate: 50, selectedArea: 30 });
    expect(r.assets[0].reduction).toBe(Math.floor(r.assets[0].small!.value / 2));
  });
});

describe("税理士に相談するときのメモ（consultPoints）", () => {
  it("相続コンパスが計算するようになった事柄は、相談の項目に入れない", () => {
    const minor: Person = { id: "m", name: "次男", relation: "child", birthDate: "2024-01-01" };
    const c = mk([c1, minor], [dep("預金", 80_000_000), dep("少し", 2_000_000)], [all("預金", ["c1", 1, 1]), all("少し", ["m", 1, 1])], {
      decedent: { ...decedent, settlementGift: true, priorInheritanceTax: true, priorInheritance: { date: "2020-01-10", prevTax: 5_000_000, prevAcquired: 60_000_000 } },
      priorGifts: [{ personId: "c1", date: "2024-05-10", amount: 10_000_000, giftTaxPaid: 0, settlement: true }],
    });
    const points = consultPoints(c, calculate(c));
    expect(points.some((x) => x.includes("扶養義務者") || x.includes("相続時精算課税") || x.includes("相次相続控除"))).toBe(false);
  });
  it("前の相続の内容が分からないときと、相続人がいないときは相談の項目にする", () => {
    const c = { ...mk([c1], [dep("預金", 50_000_000)], [all("預金", ["c1", 1, 1])]), decedent: { ...decedent, priorInheritanceTax: true } };
    expect(consultPoints(c, calculate(c)).some((x) => x.includes("相次相続控除"))).toBe(true);
    const none = mk([{ ...c1, renounced: true }], [dep("預金", 50_000_000)], []);
    expect(consultPoints(none, calculate(none)).some((x) => x.includes("相続人がいない"))).toBe(true);
  });
  it("小規模宅地等の判定は特例の種類ごとの質問で行う", () => {
    // 事業用の土地で「3年以内に始めた事業か」が分からない → 相談
    const c = mk([c1], [land("店", 200, 50_000_000, "c1", {}, { ownHome: "no", business: "yes", continues: "yes", keep: "yes", recent: "unsure" })], [all("店", ["c1", 1, 1])]);
    expect(consultPoints(c, calculate(c)).some((x) => x.includes("「店」の小規模宅地等の特例") && x.includes("3年以内に始めた事業"))).toBe(true);
  });
});
