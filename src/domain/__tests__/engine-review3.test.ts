/**
 * レビューで見つかった計算の誤りの修正（3回目）。亡くなった日はすべて 2026-03-15。期待値はテストごとのコメントの手計算。
 * - 以前の相続で受けた障害者控除：最初の相続のときの区分（一般・特別）で限度額を出す（相続税法19条の4第3項、相基通19の4-4）
 * - 一部だけ分けたときの未分割の部分の分け方に、代償金を入れる（相続税法55条、相基通11の2-9）
 * - 未分割のとき、相続人が受けた相続時精算課税の贈与を特別受益として入れる（国税庁 質疑応答事例「未分割の場合の課税価格（相続時精算課税適用財産がある場合）」）
 * - 引ききれない未成年者控除・障害者控除の案内（相基通1の2-1）と、未分割なのに負担する人が入っている債務の案内
 */
import { describe, expect, it } from "vitest";
import { calculate } from "../tax/engine";
import type { Asset, Case, Debt, Person, PriorGift } from "../types";

const decedent = { name: "相続 太郎", birthDate: "1950-01-01", deathDate: "2026-03-15", address: "東京都千代田区" };
const dep = (id: string, amount: number): Asset => ({ id, kind: "deposit", label: id, amount });
const to = (assetId: string, personId: string) => ({ assetId, shares: [{ personId, numerator: 1, denominator: 1 }] });
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
const of = (r: ReturnType<typeof calculate>, id: string) => r.persons.find((p) => p.person.id === id)!;
const P = (id: string, relation: Person["relation"], over: Partial<Person> = {}): Person => ({ id, name: id, relation, ...over });

describe("以前の相続で受けた障害者控除：最初の相続のときの区分（相基通19の4-4）", () => {
  // 二男 1961-01-01 生まれ：今回 65歳（Y）、最初の相続 2021-01-10 のとき 60歳（X）。
  // ふつうの額は 特別 (85−65)×20万 = 400万、一般 (85−65)×10万 = 200万。長男・二男とも課税価格1億円 → 算出税額 16,700,000円
  const run = (disability: Person["disability"], prior: Person["priorDisabilityCredit"]) =>
    calculate(
      mk(
        [P("長男", "child", { birthDate: "1958-01-01" }), P("二男", "child", { birthDate: "1961-01-01", disability, priorDisabilityCredit: prior })],
        [dep("A", 100_000_000), dep("B", 100_000_000)],
        [to("A", "長男"), to("B", "二男")],
      ),
    );

  it("前は一般・今は特別：{20万×(85−Y)＋10万×(Y−X)}−A（国税庁の計算例）", () => {
    // 20万×20 + 10万×5 = 450万。これまでに 250万 → 残り 200万（ふつうの額 400万より少ない）。16,700,000 − 2,000,000 = 14,700,000
    const r = run("special", { date: "2021-01-10", amount: 2_500_000, special: false });
    expect(r.blockers).toEqual([]);
    expect(of(r, "二男")).toMatchObject({ disabilityCredit: 2_000_000, disabilityExcess: 0, payable: 14_700_000 });
    const w = r.warnings.find((x) => x.includes("二男さんは以前の相続でも障害者控除"))!;
    expect(w).toContain("限度額の4,500,000円");
    expect(w).toContain("2,000,000円までにしています");
    expect(w).not.toContain("最初の相続のときに受けられた");
  });

  it("前も今も特別：20万×(85−X)−A", () => {
    // 20万×25 = 500万 − 250万 = 250万
    const r = run("special", { date: "2021-01-10", amount: 2_500_000, special: true });
    expect(r.blockers).toEqual([]);
    expect(of(r, "二男").disabilityCredit).toBe(2_500_000);
  });

  it("前も今も一般：10万×(85−X)−A", () => {
    // 10万×25 = 250万 − 200万 = 50万
    const r = run("general", { date: "2021-01-10", amount: 2_000_000, special: false });
    expect(r.blockers).toEqual([]);
    expect(of(r, "二男")).toMatchObject({ disabilityCredit: 500_000, payable: 16_200_000 });
  });

  it("前は特別・今は一般：最初の相続のときに受けられた 20万×(85−X) が限度", () => {
    // 20万×25 = 500万 − 300万 = 200万。ふつうの額も 200万 → 200万
    const r = run("general", { date: "2021-01-10", amount: 3_000_000, special: true });
    expect(r.blockers).toEqual([]);
    expect(of(r, "二男").disabilityCredit).toBe(2_000_000);
    // 残りが 100万なら 100万までにして、そのことを知らせる
    const r2 = run("general", { date: "2021-01-10", amount: 4_000_000, special: true });
    expect(of(r2, "二男").disabilityCredit).toBe(1_000_000);
    expect(r2.warnings.some((x) => x.includes("最初の相続のときは特別障害者だったため") && x.includes("限度額の5,000,000円"))).toBe(true);
  });

  it("区分を入れていなければ今と同じ区分とする（これまでと同じ）", () => {
    const r = run("special", { date: "2021-01-10", amount: 2_500_000 });
    expect(of(r, "二男").disabilityCredit).toBe(2_500_000);
    expect(r.warnings.some((x) => x.includes("最初の相続のときも今と同じ区分だったものとしています"))).toBe(true);
  });

  it("これまでに受けた額が限度額より多いのは入力の誤り：止めて、日付・区分・金額を確かめてもらう", () => {
    // 今は一般、区分の入力なし → 10万×25 = 250万 より多い 300万は受けられない
    const r = run("general", { date: "2021-01-10", amount: 3_000_000 });
    expect(r.blockers.some((b) => b.includes("二男さんがこれまでに受けた障害者控除の合計（3,000,000円）") && b.includes("区分（一般・特別）"))).toBe(true);
    // 0円を引いたような、ありえない金額は書かない
    expect(r.warnings.some((x) => x.includes("二男さんは以前の相続でも障害者控除"))).toBe(false);
  });

  it("未成年者控除：前の相続のとき20歳までで受けた額が18歳までの限度額より多くても止めずに0円にする", () => {
    // 2009-06-01 生まれ：最初の相続 2021-01-10 のとき 11歳 → 18歳までの限度額 (18−11)×10万 = 70万。これまでに 90万（20歳まで）
    const r = calculate(
      mk(
        [P("長男", "child", { birthDate: "1980-01-01" }), P("二男", "child", { birthDate: "2009-06-01", priorMinorCredit: { date: "2021-01-10", amount: 900_000 } })],
        [dep("A", 100_000_000), dep("B", 100_000_000)],
        [to("A", "長男"), to("B", "二男")],
      ),
    );
    expect(r.blockers).toEqual([]);
    expect(of(r, "二男").minorCredit).toBe(0);
    expect(r.warnings.some((x) => x.includes("900,000円が限度額の700,000円") && x.includes("0円にしています"))).toBe(true);
  });
});

describe("一部だけ分けたとき：代償金も、すでに受け取った額に入れて未分割の部分を分ける（相基通11の2-9）", () => {
  it("子2人：長男が家6,000万円を取得して二男に代償金3,000万円。預金6,000万円は未分割 → 6,000万円ずつ", () => {
    // 分け方で受け取った額：長男 6,000万−3,000万 = 3,000万、二男 3,000万。全体1億2,000万×1/2 = 6,000万 → 足りない額 3,000万ずつ
    const r = calculate(
      mk([P("長男", "child", { birthDate: "1975-01-01" }), P("二男", "child", { birthDate: "1978-01-01" })], [dep("家", 60_000_000), dep("預金", 60_000_000)], [to("家", "長男")], {
        undivided: true,
        compensation: [{ fromId: "長男", toId: "二男", amount: 30_000_000 }],
      }),
    );
    expect(r.blockers).toEqual([]);
    expect(of(r, "長男")).toMatchObject({ taxable: 60_000_000, undivided: 30_000_000, compensationOut: 30_000_000 });
    expect(of(r, "二男")).toMatchObject({ taxable: 60_000_000, undivided: 30_000_000, compensationIn: 30_000_000 });
  });

  it("妻（3/4）と兄（1/4・2割加算）：兄が家4,000万円を取得して妻に代償金2,000万円。預金8,000万円は未分割", () => {
    // 受け取った額：妻 2,000万、兄 4,000万−2,000万 = 2,000万。全体1億2,000万 → 妻 9,000万−2,000万 = 7,000万、兄 3,000万−2,000万 = 1,000万
    // 課税価格 妻 9,000万・兄 3,000万。総額 (7,200万×3/4=5,400万 → 1,320万) + (1,800万 → 2,200,000) ... = 12,975,000
    // 妻：9,731,250 − 軽減 12,975,000×2,000万/1億2,000万 = 2,162,500 → 7,568,700。兄：3,243,750 + 648,750 → 3,892,500
    const r = calculate(
      mk([P("妻", "spouse", { birthDate: "1955-01-01" }), P("兄", "sibling", { birthDate: "1945-01-01" })], [dep("家", 40_000_000), dep("預金", 80_000_000)], [to("家", "兄")], {
        undivided: true,
        compensation: [{ fromId: "兄", toId: "妻", amount: 20_000_000 }],
      }),
    );
    expect(r.blockers).toEqual([]);
    expect(r.totalTax).toBe(12_975_000);
    expect(of(r, "妻")).toMatchObject({ taxable: 90_000_000, undivided: 70_000_000, spouseCredit: 2_162_500, payable: 7_568_700 });
    expect(of(r, "兄")).toMatchObject({ taxable: 30_000_000, undivided: 10_000_000, surcharge: 648_750, payable: 3_892_500 });
    expect(r.totalPayable).toBe(11_461_200);
  });

  it("時価をもとに決めた代償金は、評価額に直した額で数える", () => {
    // 代償金 3,000万（家の時価 1億2,000万をもとに）→ 3,000万×6,000万/1億2,000万 = 1,500万。
    // 受け取った額：長男 4,500万、二男 1,500万 → 全体1億2,000万×1/2 = 6,000万 → 足りない額 1,500万・4,500万
    const r = calculate(
      mk([P("長男", "child", { birthDate: "1975-01-01" }), P("二男", "child", { birthDate: "1978-01-01" })], [dep("家", 60_000_000), dep("預金", 60_000_000)], [to("家", "長男")], {
        undivided: true,
        compensation: [{ fromId: "長男", toId: "二男", amount: 30_000_000, basis: { assetId: "家", marketValue: 120_000_000 } }],
      }),
    );
    expect(r.blockers).toEqual([]);
    expect(of(r, "長男")).toMatchObject({ taxable: 60_000_000, undivided: 15_000_000 });
    expect(of(r, "二男")).toMatchObject({ taxable: 60_000_000, undivided: 45_000_000 });
  });
});

describe("未分割のとき、相続時精算課税の贈与は特別受益として数える（国税庁 質疑応答事例）", () => {
  const kids = ["A", "B", "C", "D"].map((n, i) => P(n, "child", { birthDate: `198${i}-01-01` }));
  const gift = (personId: string, settlement: boolean, date = "2020-05-01"): PriorGift => ({ personId, date, amount: 10_000_000, giftTaxPaid: 0, settlement });

  it("子4人、遺産1億円が未分割、A・Bに精算課税の贈与1,000万円ずつ → 全員3,000万円", () => {
    // (1億 + 2,000万)×1/4 = 3,000万。A・B：3,000万 − 1,000万 = 2,000万 ＋ 精算課税 1,000万 = 3,000万。C・D：3,000万
    const r = calculate(mk(kids, [dep("預金", 100_000_000)], [], { undivided: true, priorGifts: [gift("A", true), gift("B", true)] }));
    expect(r.blockers).toEqual([]);
    for (const id of ["A", "B"]) expect(of(r, id)).toMatchObject({ undivided: 20_000_000, settlementGifts: 10_000_000, taxable: 30_000_000, payable: 1_975_000 });
    for (const id of ["C", "D"]) expect(of(r, id)).toMatchObject({ undivided: 30_000_000, settlementGifts: 0, taxable: 30_000_000, payable: 1_975_000 });
    expect(r.warnings.some((w) => w.includes("相続時精算課税で贈与を受けた人（Aさん・Bさん）") && w.includes("国税庁の質疑応答"))).toBe(true);
  });

  it("贈与の額は110万円の基礎控除を引く前の額で数える（令和6年以後の贈与）", () => {
    // 分け方には1,000万円そのもの → A の未分割 2,000万。課税価格に足すのは 1,000万 − 110万 = 890万 → 2,890万
    const r = calculate(mk(kids, [dep("預金", 100_000_000)], [], { undivided: true, priorGifts: [gift("A", true, "2024-05-01")] }));
    expect(r.blockers).toEqual([]);
    // (1億 + 1,000万)×1/4 = 2,750万。A：2,750万 − 1,000万 = 1,750万、ほか 2,750万ずつ
    expect(of(r, "A")).toMatchObject({ undivided: 17_500_000, settlementGifts: 8_900_000, taxable: 26_400_000 });
    expect(of(r, "B").undivided).toBe(27_500_000);
  });

  it("一部だけ分けたときも同じ。暦年課税の贈与は数えない", () => {
    // 家 4,000万を C が取得、預金 6,000万は未分割。A に精算課税 1,000万、B に暦年課税 1,000万（3年より前）
    // 全体 1億1,000万×1/4 = 2,750万。足りない額：A 1,750万、B 2,750万、C 0、D 2,750万（合計 7,250万）→ 預金 6,000万をこの割合で
    const r = calculate(
      mk(kids, [dep("家", 40_000_000), dep("預金", 60_000_000)], [to("家", "C")], { undivided: true, priorGifts: [gift("A", true), gift("B", false, "2018-05-01")] }),
    );
    expect(r.blockers).toEqual([]);
    // 6,000万×1,750/7,250 = 14,482,758.6…、6,000万×2,750/7,250 = 22,758,620.6…（端数は割合がいちばん大きい B に寄せる）
    expect(of(r, "A").undivided).toBe(14_482_758);
    expect(of(r, "B").undivided).toBe(22_758_622);
    expect(of(r, "C").undivided).toBe(0);
    expect(of(r, "D").undivided).toBe(22_758_620);
    expect(r.warnings.some((w) => w.includes("相続時精算課税で贈与を受けた人（Aさん）"))).toBe(true);
  });

  it("分け方が全部決まっていれば、精算課税の贈与があっても案内しない", () => {
    const r = calculate(mk(kids, [dep("預金", 100_000_000)], [to("預金", "C")], { priorGifts: [gift("A", true)] }));
    expect(r.warnings.some((w) => w.includes("相続時精算課税で贈与を受けた人（"))).toBe(false);
  });
});

describe("引ききれない未成年者控除・障害者控除の案内（相基通1の2-1）", () => {
  it("「その他」で入れた人（子の母など）が相続税を納めるなら、その人が父母なら引けると案内する。父母を確かめたようには書かない", () => {
    // 長男（10歳）の未成年者控除 80万のうち、本人の算出税額 525,352 を超える 274,648 が残る。前妻（その他）は 12,608,400 を納める
    const r = calculate(
      mk(
        [P("妻", "spouse", { birthDate: "1970-01-01" }), P("長男", "child", { birthDate: "2015-06-01" }), P("前妻", "other", { birthDate: "1980-01-01" })],
        [dep("A", 150_000_000), dep("B", 3_000_000), { id: "ins", kind: "insurance", label: "生命保険", amount: 60_000_000, recipientId: "前妻" } as Asset],
        [to("A", "妻"), to("B", "長男")],
      ),
    );
    expect(r.blockers).toEqual([]);
    expect(of(r, "長男").minorExcess).toBe(274_648);
    expect(of(r, "前妻").transfersIn).toEqual([]);
    const w = r.warnings.find((x) => x.includes("長男さんの未成年者控除のうち274,648円"))!;
    expect(w).toContain("前妻さんが長男さんの父母・祖父母・兄弟姉妹・配偶者なら");
    expect(w).toContain("生計を一にしていた3親等内の親族");
    expect(w).toContain("税理士");
    expect(w).not.toContain("配偶者・親子・祖父母と孫・兄弟姉妹の相続税からは引ききれません");
  });

  it("父母のあいだで移すときは、2人を夫婦として数えていることを知らせる", () => {
    // 子も配偶者もいない方の父（特別障害者・80歳）の控除 100万のうち、本人の税額を超える分を母から引く
    const r = calculate({
      ...mk([P("父", "parent", { birthDate: "1946-01-01", disability: "special" }), P("母", "parent", { birthDate: "1950-01-01" })], [dep("A", 5_000_000), dep("B", 150_000_000)], [to("A", "父"), to("B", "母")]),
      decedent: { ...decedent, birthDate: "1970-01-01" },
    });
    expect(r.blockers).toEqual([]);
    expect(of(r, "母").transfersIn).toEqual([{ fromId: "父", kind: "disability", amount: 358_065 }]);
    expect(r.warnings.some((x) => x.includes("母さんの相続税から引いています") && x.includes("父母の2人は夫婦として数えています"))).toBe(true);
  });

  it("配偶者から子へ移すときは、父母の注意は出さない", () => {
    const r = calculate(
      mk(
        [P("妻", "spouse", { birthDate: "1966-01-01", disability: "general" }), P("長男", "child"), P("長女", "child")],
        [dep("W", 100_000_000), dep("A", 100_000_000), dep("B", 100_000_000)],
        [to("W", "妻"), to("A", "長男"), to("B", "長女")],
      ),
    );
    expect(r.warnings.some((x) => x.includes("父母の2人は夫婦"))).toBe(false);
  });
});

describe("未分割なのに、債務の負担する人が全額入っている（債務を先に入れたとき）", () => {
  const persons = [P("妻", "spouse"), P("長男", "child"), P("長女", "child")];
  const debt = (over: Partial<Debt>): Debt => ({ id: "d", kind: "debt", label: "借入金", amount: 40_000_000, bearers: [{ personId: "妻", amount: 40_000_000 }], ...over });
  const run = (debts: Debt[], undivided = true) => calculate(mk(persons, [dep("預金", 200_000_000)], [], { undivided, debts }));
  const hint = (r: ReturnType<typeof calculate>) => r.warnings.filter((w) => w.includes("入力した人が負担するものとして計算しています"));

  it("入れたとおりに計算し、負担する人が決まっていなければ×で外すよう、まとめて1つ案内する", () => {
    const r = run([debt({}), debt({ id: "d2", label: "未払金", amount: 1_000_000, bearers: [{ personId: "長男", amount: 1_000_000 }] })]);
    expect(r.blockers).toEqual([]);
    expect(of(r, "妻").debts).toBe(40_000_000);
    expect(hint(r)).toEqual([
      "「分け方がまだ決まっていない」にチェックがありますが、「借入金」・「未払金」は入力した人が負担するものとして計算しています。負担する人がまだ決まっていなければ、遺産の分け方の画面で負担する人を×で外してください（法定相続分で計算します）。",
    ]);
  });

  it("負担する人が空なら法定相続分で、案内は出さない。葬式費用と、分け方が決まっているときも出さない", () => {
    const blank = run([debt({ bearers: [] })]);
    expect(of(blank, "妻").debts).toBe(20_000_000);
    expect(hint(blank)).toEqual([]);
    expect(hint(run([debt({ kind: "funeral", label: "葬式費用" })]))).toEqual([]);
    expect(hint(calculate(mk(persons, [dep("預金", 200_000_000)], [to("預金", "妻")], { debts: [debt({})] })))).toEqual([]);
  });
});
