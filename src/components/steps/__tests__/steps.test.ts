import { beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { demoCase } from "@/data/demo";
import { calculate, type TaxResult } from "@/domain/tax/engine";
import type { Case, Person } from "@/domain/types";

// 画面は useCase() の中身だけを見るので、テストでは store を差し替える
const ctx: { data: Case; result: TaxResult | null; error: string | null } = { data: demoCase, result: null, error: null };
vi.mock("@/lib/store", () => ({
  useCase: () => ({ ...ctx, update: () => {}, replace: () => {}, loaded: true }),
  newId: () => "new-id",
}));
vi.mock("@/lib/planStore", () => ({ usePlan: () => ({ setStatus: () => {}, statusOf: () => undefined }) }));

const { DivisionStep, legalShareDivision, CompensationBasis } = await import("../DivisionStep");
const { DebtsStep, newDebt, withDebtAmount } = await import("../DebtsStep");
const { HeirsStep, priorCreditKinds } = await import("../HeirsStep");
const { TaxStep, filingMessage, filingNeeded, SUPPORTER_TIP } = await import("../TaxStep");
const { DocumentsStep, handFilledBlanks, divisionDocUnavailable } = await import("../DocumentsStep");

const render = (c: ComponentType, data: Case, withResult = true) => {
  ctx.data = data;
  ctx.result = withResult ? calculate(data) : null;
  ctx.error = null;
  return renderToStaticMarkup(createElement(c));
};
const clone = () => structuredClone(demoCase);

beforeEach(() => {
  ctx.data = demoCase;
  ctx.result = null;
});

describe("遺産の分け方：「すべて法定相続分どおりに分けると決めた」（ui-7）", () => {
  it("分け方が決まっていないにチェックがあるときはボタンを出さない", () => {
    expect(render(DivisionStep, clone())).toContain("すべて法定相続分どおりに分けると決めた");
    const c = clone();
    c.undivided = true;
    const html = render(DivisionStep, c);
    expect(html).not.toContain("すべて法定相続分どおりに分けると決めた");
    expect(html).not.toContain("すべて法定相続分どおりにする");
  });

  it("押すと、分ける財産すべてに法定相続分が入り、決まった分け方になる（未分割のチェックは外れる）", () => {
    const c = clone();
    c.undivided = true;
    c.allocations = [];
    const next = legalShareDivision(c);
    expect(next.undivided).toBeUndefined();
    const divisible = c.assets.filter((a) => a.kind !== "insurance" && a.kind !== "retirement");
    expect(next.allocations.map((a) => a.assetId)).toEqual(divisible.map((a) => a.id));
    // 配偶者 1/2・子 2人で 1/4 ずつ（デモの家族）
    const shares = next.allocations[0].shares;
    expect(shares.reduce((s, x) => s + x.numerator / x.denominator, 0)).toBeCloseTo(1);
    expect(shares.find((s) => s.personId === "hanako")).toMatchObject({ numerator: 1, denominator: 2 });
  });

  it("相続人の入力が途中で判定できないときは、何も変えない", () => {
    const c = clone();
    c.persons = [...c.persons, { ...c.persons[0] }]; // 同じ人が二重
    expect(() => legalShareDivision(c)).not.toThrow();
  });
});

describe("代償金：特定の財産の時価をもとに決めた（forms-5）", () => {
  const withComp = (basis?: { assetId: string; marketValue: number }) => {
    const c = clone();
    c.compensation = [{ fromId: "hanako", toId: "ichiro", amount: 10_000_000, ...(basis ? { basis } : {}) }];
    return c;
  };

  it("印を付けるまでは、財産と時価の欄を出さない", () => {
    const html = render(DivisionStep, withComp());
    expect(html).toContain("特定の財産の時価をもとに金額を決めた");
    expect(html).not.toContain("その財産の時価");
  });

  it("印を付けると財産と時価の欄が出て、課税価格に入れる額を見せる", () => {
    const c = withComp();
    const land = c.assets.find((a) => a.kind === "land")!;
    c.compensation![0].basis = { assetId: land.id, marketValue: 100_000_000 };
    const html = render(DivisionStep, c);
    expect(html).toContain("もとにした財産");
    expect(html).toContain("その財産の時価");
    expect(html).toContain("課税価格には 代償金 × 評価額 ÷ 時価 で入れます");
    const value = ctx.result!.compensation[0].value;
    expect(value).toBeGreaterThan(0);
    expect(html).toContain(`（${value.toLocaleString("ja-JP")}円）`);
    expect(html).not.toContain("もとにした財産と時価を入れてください");
  });

  it("財産や時価がまだなら、入れるように知らせる", () => {
    const html = renderToStaticMarkup(
      createElement(CompensationBasis, { basis: { assetId: "", marketValue: 0 }, baseOk: false, options: [{ value: "", label: "選んでください" }], value: 0, onToggle: () => {}, onChange: () => {} }),
    );
    expect(html).toContain("もとにした財産と時価を入れてください");
    expect(html).not.toContain("（0円）");
  });
});

describe("債務・葬式費用：分け方が決まっていないとき（ui-8）", () => {
  it("新しい債務は、未分割なら負担する人を空けておく", () => {
    const c = clone();
    expect(newDebt(c, "debt", "d1").bearers).toEqual([{ personId: "hanako", amount: 0 }]);
    c.undivided = true;
    expect(newDebt(c, "funeral", "d2")).toEqual({ id: "d2", kind: "funeral", label: "", amount: 0, bearers: [] });
  });

  it("未分割のときは、金額を1人の負担額に写さない", () => {
    const d = { id: "d", kind: "debt" as const, label: "", amount: 0, bearers: [{ personId: "hanako", amount: 0 }] };
    expect(withDebtAmount(d, 500_000, false)).toEqual({ amount: 500_000, bearers: [{ personId: "hanako", amount: 500_000 }] });
    expect(withDebtAmount(d, 500_000, true)).toEqual({ amount: 500_000, bearers: [{ personId: "hanako", amount: 0 }] });
  });

  it("未分割のときだけ、空欄なら法定相続分で計算すると出し、負担額が合わないとは言わない", () => {
    const c = clone();
    c.debts = [{ id: "d", kind: "debt", label: "借入金", amount: 1_000_000, bearers: [] }];
    const line = "負担する人が決まっていなければ、空欄のままにしてください（法定相続分で負担したものとして計算します）。";
    const divided = render(DebtsStep, c);
    expect(divided).not.toContain(line);
    expect(divided).toContain("一致していません");
    c.undivided = true;
    const html = render(DebtsStep, c);
    expect(html).toContain(line);
    expect(html).not.toContain("一致していません");
  });
});

describe("債務・葬式費用：足さない贈与（tax-5）", () => {
  it("配偶者控除・住宅取得等資金の非課税を受けた分は入れないと、Tipsで知らせる", () => {
    const html = render(DebtsStep, clone());
    expect(html).toContain("Tips：入れない贈与");
    expect(html).toContain("贈与税の配偶者控除（2,000万円まで）");
    expect(html).toContain("住宅取得等資金の非課税");
  });
});

describe("相続人：以前の相続で受けた未成年者控除・障害者控除（tax-3）", () => {
  const base: Person = { id: "x", name: "次郎", relation: "child" };
  it("18歳未満なら未成年者控除、障害者なら障害者控除を聞く。相続人以外・先に亡くなった人には聞かない", () => {
    expect(priorCreditKinds(base, 10).map((k) => k.key)).toEqual(["priorMinorCredit"]);
    expect(priorCreditKinds(base, 18)).toEqual([]);
    expect(priorCreditKinds(base, undefined)).toEqual([]);
    expect(priorCreditKinds({ ...base, disability: "general" }, 40).map((k) => k.key)).toEqual(["priorDisabilityCredit"]);
    expect(priorCreditKinds({ ...base, disability: "special" }, 5).map((k) => k.key)).toEqual(["priorMinorCredit", "priorDisabilityCredit"]);
    expect(priorCreditKinds({ ...base, disability: "none" }, 40)).toEqual([]);
    expect(priorCreditKinds({ ...base, relation: "other" }, 10)).toEqual([]);
    expect(priorCreditKinds({ ...base, predeceased: true }, 10)).toEqual([]);
    expect(priorCreditKinds({ ...base, relation: "grandchild" }, 10, false)).toEqual([]);
  });

  // デモの家族では、孫のさくらさん（先に亡くなった二男の代わりに相続する人）が亡くなった日に15歳
  const withMinor = (extra: Partial<Person> = {}) => {
    const c = clone();
    c.persons = c.persons.map((p) => (p.id === "sakura" ? { ...p, ...extra } : p));
    return c;
  };

  it("未成年の相続人だけに印を出し、印を付けたときだけ日付と金額の欄を出す", () => {
    const adults = render(HeirsStep, withMinor({ birthDate: "2000-01-01" }));
    expect(adults).not.toContain("以前の相続でも");
    // 代わりに相続する人でない孫は相続人ではないので、聞かない
    expect(render(HeirsStep, withMinor({ substituteOf: undefined }))).not.toContain("以前の相続でも");
    const minor = render(HeirsStep, withMinor());
    expect(minor).toContain("以前の相続でも未成年者控除を受けた");
    expect(minor).not.toContain("以前の相続でも障害者控除を受けた");
    expect(minor).not.toContain("その相続が始まった日");
    const open = render(HeirsStep, withMinor({ priorMinorCredit: { date: "2022-05-01", amount: 300_000 } }));
    expect(open).toContain("その相続が始まった日");
    expect(open).toContain("これまでに控除を受けた金額（扶養義務者から引いた分を含む）");
    expect(open).toContain('value="2022-05-01"');
    expect(open).toContain('value="300,000"');
  });

  it("障害者の人には障害者控除の印を出す", () => {
    const c = withMinor({ birthDate: "2000-01-01" });
    c.persons = c.persons.map((p) => (p.id === "hanako" ? { ...p, disability: "general" } : p));
    const html = render(HeirsStep, c);
    expect(html).toContain("以前の相続でも障害者控除を受けた");
    expect(html).not.toContain("以前の相続でも未成年者控除を受けた");
  });
});

describe("税額の確認：申告がいるか（tax-6）", () => {
  it("基礎控除以下でも、精算課税の贈与税が戻るなら申告が必要と言う", () => {
    const refund = { needsFiling: false, totalRefund: 1_000_000, totalPayable: 0, totalTax: 0 };
    expect(filingNeeded(refund)).toBe(true);
    expect(filingMessage(refund)).toContain("申告が必要です");
    expect(filingMessage(refund)).not.toContain("いりません");
    expect(filingMessage({ ...refund, needsFiling: true, totalTax: 500_000 })).toBe("納める税金は0円ですが、相続時精算課税で納めた贈与税を返してもらうには、申告が必要です。");
    const none = { needsFiling: false, totalRefund: 0, totalPayable: 0, totalTax: 0 };
    expect(filingNeeded(none)).toBe(false);
    expect(filingMessage(none)).toBe("相続税はかからず、申告も原則いりません。");
    expect(filingMessage({ ...none, needsFiling: true, totalTax: 3_000_000, totalPayable: 1_000_000 })).toContain("申告期限までに納めます");
  });

  it("基礎控除以下で還付があるときは、申告の期限も出す（納税の期限とは言わない）", () => {
    const c: Case = {
      ...clone(),
      persons: [{ id: "c1", name: "一郎", relation: "child", relationLabel: "長男", birthDate: "1980-01-01" }],
      assets: [{ id: "a1", kind: "deposit", label: "預金", amount: 10_000_000 } as Case["assets"][number]],
      allocations: [{ assetId: "a1", shares: [{ personId: "c1", numerator: 1, denominator: 1 }] }],
      debts: [],
      compensation: [],
      priorGifts: [{ personId: "c1", date: "2024-05-10", amount: 10_000_000, giftTaxPaid: 1_000_000, settlement: true }],
      decedent: { ...demoCase.decedent, settlementGift: true, priorInheritanceTax: false },
    };
    const r = calculate(c);
    expect(r.totalRefund).toBeGreaterThan(0);
    expect(r.totalTaxable).toBeLessThanOrEqual(r.basicDeduction);
    const html = render(TaxStep, c);
    expect(html).toContain("申告が必要です");
    expect(html).not.toContain("申告も原則いりません");
    expect(html).toContain("申告の期限：");
    expect(html).not.toContain("申告・納税の期限");
  });

  it("扶養義務者のTipsは、本人の配偶者・直系血族・兄弟姉妹と言い、おじ・おばなどは税理士に相談と言う（tax-1）", () => {
    expect(SUPPORTER_TIP).toContain("配偶者・直系血族（親・子・祖父母・孫）・兄弟姉妹");
    expect(SUPPORTER_TIP).toContain("おじ・おばなどで本人と生計を一にしていた人の分は、税理士にご相談ください");
    expect(SUPPORTER_TIP).not.toContain("父母・子など");
  });

  it("デモの案件で画面を表示できる", () => {
    const html = render(TaxStep, clone());
    expect(html).toContain("家族全体で納める相続税");
    expect(html).toContain("申告・納税の期限：");
  });
});

describe("書類の作成（forms-8・forms-10）", () => {
  it("分け方が決まっていれば、第11表の分割の日を手で書く欄に入れる。全部未分割なら入れない", () => {
    const blank = "第11表の分割の日（遺産分割協議がまとまった日）";
    expect(handFilledBlanks(calculate(demoCase))).toContain(blank);
    const c = clone();
    c.undivided = true;
    c.allocations = [];
    for (const a of c.assets) if (a.kind === "land") a.smallResidential = undefined;
    expect(handFilledBlanks(calculate(c))).not.toContain(blank);
    expect(handFilledBlanks(null)).toEqual(["マイナンバー（個人番号）欄"]);
    expect(render(DocumentsStep, clone())).toContain(blank);
  });

  it("相続人がいなければ、遺産分割協議書のボタンを押せなくし、理由を1行で出す", () => {
    expect(divisionDocUnavailable(demoCase)).toBeNull();
    const c = clone();
    c.persons = c.persons.map((p) => ({ ...p, renounced: true }));
    const why = divisionDocUnavailable(c);
    expect(why).toContain("相続人がいない");
    const html = render(DocumentsStep, c);
    expect(html).toContain(why!);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>遺産分割協議書PDFをダウンロード<\/button>/);
    expect(divisionDocUnavailable({ ...clone(), persons: [] })).toContain("相続人");
    const ok = render(DocumentsStep, clone());
    expect(ok).not.toMatch(/<button[^>]*disabled=""[^>]*>遺産分割協議書PDFをダウンロード<\/button>/);
  });
});
