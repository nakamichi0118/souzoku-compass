/**
 * レビューで見つかった計算の誤りの修正（2回目）。亡くなった日はすべて 2026-03-15。期待値はテストごとのコメントの手計算。
 * - 扶養義務者の範囲（相基通1の2-1）：配偶者・直系血族・兄弟姉妹だけに、引ききれない未成年者控除・障害者控除を移す
 * - 以前の相続で受けた未成年者控除・障害者控除（相続税法19条の3第3項・19条の4第3項、相基通19の3-5）
 * - 精算課税の還付だけでも申告が必要（相続税法33条の2）
 * - 負担する人が決まっていない債務（第13表②⑤）、代償金（相基通11の2-9・11の2-10）、⑰の100円未満切捨て（国税通則法119条）
 */
import { describe, expect, it } from "vitest";
import { calculate, isSupporter } from "../tax/engine";
import type { Asset, Case, Person } from "../types";

const decedent = { name: "相続 太郎", birthDate: "1950-01-01", deathDate: "2026-03-15", address: "東京都千代田区" };
const dep = (id: string, amount: number): Asset => ({ id, kind: "deposit", label: id, amount });
const all = (assetId: string, ...s: [string, number, number][]) => ({
  assetId,
  shares: s.map(([personId, numerator, denominator]) => ({ personId, numerator, denominator })),
});
const to = (assetId: string, personId: string) => all(assetId, [personId, 1, 1]);
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

describe("扶養義務者の範囲（相基通1の2-1：配偶者・直系血族・兄弟姉妹）", () => {
  const spouse = P("妻", "spouse");
  const c1 = P("長男", "child");
  const c2 = P("養子", "adoptedChild");
  const gA1 = P("孫A1", "grandchild", { substituteOf: "二男" });
  const gA2 = P("孫A2", "grandchild", { substituteOf: "二男" });
  const gB = P("孫B", "grandchild", { substituteOf: "三男" });
  const gNoSub = P("孫（受遺者）", "grandchild");
  const father = P("父", "parent");
  const mother = P("母", "parent");
  const gp = P("祖父", "grandparent");
  const gm = P("祖母", "grandparent");
  const sib = P("兄", "sibling");
  const sib2 = P("弟", "sibling");
  const half = P("異母兄", "sibling", { halfBlood: true });
  const half2 = P("異父弟", "sibling", { halfBlood: true });
  const nA1 = P("甥A1", "nephewNiece", { substituteOf: "姉" });
  const nA2 = P("甥A2", "nephewNiece", { substituteOf: "姉" });
  const nB = P("姪B", "nephewNiece", { substituteOf: "妹" });
  const other = P("内縁の妻", "other");

  it.each([
    // 子：配偶者（子の親とする）・ほかの子（兄弟姉妹。養子も同じ）・父母・祖父母（直系尊属）
    [c1, spouse, true],
    [c1, c2, true],
    [c1, father, true],
    [c1, gp, true],
    // 代襲相続人の孫：配偶者（祖父母とする）・同じ人の代わりの孫（兄弟姉妹）・父母祖父母。ほかの子はおじ・おば、ほかの枝の孫はいとこ
    [gA1, spouse, true],
    [gA1, gA2, true],
    [gA1, father, true],
    [gA1, c1, false],
    [gA1, gB, false],
    [gA1, gNoSub, false],
    // 配偶者：子と代襲相続人の孫（直系卑属）。亡くなった方の兄弟姉妹・父母は姻族
    [spouse, c1, true],
    [spouse, gA1, true],
    [spouse, gNoSub, false],
    [spouse, sib, false],
    [spouse, father, false],
    // 父母：もう一方の父母（夫婦とする）・父母の両方を同じくする兄弟姉妹・子孫（直系卑属。向きを問わない）
    [father, mother, true],
    [father, sib, true],
    [father, half, false],
    [father, c1, true],
    [gp, gA1, true],
    [gp, gm, false],
    [father, gp, false],
    // 兄弟姉妹：どちらかが両方の親を同じくするなら兄弟姉妹。両方とも半血なら同じ親か分からないので入れない
    [sib, sib2, true],
    [sib, half, true],
    [half, half2, false],
    [half, father, false],
    [sib, nA1, false],
    // 甥姪：同じ人の代わりに相続する人どうしだけ
    [nA1, nA2, true],
    [nA1, nB, false],
    // 相続人でない受遺者・本人
    [c1, other, false],
    [other, c1, false],
    [c1, c1, false],
  ])("%o の扶養義務者に %o は %s", (a, b, expected) => {
    expect(isSupporter(a as Person, b as Person)).toBe(expected);
    expect(isSupporter(b as Person, a as Person)).toBe(expected);
  });

  it("子のいない夫婦で障害者の妻：亡くなった方の兄弟姉妹（妻の義理の兄弟）からは引かず、生計を一にする親族のことを知らせる", () => {
    // 妻（70歳・特別障害者）の障害者控除 (85−70)×20万 = 300万。妻は配偶者の税額軽減で税額0 → 300万全部が引ききれない
    // 以前は兄・弟から150万ずつ引いていた
    const w = P("妻", "spouse", { birthDate: "1955-06-01", disability: "special" });
    const r = calculate(mk([w, sib, sib2], [dep("A", 100_000_000), dep("B", 60_000_000), dep("C", 60_000_000)], [to("A", "妻"), to("B", "兄"), to("C", "弟")]));
    expect(r.blockers).toEqual([]);
    expect(of(r, "妻").disabilityExcess).toBe(3_000_000);
    expect(of(r, "兄").transfersIn).toEqual([]);
    expect(of(r, "弟").transfersIn).toEqual([]);
    const w2 = r.warnings.find((x) => x.includes("妻さんの障害者控除のうち3,000,000円"))!;
    expect(w2).toContain("生計を一にしていた3親等内の親族");
    expect(w2).toContain("税理士");
  });

  it("代襲相続人の孫（5歳）：おじ（長男）からは引かず、祖母（亡くなった方の配偶者）から引く。そのときの前提を知らせる", () => {
    // 孫の未成年者控除 (18−5)×10万 = 130万。本人の算出税額 462,189 → 残り 837,811 を、相続税が残っている妻から全部引く
    const w = P("妻", "spouse");
    const g = P("孫", "grandchild", { substituteOf: "二男", birthDate: "2021-01-01" });
    const dead = P("二男", "child", { predeceased: true, hasChildren: true });
    const r = calculate(mk([w, c1, dead, g], [dep("W", 300_000_000), dep("A", 100_000_000), dep("G", 2_000_000)], [to("W", "妻"), to("A", "長男"), to("G", "孫")]));
    expect(r.blockers).toEqual([]);
    expect(of(r, "孫")).toMatchObject({ minorCredit: 462_189, minorExcess: 837_811 });
    expect(of(r, "妻").transfersIn).toEqual([{ fromId: "孫", kind: "minor", amount: 837_811 }]);
    expect(of(r, "長男").transfersIn).toEqual([]);
    expect(r.warnings.some((x) => x.includes("妻さんの相続税から引いています") && x.includes("配偶者は、亡くなった方の子の親（代襲相続人の祖父母）として数えています"))).toBe(true);
  });

  it("兄弟姉妹の代襲相続人（甥・姪）：同じ親の代わりに相続するきょうだいからは引き、いとこからは引かない", () => {
    // 姉の子 甥A1（10歳）・甥A2、妹の子 姪B。甥A1 の控除 80万のうち引ききれない分は甥A2 だけから
    const young = P("甥A1", "nephewNiece", { substituteOf: "姉", birthDate: "2015-06-01" });
    const persons = [P("姉", "sibling", { predeceased: true, hasChildren: true }), P("妹", "sibling", { predeceased: true, hasChildren: true }), young, nA2, nB];
    const r = calculate(mk(persons, [dep("A1", 1_000_000), dep("A2", 100_000_000), dep("B", 100_000_000)], [to("A1", "甥A1"), to("A2", "甥A2"), to("B", "姪B")]));
    expect(r.blockers).toEqual([]);
    const m = of(r, "甥A1");
    expect(m.minorExcess).toBeGreaterThan(0);
    expect(of(r, "甥A2").transfersIn).toEqual([{ fromId: "甥A1", kind: "minor", amount: m.minorExcess }]);
    expect(of(r, "姪B").transfersIn).toEqual([]);
  });

  it("障害者の配偶者：子の相続税から引く", () => {
    // 妻（60歳・一般障害者）の控除 (85−60)×10万 = 250万。妻は税額軽減で0円 → 子2人から相続税額の割合で（同じ額なので半分ずつ）
    const w = P("妻", "spouse", { birthDate: "1966-01-01", disability: "general" });
    const r = calculate(mk([w, c1, P("長女", "child")], [dep("W", 100_000_000), dep("A", 100_000_000), dep("B", 100_000_000)], [to("W", "妻"), to("A", "長男"), to("B", "長女")]));
    expect(r.blockers).toEqual([]);
    expect(of(r, "妻").disabilityExcess).toBe(2_500_000);
    expect(of(r, "長男").transfersIn).toEqual([{ fromId: "妻", kind: "disability", amount: 1_250_000 }]);
    expect(of(r, "長女").transfersIn).toEqual([{ fromId: "妻", kind: "disability", amount: 1_250_000 }]);
  });
});

describe("以前の相続で受けた未成年者控除・障害者控除（相続税法19条の3第3項・19条の4第3項）", () => {
  // 二男 2015-06-01 生まれ：今回 10歳 → ふつうは (18−10)×10万 = 80万。
  // 父の相続（2023-01-10）のとき 7歳 → そのとき受けられた額 (18−7)×10万 = 110万（今回の相続が令和4年4月1日以後なので18歳まで。相基通19の3-5（注））
  const run = (prior?: Person["priorMinorCredit"]) =>
    calculate(mk([P("長男", "child", { birthDate: "2000-01-01" }), P("二男", "child", { birthDate: "2015-06-01", priorMinorCredit: prior })], [dep("A", 70_000_000), dep("B", 50_000_000)], [to("A", "長男"), to("B", "二男")]));

  it("入れていなければ、ふつうの額（80万円）", () => {
    expect(of(run(), "二男").minorCredit).toBe(800_000);
  });

  it("前の相続で110万円を使い切っていれば、今回は0円", () => {
    const r = run({ date: "2023-01-10", amount: 1_100_000 });
    expect(r.blockers).toEqual([]);
    expect(of(r, "二男")).toMatchObject({ minorCredit: 0, minorExcess: 0, payable: 4_833_300 });
    expect(r.warnings.some((w) => w.includes("以前の相続でも未成年者控除") && w.includes("0円までにしています"))).toBe(true);
  });

  it("前の相続で50万円だけ使ったなら、残り60万円（ふつうの額80万円より少ない方）", () => {
    // 算出税額 4,833,333 − 600,000 = 4,233,333 → 4,233,300円
    const r = run({ date: "2023-01-10", amount: 500_000 });
    expect(of(r, "二男")).toMatchObject({ minorCredit: 600_000, payable: 4_233_300 });
  });

  it("残りがふつうの額より多ければ、ふつうの額", () => {
    expect(of(run({ date: "2023-01-10", amount: 100_000 }), "二男").minorCredit).toBe(800_000);
  });

  it("日付か金額がなければ、入力を案内して止める。日付が今回より前でなければ止める", () => {
    for (const prior of [{ date: "2023-01-10" }, { amount: 500_000 }, { date: "2023-02-30", amount: 0 }]) {
      const r = run(prior);
      expect(r.blockers.some((b) => b.includes("以前の相続でも未成年者控除") && b.includes("相続人の画面"))).toBe(true);
    }
    expect(run({ date: "2026-03-15", amount: 0 }).blockers.some((b) => b.includes("最初に未成年者控除を受けた相続の日"))).toBe(true);
  });

  it("障害者控除も同じ：最初の相続のときの (85−年齢)×20万円 から、これまでに受けた額を引いた残りが限度", () => {
    // 1980-01-01 生まれの特別障害者：今回 46歳 → ふつうは (85−46)×20万 = 780万
    // 最初の相続 2016-05-01 のとき 36歳 → (85−36)×20万 = 980万、これまでに 300万 → 残り 680万
    const d = P("長男", "child", { birthDate: "1980-01-01", disability: "special", priorDisabilityCredit: { date: "2016-05-01", amount: 3_000_000 } });
    const r = calculate(mk([d, P("長女", "child")], [dep("A", 200_000_000), dep("B", 200_000_000)], [to("A", "長男"), to("B", "長女")]));
    expect(r.blockers).toEqual([]);
    expect(of(r, "長男").disabilityCredit + of(r, "長男").disabilityExcess).toBe(6_800_000);
  });

  it("控除を受けられない人（成人）に以前の控除が入っていても止めない", () => {
    const r = calculate(mk([P("長男", "child", { birthDate: "1990-01-01", priorMinorCredit: {} })], [dep("A", 60_000_000)], [to("A", "長男")]));
    expect(r.blockers).toEqual([]);
  });
});

describe("申告が必要か（tax-6）", () => {
  it("基礎控除以下でも、精算課税の贈与税が戻ってくるなら申告が必要", () => {
    // 課税価格 1,000万 + 精算課税 1,000万 = 2,000万 ≦ 3,600万。納めた贈与税 100万が全額還付
    const r = calculate({
      ...mk([P("長男", "child")], [dep("A", 10_000_000)], [to("A", "長男")], { priorGifts: [{ personId: "長男", date: "2021-04-01", amount: 10_000_000, giftTaxPaid: 1_000_000, settlement: true }] }),
      decedent: { ...decedent, settlementGift: true },
    });
    expect(r.totalRefund).toBe(1_000_000);
    expect(r.needsFiling).toBe(true);
    expect(r.warnings.some((w) => w.includes("申告は原則不要"))).toBe(false);
    expect(r.warnings.some((w) => w.includes("申告書を出す必要があります"))).toBe(true);
  });
});

describe("負担する人が決まっていない債務・葬式費用（第13表②⑤）", () => {
  it("法定相続分で負担したものとした額を、debtsUnsettled・funeralUnsettled に分けて出す", () => {
    // 借入 1,000,001円は負担する人なし → 妻 500,001・長男 250,000・長女 250,000。葬式費用 40万は妻が負担と決まっている
    const r = calculate(
      mk([P("妻", "spouse"), P("長男", "child"), P("長女", "child")], [dep("預金", 100_000_000)], [], {
        undivided: true,
        debts: [
          { id: "d", kind: "debt", label: "借入", amount: 1_000_001, bearers: [] },
          { id: "f", kind: "funeral", label: "葬式", amount: 400_000, bearers: [{ personId: "妻", amount: 400_000 }] },
        ],
      }),
    );
    expect(r.blockers).toEqual([]);
    expect(of(r, "妻")).toMatchObject({ debtOnly: 500_001, debtsUnsettled: 500_001, funeralOnly: 400_000, funeralUnsettled: 0 });
    expect(of(r, "長男")).toMatchObject({ debtOnly: 250_000, debtsUnsettled: 250_000, funeralUnsettled: 0 });
  });

  it("負担する人が決まっていれば、どちらも0", () => {
    const r = calculate(
      mk([P("長男", "child")], [dep("預金", 50_000_000)], [to("預金", "長男")], {
        debts: [{ id: "d", kind: "debt", label: "借入", amount: 1_000_000, bearers: [{ personId: "長男", amount: 1_000_000 }] }],
      }),
    );
    expect(of(r, "長男")).toMatchObject({ debtOnly: 1_000_000, debtsUnsettled: 0, funeralUnsettled: 0 });
  });
});

describe("代償金（相基通11の2-9・11の2-10）", () => {
  const kids = [P("長男", "child"), P("長女", "child")];

  it("遺産を受け継がない人（保険金だけを受け取る人）は代償金を払えない", () => {
    const r = calculate(
      mk(kids, [dep("A", 50_000_000), { id: "保険", kind: "insurance", label: "保険", amount: 30_000_000, recipientId: "長男" }], [to("A", "長女")], {
        compensation: [{ fromId: "長男", toId: "長女", amount: 5_000_000 }],
      }),
    );
    expect(r.blockers.some((b) => b.includes("長男さんは遺産の分け方で財産を受け継いでいないため") && b.includes("贈与") && b.includes("税理士"))).toBe(true);
  });

  it("払いすぎの確かめは、保険金の非課税の分を除いた額で行う", () => {
    // 長男：預金 1,000万＋保険金 2,000万（非課税 500万×2人 = 1,000万）→ 課税される財産 2,000万。2,500万払うのは多すぎる（以前は保険金を全額数えて通していた）
    const assets: Asset[] = [dep("A", 10_000_000), dep("B", 50_000_000), { id: "保険", kind: "insurance", label: "保険", amount: 20_000_000, recipientId: "長男" }];
    const allocs = [to("A", "長男"), to("B", "長女")];
    const over = calculate(mk(kids, assets, allocs, { compensation: [{ fromId: "長男", toId: "長女", amount: 25_000_000 }] }));
    expect(over.blockers.some((b) => b.includes("受け継ぐ財産の評価額（20,000,000円。保険金・退職金は非課税の分を除いた額）より多く"))).toBe(true);
    const ok = calculate(mk(kids, assets, allocs, { compensation: [{ fromId: "長男", toId: "長女", amount: 20_000_000 }] }));
    expect(ok.blockers).toEqual([]);
  });

  it("代償金を財産の時価をもとに決めたときは、代償金×評価額÷時価を足し引きする", () => {
    // 家（評価額 4,000万、時価 5,000万）と預金 1,000万を長男。長女に代償金 2,500万 → 2,500万 × 4,000万/5,000万 = 2,000万
    // 長男 5,000万 − 2,000万 = 3,000万、長女 2,000万
    const r = calculate(
      mk(kids, [dep("家", 40_000_000), dep("預金", 10_000_000)], [to("家", "長男"), to("預金", "長男")], {
        compensation: [{ fromId: "長男", toId: "長女", amount: 25_000_000, basis: { assetId: "家", marketValue: 50_000_000 } }],
      }),
    );
    expect(r.blockers).toEqual([]);
    expect(r.compensation).toEqual([{ fromId: "長男", toId: "長女", amount: 25_000_000, value: 20_000_000 }]);
    expect(of(r, "長男")).toMatchObject({ compensationOut: 20_000_000, inherited: 30_000_000, taxable: 30_000_000 });
    expect(of(r, "長女")).toMatchObject({ compensationIn: 20_000_000, inherited: 20_000_000, taxable: 20_000_000 });
  });

  it("時価をもとにした代償金は1円未満切捨て。配偶者の第5表の分割財産にも同じ額を使う", () => {
    // 1,000万 × 33,333,333/50,000,000 = 6,666,666.6 → 6,666,666円。妻が払う
    const r = calculate(
      mk([P("妻", "spouse"), P("長男", "child")], [dep("家", 33_333_333), dep("預金", 100_000_000)], [to("家", "妻"), to("預金", "妻")], {
        compensation: [{ fromId: "妻", toId: "長男", amount: 10_000_000, basis: { assetId: "家", marketValue: 50_000_000 } }],
      }),
    );
    expect(r.compensation[0].value).toBe(6_666_666);
    expect(of(r, "妻").inherited).toBe(133_333_333 - 6_666_666);
    expect(r.spouse?.divided).toBe(133_333_333 - 6_666_666);
    expect(of(r, "長男").inherited).toBe(6_666_666);
  });

  it("もとにした財産が見つからない・時価が0なら止める。代償金の一覧は全部の行を出す", () => {
    const run = (basis: { assetId: string; marketValue: number }) =>
      calculate(mk(kids, [dep("家", 40_000_000)], [to("家", "長男")], { compensation: [{ fromId: "長男", toId: "長女", amount: 10_000_000, basis }, { fromId: "長男", toId: "長女", amount: 0 }] }));
    const missing = run({ assetId: "x", marketValue: 50_000_000 });
    expect(missing.blockers.some((b) => b.includes("代償金（1件目）の額を決めるもとにした財産が、財産の一覧に見つかりません"))).toBe(true);
    expect(missing.compensation).toHaveLength(2);
    const zero = run({ assetId: "家", marketValue: 0 });
    expect(zero.blockers.some((b) => b.includes("「家」の時価を、1円以上の整数で入れてください"))).toBe(true);
    expect(zero.compensation.map((x) => x.value)).toEqual([0, 0]);
    expect(of(zero, "長女").compensationIn).toBe(0);
  });

  it("時価をもとにしない代償金は、value が amount と同じ", () => {
    const r = calculate(mk(kids, [dep("預金", 100_000_000)], [to("預金", "長男")], { compensation: [{ fromId: "長男", toId: "長女", amount: 30_000_000 }] }));
    expect(r.compensation).toEqual([{ fromId: "長男", toId: "長女", amount: 30_000_000, value: 30_000_000 }]);
  });
});

describe("⑰ 相続時精算課税分の贈与税額控除の100円未満切捨て（国税通則法119条）", () => {
  it("納めた贈与税の合計を100円未満切捨てにしてから⑲・㉒を出し、100円単位でない入力を知らせる", () => {
    // 課税価格 5,000万 + 4,000万 = 9,000万 → 課税遺産総額 5,400万 → 5,400万×30%−700万 = 920万
    // ⑰ 12,345,678 → 12,345,600。㉒ 12,345,600 − 9,200,000 = 3,145,600
    const r = calculate({
      ...mk([P("長男", "child")], [dep("A", 50_000_000)], [to("A", "長男")], { priorGifts: [{ personId: "長男", date: "2021-04-01", amount: 40_000_000, giftTaxPaid: 12_345_678, settlement: true }] }),
      decedent: { ...decedent, settlementGift: true },
    });
    const p = r.persons[0];
    expect(p.afterCredits).toBe(9_200_000);
    expect(p.settlementCredit).toBe(12_345_600);
    expect(p.refund).toBe(3_145_600);
    expect(r.warnings.some((w) => w.includes("（1件目）の納めた贈与税が100円単位になっていません"))).toBe(true);
  });
});
