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
const { HeirsStep, priorCreditKinds, removePerson } = await import("../HeirsStep");
const { TaxStep, filingMessage, filingNeeded, refundOnlyFiling, SUPPORTER_TIP, ROUNDING_TIP } = await import("../TaxStep");
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
    const line = "負担する人が決まっていなければ、入っている人を×で外して空欄にしてください（法定相続分で計算します）。";
    const divided = render(DebtsStep, c);
    expect(divided).not.toContain(line);
    expect(divided).toContain("一致していません");
    c.undivided = true;
    const html = render(DebtsStep, c);
    expect(html).toContain(line);
    expect(html).not.toContain("一致していません");
  });

  it("未分割で負担額が入っていない債務には、負担する人の下に法定相続分で計算すると出す（ui-1）", () => {
    const note = "（法定相続分で負担したものとして計算します）";
    const c = clone();
    // 分け方が決まっていないにチェックする前に作った債務（最初の人が負担する人として入っている）で、金額は後から入れた
    c.debts = [{ id: "d", kind: "debt", label: "借入金", amount: 1_000_000, bearers: [{ personId: "hanako", amount: 0 }] }];
    expect(render(DebtsStep, c)).not.toContain(note);
    c.undivided = true;
    expect(render(DebtsStep, c)).toContain(note);
    // 負担する人を空にしても同じ
    expect(render(DebtsStep, { ...c, debts: [{ ...c.debts[0], bearers: [] }] })).toContain(note);
    // 負担額を入れた債務は、入れた人が負担する（法定相続分とは言わない）
    expect(render(DebtsStep, { ...c, debts: [{ ...c.debts[0], bearers: [{ personId: "hanako", amount: 1_000_000 }] }] })).not.toContain(note);
    // 金額が0の債務には出さない
    expect(render(DebtsStep, { ...c, debts: [{ ...c.debts[0], amount: 0 }] })).not.toContain(note);
  });
});

describe("債務・葬式費用：足さない贈与（tax-5）", () => {
  it("配偶者控除・住宅取得等資金の非課税を受けた分は入れないと、Tipsで知らせる", () => {
    const html = render(DebtsStep, clone());
    expect(html).toContain("Tips：入れない贈与");
    expect(html).toContain("贈与税の配偶者控除（2,000万円まで）");
    expect(html).toContain("住宅取得等資金の非課税");
  });

  it("配偶者控除を受けた贈与は、配偶者控除の額だけを引き、基礎控除の110万円は引かないと言う（ui-5）", () => {
    const html = render(DebtsStep, clone());
    expect(html).toContain("配偶者控除を受けた贈与は、配偶者控除の額（2,000万円まで）だけを引いた残りを入れてください（基礎控除の110万円は引きません）。");
    expect(html).not.toContain("控除を受けた額を引いた残りだけ");
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

  it("以前の相続でも障害者控除を受けたときだけ、その相続のときの区分を聞く。選ぶまでは今と同じ区分（law-1）", () => {
    const withDisability = (disability: Person["disability"], prior?: Person["priorDisabilityCredit"]) => {
      const c = withMinor({ birthDate: "2000-01-01" });
      c.persons = c.persons.map((p) => (p.id === "hanako" ? { ...p, disability, priorDisabilityCredit: prior } : p));
      return render(HeirsStep, c);
    };
    const label = "その相続のときの区分";
    expect(withDisability("special")).not.toContain(label);
    const selected = (h: string) => h.slice(h.indexOf(label)).match(/<option value="(general|special)" selected="">/)?.[1];
    // 今が特別障害者なら特別障害者、一般障害者なら一般障害者を選んでおく
    const now = withDisability("special", { date: "2021-01-10", amount: 2_500_000 });
    expect(now).toContain(label);
    expect(now).toContain(">一般障害者</option>");
    expect(now).toContain(">特別障害者</option>");
    expect(selected(now)).toBe("special");
    expect(selected(withDisability("general", {}))).toBe("general");
    // 選んだ区分を見せる
    expect(selected(withDisability("special", { special: false }))).toBe("general");
    expect(selected(withDisability("general", { special: true }))).toBe("special");
    // 未成年者控除には聞かない
    const minor = render(HeirsStep, withMinor({ priorMinorCredit: { date: "2022-05-01", amount: 300_000 } }));
    expect(minor).toContain("その相続が始まった日");
    expect(minor).not.toContain(label);
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

  it("基礎控除以下で還付だけを受ける申告は、10か月の期限ではなく、5年以内に出せると言う（ui-4）", () => {
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
    expect(refundOnlyFiling(r)).toBe(true);
    const html = render(TaxStep, c);
    expect(html).toContain("申告が必要です");
    expect(html).not.toContain("申告も原則いりません");
    // 国税庁 タックスアンサー No.4301：還付を受けるための申告書は、相続開始の日の翌日から5年を経過する日まで出せる
    expect(html).toContain("還付を受ける申告は、亡くなった日の翌日から5年以内に出せます。");
    expect(html).not.toContain("申告の期限：");
    expect(html).not.toContain("申告・納税の期限");
  });

  it("還付だけの申告かどうか：基礎控除を超える・特例を使って基礎控除以下にした・還付がないときは違う", () => {
    const base = { totalTaxable: 40_000_000, basicDeduction: 48_000_000, totalRefund: 1_000_000, assets: [] as TaxResult["assets"] };
    expect(refundOnlyFiling(base)).toBe(true);
    expect(refundOnlyFiling({ ...base, totalRefund: 0 })).toBe(false);
    expect(refundOnlyFiling({ ...base, totalTaxable: 50_000_000 })).toBe(false);
    // 小規模宅地等の特例で基礎控除以下にしたときは、特例を受けるための申告（10か月の期限）になる
    const reduced = [{ reduction: 10_000_000 }] as unknown as TaxResult["assets"];
    expect(refundOnlyFiling({ ...base, assets: reduced })).toBe(false);
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

  it("マンションの敷地権の割合が分からなければ、第11表の付表1の備考を手で書く欄に入れる（forms-3）", () => {
    const blank = "第11表の付表1の備考（マンションの敷地権の割合。登記事項証明書の『敷地権の割合』、例：10000分の169）";
    // デモのマンションは登記の敷地権の割合（所有権　10000分の169）が入っている
    expect(handFilledBlanks(calculate(demoCase))).not.toContain(blank);
    const withSiteRight = (siteRight: string | undefined) => {
      const c = clone();
      c.assets = c.assets.map((a) => (a.kind === "condo" ? { ...a, registry: { ...a.registry, siteRight } } : a));
      return handFilledBlanks(calculate(c));
    };
    expect(withSiteRight(undefined)).toContain(blank);
    expect(withSiteRight("所有権")).toContain(blank);
    expect(withSiteRight("169/10000")).not.toContain(blank);
    const noRegistry = clone();
    noRegistry.assets = noRegistry.assets.map((a) => (a.kind === "condo" ? { ...a, registry: undefined } : a));
    expect(handFilledBlanks(calculate(noRegistry))).toContain(blank);
    expect(render(DocumentsStep, noRegistry)).toContain(blank);
    // マンションがなければ出さない
    const noCondo = clone();
    noCondo.assets = noCondo.assets.filter((a) => a.kind !== "condo");
    noCondo.allocations = noCondo.allocations.filter((x) => noCondo.assets.some((a) => a.id === x.assetId));
    expect(handFilledBlanks(calculate(noCondo))).not.toContain(blank);
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

describe("一人ひとりの税額の端数（相基通17-1）", () => {
  const tip = "一人ひとりの税額は、按分割合の合計が1になるように端数を調整し（相基通17-1）、100円未満を切り捨てるため、同じ課税価格でも100円ほど違うことがあります。";

  it("第1表の Tips に、端数の調整と100円未満の切捨てを1文で入れる", () => {
    expect(ROUNDING_TIP).toBe(tip);
    const html = render(TaxStep, clone());
    expect(html).toContain("Tips：一人ひとりの税額");
    expect(html).toContain(tip);
    // Tips の中に1回だけ出す（Tips の外には出さない）
    expect(html.indexOf(tip)).toBeGreaterThan(html.indexOf("Tips：一人ひとりの税額"));
    expect(html.split(tip).length).toBe(2);
  });

  it("一人ひとりの納める税額を、家族全体の額とは別に出す", () => {
    const c = clone();
    const r = calculate(c);
    const html = render(TaxStep, c);
    const payers = r.persons.filter((p) => p.payable > 0);
    expect(payers.length).toBeGreaterThan(1);
    for (const p of payers) expect(html).toContain(`${p.payable.toLocaleString("ja-JP")}<span class="ml-0.5 text-sm">円</span>`);
    expect(html).toContain("納付すべき税額");
  });

  it("税額を分ける人が1人だけなら、端数の Tips は出さない", () => {
    const c: Case = {
      ...clone(),
      persons: [{ id: "c1", name: "一郎", relation: "child", relationLabel: "長男", birthDate: "1980-01-01" }],
      assets: [{ id: "a1", kind: "deposit", label: "預金", amount: 100_000_000 } as Case["assets"][number]],
      allocations: [{ assetId: "a1", shares: [{ personId: "c1", numerator: 1, denominator: 1 }] }],
      debts: [],
      compensation: [],
      priorGifts: [],
      decedent: { ...demoCase.decedent, settlementGift: false, priorInheritanceTax: false },
    };
    expect(calculate(c).totalTax).toBeGreaterThan(0);
    expect(render(TaxStep, c)).not.toContain(tip);
  });
});

describe("家族を削除したとき、小規模宅地等の特例の取得者から外す", () => {
  const withOthers = (): Case => {
    const c = clone();
    c.assets = c.assets.map((a) =>
      a.id === "home-land" && a.kind === "land"
        ? {
            ...a,
            smallResidential: {
              applies: true,
              acquirerId: "hanako",
              selectedSqm: 50,
              check: { ownHome: "yes", special: "no", livedTogether: "no" },
              others: [
                { acquirerId: "ichiro", check: { livedTogether: "yes", keep: "yes" }, selectedSqm: 20 },
                { acquirerId: "sakura", check: { livedTogether: "yes" } },
              ],
            },
          }
        : a,
    );
    return c;
  };
  const srOf = (c: Case) => {
    const a = c.assets.find((x) => x.id === "home-land");
    return a?.kind === "land" ? a.smallResidential : undefined;
  };

  it("一緒に取得する人から削除すると、その人の行ごと外し、ほかの人と最初の人はそのまま", () => {
    const sr = srOf(removePerson(withOthers(), "ichiro"))!;
    expect(sr.acquirerId).toBe("hanako");
    expect(sr.selectedSqm).toBe(50);
    expect(sr.others).toEqual([{ acquirerId: "sakura", check: { livedTogether: "yes" } }]);
    expect(srOf(removePerson(removePerson(withOthers(), "ichiro"), "sakura"))!.others).toBeUndefined();
  });

  it("最初の取得者を削除すると、これまでどおり未選択に戻し（土地についての答えは残す）、面積も消す。一緒に取得する人は残す", () => {
    const sr = srOf(removePerson(withOthers(), "hanako"))!;
    expect(sr.acquirerId).toBeUndefined();
    expect(sr.selectedSqm).toBeUndefined();
    expect(sr.check).toEqual({ ownHome: "yes", special: "no", business: undefined, recent: undefined });
    expect(sr.others?.map((o) => o.acquirerId)).toEqual(["ichiro", "sakura"]);
  });

  it("特例に関係のない人を削除しても、特例の入力は変えない", () => {
    const c = withOthers();
    const before = srOf(c);
    expect(srOf(removePerson(c, "jiro"))).toBe(before);
  });
});
