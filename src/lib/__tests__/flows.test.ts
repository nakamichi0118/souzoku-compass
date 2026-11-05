/**
 * ふつうの家族の相続を、画面で入れる順番（聞き取り → ①〜⑧）どおりに入れて、最後まで進めるかを確かめる。
 * 画面の操作は、画面が使っているのと同じ関数（blankAsset・answerFirstAcquirer・withSoleHeir など）で行い、
 * 各段階で「計算を止める事項」が残らないこと、残るなら直す場所へのリンクがあることを見る。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/store", () => ({ newId: (() => { let n = 0; return () => `id${++n}`; })(), useCase: () => ({}) }));

const { blankAsset } = await import("@/components/steps/AssetsStep");
const { answerFirstAcquirer, firstAcquirerChange } = await import("@/components/steps/LandEditor");
const { calculate } = await import("@/domain/tax/engine");
const { blankInterview, familyFromInterview } = await import("@/domain/procedures/interview");
const { TOPICS, caseDraftReason, reviewSummary } = await import("@/domain/review/topics");
const { filingSteps, markCompleted, markFormsCreated, unsettledAssets, visibleSteps, withSoleHeir } = await import("../progress");
const { fixTarget } = await import("../fixLink");
const { buildFilingPages } = await import("@/forms/filing");
const { checkCase } = await import("@/server/caseSchema");
import type { Asset, Case, LandAsset } from "@/domain/types";
import type { ReviewState } from "@/domain/review/topics";

/** 聞き取りの答えから、相続人の画面に入る家族の下書き（名前は相続人の画面で入れる） */
function fromHearing(answers: Partial<ReturnType<typeof blankInterview>>, names: string[]): Case {
  const iv = { ...blankInterview(), deathDate: "2026-04-10", address: "東京都千代田区架空町一丁目2番3号", decedentName: "相続 太郎", ...answers };
  const persons = familyFromInterview(iv).map((p, i) => ({ ...p, name: names[i] ?? `家族${i + 1}`, birthDate: p.relation === "spouse" ? "1955-05-05" : "1985-08-08" }));
  return {
    title: "相続 太郎さんの相続",
    decedent: { name: "相続 太郎", deathDate: iv.deathDate, address: iv.address, birthDate: "1950-01-01" },
    persons,
    assets: [],
    debts: [],
    priorGifts: [],
    allocations: [],
  } as unknown as Case;
}

const add = <T extends Asset>(c: Case, kind: T["kind"], p: Partial<T>): Case => ({ ...c, assets: [...c.assets, { ...(blankAsset(kind) as T), ...p }] });
const patchAsset = (c: Case, id: string, p: Partial<Asset>): Case => ({ ...c, assets: c.assets.map((a) => (a.id === id ? ({ ...a, ...p } as Asset) : a)) });
/** 申告前の確認：13問すべて「ない」 */
const reviewAllNo = (c: Case): Case => ({ ...c, review: { answers: Object.fromEntries(TOPICS.map((t) => [t.id, "no"])) } as ReviewState });
/** 遺産の分け方：財産ごとに1人へ */
const allocate = (c: Case, who: Record<string, string>): Case => ({
  ...c,
  allocations: Object.entries(who).map(([assetId, personId]) => ({ assetId, shares: [{ personId, numerator: 1, denominator: 1 }] })),
});
/** 画面の「次へ」をすべて押した */
const nextAll = (c: Case) => ["decedent", "heirs", "assets", "debts", "review", "division", "tax"].reduce(markCompleted, c);

/** 止まる事項がなく、申告書の欄を作れて、すべてのステップが済みになる */
function expectFinished(c0: Case) {
  const c = withSoleHeir(c0);
  const r = calculate(c);
  expect(r.blockers, r.blockers.join("\n")).toEqual([]);
  expect(unsettledAssets(c)).toEqual([]);
  expect(checkCase(c)).toMatchObject({ ok: true });
  expect(buildFilingPages(c, r).length).toBeGreaterThan(0);
  const done = markFormsCreated(nextAll(c));
  const steps = filingSteps(done, calculate(done));
  const shown = new Set(visibleSteps(done).map((s) => s.slug));
  expect(steps.filter((s) => shown.has(s.slug as never) && !s.done).map((s) => s.slug)).toEqual([]);
  return { c, r };
}

describe("ふつうの相続を最後まで進められる", () => {
  it("配偶者と子2人：預金・自宅（路線価・小規模宅地）・葬式費用", () => {
    let c = fromHearing({ spouse: true, hasChildren: "yes", children: 2 }, ["相続 花子", "相続 一郎", "相続 次郎"]);
    const [spouse, son1, son2] = c.persons;
    c = add(c, "deposit", { label: "架空銀行 普通預金", amount: 32_000_000 } as never);
    c = add(c, "land", { label: "自宅の土地", location: "東京都千代田区架空町一丁目", areaSqm: 165, method: { type: "rosenka", routePrice: 300_000, depthCorrection: 1 } } as Partial<LandAsset>);
    c = add(c, "building", { label: "自宅の家屋", location: "東京都千代田区架空町一丁目", fixedAssetValue: 6_000_000 } as never);
    const [dep, land, home] = c.assets;
    // 小規模宅地：取得する人（配偶者）を選び、質問に答える
    const sr0 = { applies: false };
    let sr = { ...sr0, ...firstAcquirerChange(sr0, spouse.id) };
    sr = { ...sr, ...answerFirstAcquirer(sr, "ownHome", "yes") };
    sr = { ...sr, ...answerFirstAcquirer(sr, "special", "no") };
    c = patchAsset(c, land.id, { smallResidential: { ...sr, applies: true } } as Partial<LandAsset>);
    c = { ...c, debts: [{ id: "f1", kind: "funeral", label: "葬儀社", amount: 1_500_000, bearers: [{ personId: spouse.id, amount: 1_500_000 }] }] };
    c = reviewAllNo(c);
    c = allocate(c, { [dep.id]: son1.id, [land.id]: spouse.id, [home.id]: spouse.id });
    // 子の一人だけが預金を受け取る形でも、止まらない
    expect(son2.id).toBeTruthy();
    const { r } = expectFinished(c);
    // 小規模宅地が効いている（330㎡以内・80%）
    expect(r.assets.find((l) => l.asset.id === land.id)!.reduction).toBe(Math.floor(300_000 * 165 * 0.8));
  });

  it("相続人が子1人：分け方を入れなくても（自動で1人に）最後まで進む", () => {
    let c = fromHearing({ spouse: false, hasChildren: "yes", children: 1 }, ["相続 一郎"]);
    c = add(c, "deposit", { label: "架空銀行 定期預金", amount: 60_000_000 } as never);
    c = { ...c, debts: [{ id: "d1", kind: "debt", label: "架空カード", amount: 120_000, bearers: [] }] };
    c = reviewAllNo(c);
    const { c: done } = expectFinished(c);
    expect(visibleSteps(done).some((s) => s.slug === "division")).toBe(false);
  });

  it("形がいびつ・セットバック・広い宅地は、補正率を入れなくても（相談しないと選んでも）止まらない", () => {
    for (const p of [
      { condition: "irregular" as const },
      { condition: "setback" as const, reductionConsult: false },
      { areaSqm: 620 },
      { condition: "irregular" as const, areaSqm: 700, reductionConsult: true },
    ]) {
      let c = fromHearing({ spouse: true, hasChildren: "yes", children: 1 }, ["相続 花子", "相続 一郎"]);
      c = add(c, "land", { label: "土地", location: "千葉県船橋市架空町", areaSqm: 300, method: { type: "rosenka", routePrice: 150_000, depthCorrection: 1 }, ...p } as Partial<LandAsset>);
      c = reviewAllNo(allocate(c, { [c.assets[0].id]: c.persons[1].id }));
      const { r } = expectFinished(c);
      // 減額しない（高めの）評価額で計算する
      expect(r.assets[0].valuation.value).toBe(150_000 * ((p as { areaSqm?: number }).areaSqm ?? 300));
    }
  });

  it("相続時精算課税が「分からない」でも止まらず、申告書は下書きになる", () => {
    let c = fromHearing({ spouse: true, hasChildren: "yes", children: 1 }, ["相続 花子", "相続 一郎"]);
    c = add(c, "deposit", { label: "架空銀行 普通預金", amount: 70_000_000 } as never);
    c = reviewAllNo(allocate(c, { [c.assets[0].id]: c.persons[1].id }));
    c = { ...c, decedent: { ...c.decedent, settlementGift: "unknown" } };
    expectFinished(c);
    expect(caseDraftReason(c)).toContain("相続時精算課税");
    expect(caseDraftReason({ ...c, decedent: { ...c.decedent, settlementGift: false } })).toBeNull();
    expect(reviewSummary(c.review).confirmed).toBe(true);
  });
});

describe("止まる入力には、直す場所へのリンクがある", () => {
  const base = () => {
    let c = fromHearing({ spouse: true, hasChildren: "yes", children: 1 }, ["相続 花子", "相続 一郎"]);
    c = add(c, "deposit", { label: "架空銀行 普通預金", amount: 50_000_000 } as never);
    return reviewAllNo(c);
  };
  it.each([
    ["取得者を決めていない財産", (c: Case) => c, "/case/division?focus=asset-"],
    [
      "受取人を選んでいない保険金",
      (c: Case) => allocate(add(c, "insurance", { label: "架空生命 死亡保険金", amount: 3_000_000 } as never), { [c.assets[0].id]: c.persons[0].id }),
      "/case/assets?asset=",
    ],
    [
      "書類から読み取って確かめていない財産",
      (c: Case) => allocate(patchAsset(c, c.assets[0].id, { pending: ["金額"] }), { [c.assets[0].id]: c.persons[0].id }),
      "/case/assets?asset=",
    ],
    [
      "負担額の合計が合わない債務",
      (c: Case) => ({ ...allocate(c, { [c.assets[0].id]: c.persons[0].id }), debts: [{ id: "d1", kind: "debt" as const, label: "架空ローン", amount: 500_000, bearers: [{ personId: c.persons[0].id, amount: 100_000 }] }] }),
      "/case/division?focus=debt-d1",
    ],
    [
      "日付のない贈与",
      (c: Case) => ({ ...allocate(c, { [c.assets[0].id]: c.persons[0].id }), priorGifts: [{ personId: c.persons[1].id, amount: 1_000_000, date: "", settlement: false } as never] }),
      "/case/debts?focus=gift-0",
    ],
    [
      "前の相続の額を入れていない相次相続控除",
      (c: Case) => ({ ...allocate(c, { [c.assets[0].id]: c.persons[0].id }), decedent: { ...c.decedent, priorInheritanceTax: true } }),
      "/case/decedent?focus=priorInheritance",
    ],
  ])("%s", (_name, make, href) => {
    const c = withSoleHeir(make(base()));
    const r = calculate(c);
    expect(r.blockers.length).toBeGreaterThan(0);
    for (const b of r.blockers) expect(fixTarget(c, b).href, b).toContain(href);
  });
});
