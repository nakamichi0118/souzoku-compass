import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FAQS } from "@/components/compass/faq";
import type { Asset, BuildingAsset, CondoAsset, LandAsset, Person } from "@/domain/types";
import { AssetEditor } from "../AssetsStep";
import {
  LandEditor,
  RentRatioField,
  SmallResidential,
  USE_OPTIONS,
  acquiredSqm,
  addOtherAcquirer,
  answerFirstAcquirer,
  answerOtherAcquirer,
  confirmOtherAcquirer,
  firstAcquirerChange,
  landUsePatch,
  manualValueLabel,
  otherAcquirerCheck,
  otherAcquirerQuestions,
  othersAfterLotAnswer,
  recentAskedAt,
  removeOtherAcquirer,
  rentRatioLooksTooSmall,
  setOtherAcquirerPerson,
  setSelectedSqm,
  smallLandDivisionGap,
  usesRentRatio,
} from "../LandEditor";

const noop = () => {};
const spouse: Person = { id: "w", name: "花子", relation: "spouse", relationLabel: "妻" };
const child: Person = { id: "c", name: "一郎", relation: "child", relationLabel: "長男" };
const living = [spouse, child];

const land = (p: Partial<LandAsset> = {}): LandAsset => ({
  id: "L1",
  kind: "land",
  label: "自宅の土地",
  location: "東京都世田谷区1-2-3",
  areaSqm: 150,
  landUse: "宅地",
  method: { type: "rosenka", routePrice: 200_000, depthCorrection: 1 },
  ...p,
});
const html = (a: LandAsset, division?: Parameters<typeof LandEditor>[0]["division"]) => renderToStaticMarkup(createElement(LandEditor, { living, a, patch: noop, division }));

describe("土地の使い方（家賃・地代をもらっているか）ui-1 / valuation-2", () => {
  it("貸している使い方の選択肢は、家賃・地代をもらっていることを書く", () => {
    const label = Object.fromEntries(USE_OPTIONS.map((o) => [o.value, o.label]));
    expect(label.rentedHouse).toBe("家賃をもらってアパート・貸家を貸している");
    expect(label.leasedLand).toBe("地代をもらって土地を貸し、借りた人が建物を建てている");
    expect(label.leasehold).toBe("人の土地を借りて、自宅などの建物を建てている（借地権）");
    expect(label.rentedLeasehold).toBe("人の土地を借りて建てたアパート・貸家を、家賃をもらって貸している");
    expect(USE_OPTIONS.map((o) => o.value)).toEqual(["self", "rentedHouse", "leasedLand", "leasehold", "rentedLeasehold"]);
  });

  it("選択の下に、無料で貸しているときの短い案内を出し、くわしい説明は Tips に入れる", () => {
    const h = html(land());
    expect(h).toContain("家族に無料で貸している土地も「自分で使っている」");
    expect(h).toContain("Tips：土地の使い方の選び方");
    // 「固定資産税くらいの額だけ」のくわしい話は Tips に入れる
    expect(h).toContain("固定資産税くらいの額を受け取るだけのときも同じです");
    expect(h).toContain("使用貸借");
    // 地代を払わずに人の土地を借りているときは、土地を財産に入れない
    expect(h).toContain("この土地は財産に入れません");
  });

  it("家屋・マンションの「貸している」は、家賃をもらっているときだけ（無料ならチェックしない）", () => {
    const building: BuildingAsset = { id: "B1", kind: "building", label: "", location: "", fixedAssetValue: 0 };
    const condo: CondoAsset = {
      id: "C1",
      kind: "condo",
      label: "",
      location: "",
      landValueBeforeCorrection: 0,
      buildingFixedAssetValue: 0,
      builtYearsMonths: { years: 0, months: 0 },
      totalFloors: 0,
      floor: 0,
      landShareSqm: 0,
      exclusiveAreaSqm: 0,
    };
    for (const asset of [building, condo] as Asset[]) {
      const h = renderToStaticMarkup(createElement(AssetEditor, { living, asset, patch: noop }));
      expect(h).toContain("家賃をもらって人に貸している");
      expect(h).toContain("家族に無料（固定資産税くらいを受け取るだけも同じ）で貸しているなら、チェックしません。");
      expect(h).not.toContain(">人に貸している<");
    }
  });
});

describe("人の土地を借りて建てたアパート・貸家（貸家建付借地権）ui-10", () => {
  it("貸している割合と借地権割合を、ほかの貸している使い方と同じように聞く", () => {
    // 欄の名前（Tips の説明の中の言葉ではなく）
    const rentField = "貸している割合</span>";
    const leaseField = "借地権割合</span>";
    for (const use of ["rentedHouse", "rentedLeasehold"] as const) {
      const h = html(land({ use, method: { type: "multiplier", fixedAssetValue: 10_000_000, multiplier: 1.1 } }));
      expect(h).toContain(rentField);
      expect(h).toContain(leaseField);
    }
    for (const use of ["leasedLand", "leasehold"] as const) {
      const h = html(land({ use, method: { type: "multiplier", fixedAssetValue: 10_000_000, multiplier: 1.1 } }));
      expect(h).not.toContain(rentField);
      expect(h).toContain(leaseField);
    }
    expect(html(land())).not.toContain(rentField);
    expect(html(land())).not.toContain(leaseField);
  });

  it("路線価の記号で借地権割合が決まるときは、記号から見せる", () => {
    const h = html(land({ use: "rentedLeasehold", method: { type: "rosenka", routePrice: 0, depthCorrection: 1, roads: [{ edge: 0, price: 300_000, depth: 15, notation: "300D" }] } }));
    expect(h).toContain("路線価の記号 D");
  });

  it("使い方を変えても、アパート・貸家を貸している使い方どうしなら賃貸割合を残す", () => {
    expect(usesRentRatio("rentedLeasehold")).toBe(true);
    expect(usesRentRatio("leasehold")).toBe(false);
    const a = land({ use: "rentedHouse", rentRatio: 0.8 });
    expect(landUsePatch(a, "rentedLeasehold")).toMatchObject({ use: "rentedLeasehold", rentRatio: 0.8 });
    expect(landUsePatch(a, "leasehold")).toMatchObject({ use: "leasehold", rentRatio: undefined });
    expect(landUsePatch(a, "self")).toMatchObject({ use: undefined, rentRatio: undefined });
  });

  it("借地権からアパート・貸家を貸している借地権に変えると、特例は貸付事業用になるので前の答えを引き継がない", () => {
    const a = land({ use: "leasehold", smallResidential: { applies: true, acquirerId: "w", check: { ownHome: "yes", special: "no" } } });
    expect(landUsePatch(a, "rentedLeasehold").smallResidential).toEqual({ applies: false, acquirerId: "w", check: undefined });
  });
});

describe("貸している割合の入力 ui-11 / valuation-8 / valuation-5", () => {
  const field = (value: number | undefined) => renderToStaticMarkup(createElement(RentRatioField, { value, onChange: noop }));

  it("一時的な空き部屋は貸しているものとして数え、廊下・階段などは床面積に入れないと案内する", () => {
    const h = field(0.9);
    expect(h).toContain("一時的な空室も貸しているものとして数えます");
    expect(h).toContain("廊下・階段は床面積に入れません");
    expect(h).not.toContain("全体の床面積");
  });

  it("1%以下のときだけ、%で入れているか確かめる注意を出す（止めない）", () => {
    expect(rentRatioLooksTooSmall(0.01)).toBe(true);
    expect(rentRatioLooksTooSmall(0.005)).toBe(true);
    expect(rentRatioLooksTooSmall(0.011)).toBe(false);
    expect(rentRatioLooksTooSmall(1)).toBe(false);
    expect(rentRatioLooksTooSmall(0)).toBe(false);
    expect(rentRatioLooksTooSmall(undefined)).toBe(false);
    const warn = "1%以下になっています。%で入れているか確かめてください";
    expect(field(0.01)).toContain(warn);
    expect(field(0.5)).not.toContain(warn);
    expect(field(undefined)).not.toContain(warn);
  });

  it("Tips と FAQ も同じ数え方を説明する", () => {
    expect(html(land({ use: "rentedHouse" }))).toContain("廊下・階段などのみんなで使う部分は入れません");
    const faq = FAQS.assets.find((f) => f.q === "土地はどう評価する？")!.a;
    expect(faq).toContain("一時的な空き部屋は、貸しているものとして数えます");
    expect(faq).toContain("廊下・階段などのみんなで使う部分は入れません");
    expect(faq).toContain("使用貸借");
    expect(faq).toContain("25〜28");
  });
});

describe("評価額を直接入力するときの欄 valuation-4", () => {
  it("貸している・借りている土地では、自用地としての額（減額する前の額）を入れてもらう", () => {
    expect(manualValueLabel(undefined)).toEqual({ label: "評価額" });
    expect(manualValueLabel("self")).toEqual({ label: "評価額" });
    for (const use of ["rentedHouse", "leasedLand", "leasehold", "rentedLeasehold"] as const) {
      expect(manualValueLabel(use).label).toBe("評価額（自分の土地を自分で使っているとした場合）");
      expect(manualValueLabel(use).hint).toContain("その分を引く前の額");
    }
    const h = html(land({ use: "leasehold", method: { type: "manual", value: 10_000_000 } }));
    expect(h).toContain("評価額（自分の土地を自分で使っているとした場合）");
    expect(html(land({ method: { type: "manual", value: 10_000_000 } }))).not.toContain("自分の土地を自分で使っているとした場合");
  });
});

describe("路線価方式の Tips と補正率の欄 ui-15", () => {
  const rosenka = (p: Partial<LandAsset> = {}) =>
    html(land({ method: { type: "rosenka", routePrice: 0, depthCorrection: 1, roads: [{ edge: 0, price: 200_000, depth: 30, frontage: 5 }] }, ...p }));

  it("「この土地に当てはまること」は路線価の欄より上にあるので、Tips も「上の」と書く", () => {
    const h = rosenka();
    expect(h).toContain("上の「この土地に当てはまること」で選んでください");
    expect(h).not.toContain("下の「この土地に当てはまること」");
    // 画面の並びも、当てはまることの選択が路線価の Tips より前
    expect(h.indexOf("この土地に当てはまること</span>")).toBeLessThan(h.indexOf("Tips：計算していないことと補正率の入れ方"));
  });

  it("補正率の欄は畳み、案内は短くし、不整形地補正率・規模格差補正率・1 の入れ方は Tips で説明する", () => {
    const h = rosenka();
    // 税理士に確認したときだけ使う欄なので、まだ入れていなければ閉じておく（見出しは評価の案内と同じ「税理士に確認した補正率」）
    expect(h).toMatch(/<details class="[^"]*"><summary [^>]*>税理士に確認した補正率（任意）<\/summary>/);
    expect(h).toContain("例：0.92（減額なしなら 1。空欄なら補正なしで計算します）");
    expect(h).toContain("下の「税理士に確認した補正率」を開いて入れる");
    expect(h).not.toContain("間口を空欄にしてください");
    expect(h).toContain("最後の不整形地補正率（間口が狭い・奥行が長い分も含めた率）");
    expect(h).toContain("規模格差補正率");
    expect(h).toContain("1 を入れてください");
  });

  it("形がいびつな土地で補正率を入れたときは、1㎡あたりの価額に間口・奥行の補正をしない（評価の計算と同じ）", () => {
    // 普通住宅地区 200,000円・奥行30m（0.95）・間口5m：間口・奥行の補正をすると 160,740円、しなければ 190,000円
    expect(rosenka()).toContain("1㎡あたり 160,740円");
    const h = rosenka({ condition: "irregular", method: { type: "rosenka", routePrice: 0, depthCorrection: 1, otherCorrection: 0.81, roads: [{ edge: 0, price: 200_000, depth: 30, frontage: 5 }] } });
    expect(h).toContain("1㎡あたり 190,000円");
    expect(h).toContain("間口が狭い・奥行が長い補正はせず、税理士に確認した補正率を使います");
    // 補正率をまだ入れていなければ、ふつうどおり
    expect(rosenka({ condition: "irregular" })).toContain("1㎡あたり 160,740円");
  });

  it("形がいびつな土地で補正率 1（減額なし）なら、間口・奥行の補正はふつうどおりする（valuation-1・付表5（注）3）", () => {
    const h = rosenka({ condition: "irregular", method: { type: "rosenka", routePrice: 0, depthCorrection: 1, otherCorrection: 1, roads: [{ edge: 0, price: 200_000, depth: 30, frontage: 5 }] } });
    // 形がいびつと選ばない土地より高くしない
    expect(h).toContain("1㎡あたり 160,740円");
    expect(h).not.toContain("間口が狭い・奥行が長い補正はせず");
    expect(h).toContain("間口が狭い・奥行が長い補正はふつうどおりします");
  });

  it("補正率を入れてある土地（1を超える古い値も）は、補正率の欄を開いておく", () => {
    const open = (otherCorrection: number) =>
      rosenka({ method: { type: "rosenka", routePrice: 0, depthCorrection: 1, otherCorrection, roads: [{ edge: 0, price: 200_000, depth: 30, frontage: 5 }] } });
    expect(open(0.9)).toMatch(/<details class="[^"]*" open=""><summary [^>]*>税理士に確認した補正率（任意）/);
    expect(open(1.2)).toMatch(/<details class="[^"]*" open=""><summary [^>]*>税理士に確認した補正率（任意）/);
    expect(open(1.2)).toContain("以前に入れた値が1を超えているため");
  });

  it("当てはまることの欄は、選ぶと評価の画面に相談の案内が出るので、欄の下に重ねて書かない", () => {
    const h = html(land());
    expect(h).toContain("この土地に当てはまること");
    expect(h).not.toContain("税理士への相談をご案内します");
  });
});

describe("小規模宅地等の特例と遺産の分け方 ui-13", () => {
  const sr = { applies: true, acquirerId: "w", check: { ownHome: "yes" as const, special: "no" as const } };
  const alloc = (shares: { personId: string; numerator: number; denominator: number }[]) => [{ assetId: "L1", shares }];

  it("取得する人の分が分け方で決まっているかを、計算と同じように判定する", () => {
    expect(smallLandDivisionGap(undefined, "L1", "w")).toBeNull();
    expect(smallLandDivisionGap({ allocations: [] }, "L1", undefined)).toBeNull();
    // 分け方をまだ入れていない（未分割でもない）：これから入れる
    expect(smallLandDivisionGap({ allocations: [] }, "L1", "w")).toBeNull();
    // 取得する人が分け方に入っている
    expect(smallLandDivisionGap({ allocations: alloc([{ personId: "w", numerator: 1, denominator: 1 }]) }, "L1", "w")).toBeNull();
    expect(smallLandDivisionGap({ undivided: true, allocations: alloc([{ personId: "w", numerator: 1, denominator: 2 }]) }, "L1", "w")).toBeNull();
    // 未分割で、取得する人の分が決まっていない
    expect(smallLandDivisionGap({ undivided: true, allocations: [] }, "L1", "w")).toBe("undivided");
    expect(smallLandDivisionGap({ undivided: true, allocations: alloc([{ personId: "c", numerator: 1, denominator: 2 }]) }, "L1", "w")).toBe("undivided");
    // 分け方が入っているのに取得する人がいない（未分割でも、全部決まっていれば同じ）
    expect(smallLandDivisionGap({ allocations: alloc([{ personId: "c", numerator: 1, denominator: 1 }]) }, "L1", "w")).toBe("notAcquirer");
    expect(smallLandDivisionGap({ undivided: true, allocations: alloc([{ personId: "c", numerator: 1, denominator: 1 }]) }, "L1", "w")).toBe("notAcquirer");
    // 割合が0の行は、取得していないものとして扱う
    expect(smallLandDivisionGap({ allocations: alloc([{ personId: "w", numerator: 0, denominator: 1 }, { personId: "c", numerator: 1, denominator: 1 }]) }, "L1", "w")).toBe("notAcquirer");
  });

  const box = (division?: Parameters<typeof SmallResidential>[0]["division"]) =>
    renderToStaticMarkup(createElement(SmallResidential, { living, a: land({ smallResidential: sr }), patch: noop, division }));
  const reduce = "330㎡まで評価額を80%減らします。";

  it("分け方が決まっていれば、80%減らして計算すると見せる", () => {
    expect(box()).toContain(reduce);
    expect(box({ allocations: alloc([{ personId: "w", numerator: 1, denominator: 1 }]) })).toContain(reduce);
  });

  it("未分割で取得する人の分が決まっていなければ、特例を使わずに計算すると見せる", () => {
    const h = box({ undivided: true, allocations: [] });
    expect(h).toContain("分け方が決まるまでは、特例を使わずに計算します。");
    expect(h).not.toContain(reduce);
  });

  it("分け方に取得する人が入っていなければ、そう見せる", () => {
    const h = box({ allocations: alloc([{ personId: "c", numerator: 1, denominator: 1 }]) });
    expect(h).toContain("この土地の分け方に、取得する人が入っていません。");
    expect(h).not.toContain(reduce);
  });

  it("土地の画面から分け方を渡す", () => {
    const a = land({ smallResidential: sr });
    expect(html(a, { undivided: true, allocations: [] })).toContain("分け方が決まるまでは、特例を使わずに計算します。");
    expect(html(a, { allocations: [] })).toContain(reduce);
  });

  it("税理士に確認して使うと決めたときは、「特例を使わずに計算しています」と出さない", () => {
    const consult = { applies: false, acquirerId: "c", check: { ownHome: "yes" as const, special: "no" as const, livedTogether: "no" as const } };
    const h0 = renderToStaticMarkup(createElement(SmallResidential, { living, a: land({ smallResidential: consult }), patch: noop }));
    expect(h0).toContain("いまは特例を使わずに（高めに）計算しています。");
    const h1 = renderToStaticMarkup(createElement(SmallResidential, { living, a: land({ smallResidential: { ...consult, check: { ...consult.check, confirmedByAdvisor: true } } }), patch: noop }));
    expect(h1).not.toContain("いまは特例を使わずに（高めに）計算しています。");
  });

  it("税理士に確認して使うと決めたときも、未分割で取得する人の分が決まっていなければ、特例を使わずに計算すると見せる（ui-2）", () => {
    const confirmed = { applies: true, acquirerId: "c", check: { ownHome: "yes" as const, special: "no" as const, livedTogether: "no" as const, confirmedByAdvisor: true } };
    const show = (division?: Parameters<typeof SmallResidential>[0]["division"]) =>
      renderToStaticMarkup(createElement(SmallResidential, { living, a: land({ smallResidential: confirmed }), patch: noop, division }));
    expect(show({ undivided: true, allocations: [] })).toContain("分け方が決まるまでは、特例を使わずに計算します。");
    expect(show({ allocations: alloc([{ personId: "w", numerator: 1, denominator: 1 }]) })).toContain("この土地の分け方に、取得する人が入っていません。");
    const decided = show({ allocations: alloc([{ personId: "c", numerator: 1, denominator: 1 }]) });
    expect(decided).not.toContain("分け方が決まるまでは");
    expect(decided).not.toContain("取得する人が入っていません");
    // 確認していなければ、もともと特例を使わずに計算しているので出さない
    const unconfirmed = renderToStaticMarkup(
      createElement(SmallResidential, { living, a: land({ smallResidential: { ...confirmed, applies: false, check: { ...confirmed.check, confirmedByAdvisor: false } } }), patch: noop, division: { undivided: true, allocations: [] } }),
    );
    expect(unconfirmed).not.toContain("分け方が決まるまでは");
    expect(unconfirmed).toContain("いまは特例を使わずに（高めに）計算しています。");
  });
});

describe("マンションの部屋の小規模宅地等の特例（ui-3）", () => {
  const condo = (check: Record<string, string>): CondoAsset => ({
    id: "C1",
    kind: "condo",
    label: "",
    location: "",
    landValueBeforeCorrection: 0,
    buildingFixedAssetValue: 0,
    builtYearsMonths: { years: 0, months: 0 },
    totalFloors: 0,
    floor: 0,
    landShareSqm: 0,
    exclusiveAreaSqm: 0,
    smallResidential: { applies: false, acquirerId: "c", check },
  });
  const condoText = "自宅でも、事業に使っていた部屋でもないため、特例は使えません。家賃をもらって人に貸している部屋は、「家賃をもらって人に貸している」にチェックを入れてください。";

  it("自宅でも事業用でもない部屋は、部屋の画面のチェックを案内し、土地の使い方は案内しない", () => {
    const h = renderToStaticMarkup(createElement(AssetEditor, { living, asset: condo({ ownHome: "no", business: "no", familyHome: "no" }), patch: noop }));
    expect(h).toContain(condoText);
    expect(h).not.toContain("「土地の使い方」");
    expect(h).not.toContain("人の土地を借りて建てたアパート・貸家を");
  });

  it("土地は、これまでどおり土地の使い方を案内する", () => {
    const h = html(land({ smallResidential: { applies: false, acquirerId: "c", check: { ownHome: "no", business: "no", familyHome: "no" } } }));
    expect(h).toContain("「土地の使い方」で貸している使い方を選んでください");
    expect(h).not.toContain(condoText);
  });
});

describe("FAQ の分け方", () => {
  it("未分割の計算ができることと合っている", () => {
    const a = FAQS.division.find((f) => f.q === "分け方が決まらないときは？")!.a;
    expect(a).not.toContain("未分割の申告は扱っていません");
    expect(a).toContain("法定相続分で受け取ったものとして計算します");
  });
});

describe("共有で受け継いだ土地・面積の一部だけに特例を使う（付表1）", () => {
  const daughter: Person = { id: "d", name: "春子", relation: "child", relationLabel: "長女" };
  const family = [spouse, child, daughter];
  const home = { ownHome: "yes" as const, special: "no" as const };
  const box = (smallResidential: LandAsset["smallResidential"], division?: Parameters<typeof SmallResidential>[0]["division"], people = family) =>
    renderToStaticMarkup(createElement(SmallResidential, { living: people, a: land({ smallResidential }), patch: noop, division }));
  const othersSummary = "何人かで受け継ぐとき";
  const areaSummary = "面積の一部だけに特例を使うとき";

  it("2人目以降の判定には、土地についての答えは最初の人の答え、人ごとの答えはその人の答えを使う", () => {
    const merged = otherAcquirerCheck(
      { ownHome: "yes", special: "no", business: "no", recent: "no", livedTogether: "no", keep: "no", continues: "no", confirmedByAdvisor: true },
      { ownHome: "no", livedTogether: "yes", keep: "yes" },
    );
    expect(merged).toMatchObject({ ownHome: "yes", special: "no", business: "no", recent: "no", livedTogether: "yes", keep: "yes" });
    expect(merged.continues).toBeUndefined();
    expect(merged.confirmedByAdvisor).toBeUndefined();
    expect(otherAcquirerCheck(undefined, undefined)).toEqual({ ownHome: undefined, special: undefined, business: undefined, recent: undefined });
  });

  it("取得する人の追加・選択・答え・税理士への確認・外す", () => {
    let sr: NonNullable<LandAsset["smallResidential"]> = { applies: true, acquirerId: "w", check: home };
    sr = addOtherAcquirer(sr);
    expect(sr.others).toEqual([{ acquirerId: "" }]);
    sr = setOtherAcquirerPerson(sr, 0, "c");
    expect(sr.others).toEqual([{ acquirerId: "c" }]);
    sr = answerOtherAcquirer(sr, 0, "livedTogether", "yes");
    sr = answerOtherAcquirer(sr, 0, "keep", "yes");
    expect(sr.others).toEqual([{ acquirerId: "c", check: { livedTogether: "yes", keep: "yes", confirmedByAdvisor: false } }]);
    // 最初の人の答えは変えない
    expect(sr.check).toEqual(home);
    sr = confirmOtherAcquirer(sr, 0, true);
    expect(sr.others![0].check!.confirmedByAdvisor).toBe(true);
    // 答え直すと、税理士への確認は外れる
    expect(answerOtherAcquirer(sr, 0, "keep", "no").others![0].check).toEqual({ livedTogether: "yes", keep: "no", confirmedByAdvisor: false });
    // 人を選び直すと、前の人の答えと面積は引き継がない
    expect(setOtherAcquirerPerson(setSelectedSqm(sr, 0, 40), 0, "d").others).toEqual([{ acquirerId: "d" }]);
    sr = addOtherAcquirer(setOtherAcquirerPerson(sr, 0, "c"));
    sr = setOtherAcquirerPerson(sr, 1, "d");
    expect(removeOtherAcquirer(sr, 0).others).toEqual([{ acquirerId: "d" }]);
    expect(removeOtherAcquirer(removeOtherAcquirer(sr, 0), 0).others).toBeUndefined();
  });

  it("3年以内に始めたか（土地についての答え）は、一緒に取得する人の欄で答えても最初の人の check に入る", () => {
    const sr = { applies: false, acquirerId: "w", check: { continues: "no" as const }, others: [{ acquirerId: "c", check: { continues: "yes" as const, keep: "yes" as const, confirmedByAdvisor: true } }] };
    const next = answerOtherAcquirer(sr, 0, "recent", "no");
    expect(next.check).toEqual({ continues: "no", recent: "no" });
    expect(next.others![0].check).toEqual({ continues: "yes", keep: "yes", confirmedByAdvisor: false });
  });

  it("特例を使う面積は、最初の人と一緒に取得する人に分けて入れる（空欄は undefined）", () => {
    const sr = { applies: true, acquirerId: "w", check: home, others: [{ acquirerId: "c" }] };
    expect(setSelectedSqm(sr, null, 100).selectedSqm).toBe(100);
    expect(setSelectedSqm(sr, 0, 50).others).toEqual([{ acquirerId: "c", selectedSqm: 50 }]);
    expect(setSelectedSqm({ ...sr, selectedSqm: 100 }, null, undefined).selectedSqm).toBeUndefined();
  });

  it("最初の取得者を変えると、前の人の答えと面積は引き継がず、その人が一緒に取得する人にいれば外す", () => {
    const sr = {
      applies: true,
      acquirerId: "w",
      selectedSqm: 80,
      check: { ...home, livedTogether: "yes" as const, keep: "yes" as const, confirmedByAdvisor: true },
      others: [{ acquirerId: "c", check: { livedTogether: "yes" as const } }, { acquirerId: "d" }],
    };
    expect(firstAcquirerChange(sr, "c")).toEqual({ acquirerId: "c", check: { ...home, business: undefined, recent: undefined }, selectedSqm: undefined, others: [{ acquirerId: "d" }] });
    expect(firstAcquirerChange({ ...sr, others: [{ acquirerId: "c" }] }, "c").others).toBeUndefined();
  });

  it("最初の人の欄で自宅か・事業用かを答え直すと、一緒に取得する人の答えも消す（人と面積は残す）", () => {
    const others = [{ acquirerId: "c", selectedSqm: 30, check: { livedTogether: "yes" as const, keep: "yes" as const, confirmedByAdvisor: true } }];
    expect(othersAfterLotAnswer(others, "ownHome", home, "no")).toEqual([{ acquirerId: "c", selectedSqm: 30 }]);
    expect(othersAfterLotAnswer(others, "business", { ownHome: "no", business: "yes" }, "no")).toEqual([{ acquirerId: "c", selectedSqm: 30 }]);
    // 事情・3年以内かを変えたときは、税理士への確認だけ外す
    expect(othersAfterLotAnswer(others, "special", home, "yes")![0].check).toEqual({ livedTogether: "yes", keep: "yes", confirmedByAdvisor: false });
    // 同じ答え・人ごとの答えなら変えない
    expect(othersAfterLotAnswer(others, "ownHome", home, "yes")).toBe(others);
    expect(othersAfterLotAnswer(others, "keep", home, "no")).toBe(others);
    expect(othersAfterLotAnswer(undefined, "ownHome", home, "no")).toBeUndefined();
  });

  it("土地の使い方を変えて特例の種類が変わると、一緒に取得する人の答えも引き継がない", () => {
    const a = land({ smallResidential: { applies: true, acquirerId: "w", check: home, others: [{ acquirerId: "c", selectedSqm: 20, check: { livedTogether: "yes" } }] } });
    expect(landUsePatch(a, "rentedHouse").smallResidential).toEqual({ applies: false, acquirerId: "w", check: undefined, others: [{ acquirerId: "c", selectedSqm: 20 }] });
  });

  it("一緒に取得する人には、人ごとの質問だけを、最初の人の欄と同じ文で聞く", () => {
    expect(otherAcquirerQuestions("residence", home, {}, spouse, "この土地")).toEqual([]);
    expect(otherAcquirerQuestions("residence", home, {}, undefined, "この土地")).toEqual([]);
    expect(otherAcquirerQuestions("rental", {}, {}, { id: "o", name: "知人", relation: "other" }, "この土地")).toEqual([]);
    expect(otherAcquirerQuestions("residence", { ownHome: "yes" }, {}, child, "この土地")).toEqual([]);
    expect(otherAcquirerQuestions("residence", home, {}, child, "この土地").map((q) => q.q)).toEqual(["一郎さんは、亡くなる直前まで亡くなった方と同じ家に住んでいましたか？"]);
    expect(otherAcquirerQuestions("residence", home, { livedTogether: "yes" }, child, "この土地").map((q) => q.key)).toEqual(["livedTogether", "keep"]);
    // 貸付事業用：最初の人の欄で3年以内かを聞いていれば聞かない。聞いていなければ（最初の人が貸付をやめる）この人の欄で聞く
    const go = { continues: "yes" as const, keep: "yes" as const };
    expect(otherAcquirerQuestions("rental", { continues: "yes", keep: "yes" }, go, child, "この土地").map((q) => q.key)).toEqual(["continues", "keep"]);
    expect(otherAcquirerQuestions("rental", { continues: "no" }, go, child, "この土地").map((q) => q.key)).toEqual(["continues", "keep", "recent"]);
    expect(otherAcquirerQuestions("rental", { continues: "no" }, go, child, "この土地", false).map((q) => q.key)).toEqual(["continues", "keep"]);
    expect(otherAcquirerQuestions("rental", {}, {}, child, "この土地")[0].q).toBe("一郎さんは、申告期限まで貸し続けますか？");
    expect(otherAcquirerQuestions("business", { ownHome: "no", business: "yes" }, {}, child, "この土地")[0].q).toBe(
      "一郎さんは、申告期限までにその事業を引き継ぎ、続けますか？",
    );
    // 3年以内かを聞くのは、聞く必要のある人のうち、はじめの1人の欄だけ
    const others = [{ acquirerId: "c", check: { continues: "yes" as const } }, { acquirerId: "d", check: go }, { acquirerId: "x", check: go }];
    expect(recentAskedAt("rental", { continues: "no" }, others)).toBe(1);
    expect(recentAskedAt("rental", { continues: "yes", keep: "yes" }, others)).toBe(-1);
    expect(recentAskedAt("residence", {}, others)).toBe(-1);
  });

  it("2つの入力は、最初の取得者を選んだあと、閉じた Tips の中に出す", () => {
    expect(box({ applies: false, check: home })).not.toContain(othersSummary);
    const h = box({ applies: true, acquirerId: "w", check: home });
    expect(h).toContain(othersSummary);
    expect(h).toContain(areaSummary);
    expect(h).not.toMatch(/<details[^>]*open/);
    expect(h).toContain("＋ 取得する人を追加");
    expect(h).toContain("空欄なら、使える面積をすべて使います。");
    expect(h).toContain("特例を使う面積（㎡）");
    // 自宅でも、事業用でも、家族が住んでいた土地でもない土地は、だれが取得しても使えないので出さない
    expect(box({ applies: false, acquirerId: "w", check: { ownHome: "no", business: "no", familyHome: "no" } })).not.toContain(othersSummary);
  });

  it("一緒に取得する人ごとに、最初の人と同じ判定の文を出す", () => {
    const ok = box({ applies: true, acquirerId: "w", check: home, others: [{ acquirerId: "c", check: { livedTogether: "yes", keep: "yes" } }] });
    expect(ok).toContain(`${othersSummary}（1人）`);
    expect(ok).toContain("配偶者が取得するので使えます。");
    expect(ok).toContain("同居していた親族が取得し、申告期限まで住み続け・持ち続けるので特例を使えます。");
    expect(ok).toContain("一郎さんは、亡くなる直前まで亡くなった方と同じ家に住んでいましたか？");
    expect(ok).toContain('aria-label="この人を外す"');
    const no = box({ applies: true, acquirerId: "w", check: home, others: [{ acquirerId: "c", check: { livedTogether: "yes", keep: "no" } }] });
    expect(no).toContain("申告期限までに売る・引っ越す場合は、同居していた親族でも特例は使えません。");
    const consult = box({ applies: true, acquirerId: "w", check: home, others: [{ acquirerId: "c", check: { livedTogether: "no" } }] });
    expect(consult).toContain("いわゆる「家なき子」");
    expect(consult).toContain("税理士に確認し、特例を使えることが分かった");
    // 分け方に入っていなければ、そう出す
    const gap = box({ applies: true, acquirerId: "w", check: home, others: [{ acquirerId: "c", check: { livedTogether: "yes", keep: "yes" } }] }, { allocations: [{ assetId: "L1", shares: [{ personId: "w", numerator: 1, denominator: 1 }] }] });
    expect(gap).toContain("この土地の分け方に、この人が入っていません。");
  });

  it("選べる人がいなくなったら、追加のボタンを出さない。最初の人と、ほかで選んだ人は選択肢に出さない", () => {
    const full = box({ applies: true, acquirerId: "w", check: home, others: [{ acquirerId: "c" }, { acquirerId: "d" }] });
    expect(full).not.toContain("＋ 取得する人を追加");
    // 人を選んでいない行があるうちも出さない
    expect(box({ applies: true, acquirerId: "w", check: home, others: [{ acquirerId: "" }] })).not.toContain("＋ 取得する人を追加");
    const one = box({ applies: true, acquirerId: "w", check: home, others: [{ acquirerId: "c" }] });
    const selects = one.match(/<select[\s\S]*?<\/select>/g)!;
    // 2つ目の選択（一緒に取得する人）には、花子（最初の人）が出ない
    expect(selects[1]).not.toContain("花子");
    expect(selects[1]).toContain("一郎");
    expect(selects[1]).toContain("春子");
  });

  it("一緒に取得する人がいるときは、面積の欄を人ごとに出し、分け方で受け継いだ面積を添える", () => {
    const sr = { applies: true, acquirerId: "w", check: home, selectedSqm: 60, others: [{ acquirerId: "c", check: { livedTogether: "yes" as const, keep: "yes" as const } }] };
    const h = box(sr, { allocations: [{ assetId: "L1", shares: [{ personId: "w", numerator: 1, denominator: 2 }, { personId: "c", numerator: 1, denominator: 2 }] }] });
    expect(h).toContain(`${areaSummary}（入力あり）`);
    expect(h).toContain("花子さん：特例を使う面積（㎡）");
    expect(h).toContain("一郎さん：特例を使う面積（㎡）");
    expect(h).toContain("特例の対象になる面積は75㎡です");
    expect(h).toContain('value="60"');
  });

  it("特例の対象になる面積は、付表1の③と同じく、分け方の割合から 0.01㎡未満を四捨五入して出す", () => {
    const a = land({ areaSqm: 100 });
    const division = { allocations: [{ assetId: "L1", shares: [{ personId: "w", numerator: 1, denominator: 3 }, { personId: "c", numerator: 2, denominator: 3 }] }] };
    expect(acquiredSqm(a, division, "w")).toBe(33.33);
    expect(acquiredSqm(a, division, "c")).toBe(66.67);
    expect(acquiredSqm(a, division, "d")).toBeUndefined();
    expect(acquiredSqm(a, undefined, "w")).toBeUndefined();
    expect(acquiredSqm(land({ areaSqm: 0 }), division, "w")).toBeUndefined();
  });

  it("マンションの部屋でも同じ入力を出す（敷地権の面積から受け継いだ面積を出す）", () => {
    const condo: CondoAsset = {
      id: "C1",
      kind: "condo",
      label: "",
      location: "",
      landValueBeforeCorrection: 0,
      buildingFixedAssetValue: 0,
      builtYearsMonths: { years: 0, months: 0 },
      totalFloors: 0,
      floor: 0,
      landShareSqm: 40,
      exclusiveAreaSqm: 70,
      smallResidential: { applies: true, acquirerId: "w", check: home, others: [{ acquirerId: "c", check: { livedTogether: "yes", keep: "yes" } }] },
    };
    const h = renderToStaticMarkup(createElement(AssetEditor, { living: family, asset: condo, patch: noop, division: { allocations: [{ assetId: "C1", shares: [{ personId: "c", numerator: 1, denominator: 4 }] }] } }));
    expect(h).toContain("何人かで受け継ぐとき（1人）");
    expect(h).toContain("特例の対象になる面積は10㎡です");
  });

  it("空き部屋のある貸家では、特例の対象になる面積は貸している部分だけ（付表1の③と同じ）", () => {
    const a = land({ areaSqm: 200, use: "rentedHouse", rentRatio: 0.5 });
    const division = { allocations: [{ assetId: "L1", shares: [{ personId: "w", numerator: 1, denominator: 2 }, { personId: "c", numerator: 1, denominator: 2 }] }] };
    expect(acquiredSqm(a, division, "w")).toBe(50);
    // 全部貸していれば持分どおり
    expect(acquiredSqm(land({ areaSqm: 200, use: "rentedHouse", rentRatio: 1 }), division, "w")).toBe(100);
  });

  it("最初の取得者を空にしても、一緒に取得する人が残っていれば、その人の欄を出したままにする（外せるように）", () => {
    const h = box({ applies: true, acquirerId: "", check: home, others: [{ acquirerId: "c", check: { livedTogether: "yes", keep: "yes" } }] });
    expect(h).toContain(`${othersSummary}（1人）`);
    expect(h).toContain('aria-label="この人を外す"');
    expect(h).toContain(areaSummary);
    // だれも選んでいなければ出さない
    expect(box({ applies: false, acquirerId: "", check: home })).not.toContain(othersSummary);
  });

  it("面積の一部の欄は、特例を使える人の分だけ出す（使えない人しかいなければ出さない）", () => {
    // 一郎さんは申告期限までに売るので使えない：面積の欄は花子さんの分だけ
    const h = box({ applies: true, acquirerId: "w", check: home, others: [{ acquirerId: "c", check: { livedTogether: "yes", keep: "no" } }] });
    expect(h).toContain(areaSummary);
    expect(h).not.toContain("一郎さん：特例を使う面積（㎡）");
    expect(h).not.toContain("花子さん：特例を使う面積（㎡）");
    expect(h).toContain("特例を使う面積（㎡）");
    // 子が取得して申告期限までに売る：だれも使えないので出さない
    expect(box({ applies: false, acquirerId: "c", check: { ...home, livedTogether: "yes", keep: "no" } })).not.toContain(areaSummary);
  });

  it("ほかに受け継ぐ人がいない（相続人が1人）ときは、何人かで受け継ぐときの欄を出さない", () => {
    const h = box({ applies: true, acquirerId: "w", check: home }, undefined, [spouse]);
    expect(h).not.toContain(othersSummary);
    expect(h).toContain(areaSummary);
  });

  it("FAQ に共有の土地と面積の一部の説明がある", () => {
    const a = FAQS.assets.find((f) => f.q === "共有・一部の面積の特例は？")!.a;
    expect(a).toContain("受け継いだ人ごとに判断");
    expect(a).toContain("配偶者はそのまま使えます");
    expect(a).toContain("貸し続け、持ち続ける");
    expect(a).toContain("付表1");
  });
});

describe("スマートフォンの表示：面している道路の行（case-9）", () => {
  it("道路の位置と路線価は、スマートフォンでは1行ずつ使い（路線価の数字が欠けないように）、奥行と間口は横に並べる", () => {
    const h = html(land({ method: { type: "rosenka", routePrice: 420_000, depthCorrection: 1, roads: [{ edge: 0, price: 420_000, depth: 13 }] } }));
    const row = h.slice(h.indexOf("sm:grid-cols-[7rem_1fr_6rem_6rem_auto]"));
    const wide = '<div class="col-span-2 sm:col-span-1">';
    expect(row.indexOf(wide)).toBeLessThan(row.indexOf("道路の位置"));
    expect(row.indexOf(wide, row.indexOf("道路の位置"))).toBeLessThan(row.indexOf("路線価（正面）"));
    // 奥行・間口は囲まない（2列の格子に1つずつ入る）
    expect(row.slice(row.indexOf("路線価（正面）"), row.indexOf("間口")).split(wide).length).toBe(1);
  });
});

describe("生計を一にしていた家族が無料で住んでいた土地（措置法69条の4第3項2号）", () => {
  const daughter: Person = { id: "d", name: "春子", relation: "child", relationLabel: "長女" };
  const family = [spouse, child, daughter];
  const notHome = { ownHome: "no" as const, business: "no" as const };
  const famYes = { ...notHome, familyHome: "yes" as const };
  const familyQ = "亡くなった方と同じ家計の家族（生計を一にしていた親族）が、無料で住んでいた土地ですか？";
  const condoQ = "亡くなった方と同じ家計の家族（生計を一にしていた親族）が、無料で住んでいた部屋ですか？";
  const keepQ = "取得する人はその家族本人で、申告期限まで住み続け、持ち続けますか？";
  const confirm = "税理士に確認し、特例を使えることが分かった";
  const othersSummary = "何人かで受け継ぐとき";
  const box = (smallResidential: LandAsset["smallResidential"], a: Partial<LandAsset> = {}) =>
    renderToStaticMarkup(createElement(SmallResidential, { living: family, a: land({ smallResidential, ...a }), patch: noop }));
  const count = (h: string, text: string) => h.split(text).length - 1;

  it("家族が住んでいた土地かは、自宅でも事業用でもないと答えたときだけ聞く", () => {
    const at = (check: Parameters<typeof otherAcquirerCheck>[0]) => box({ applies: false, acquirerId: "c", check });
    expect(at({})).not.toContain(familyQ);
    expect(at({ ownHome: "yes", special: "no" })).not.toContain(familyQ);
    expect(at({ ownHome: "unsure" })).not.toContain(familyQ);
    expect(at({ ownHome: "no" })).not.toContain(familyQ);
    expect(at({ ownHome: "no", business: "yes" })).not.toContain(familyQ);
    expect(at({ ownHome: "no", business: "unsure" })).not.toContain(familyQ);
    expect(at(notHome)).toContain(familyQ);
    // 人に貸している土地（貸付事業用）では聞かない
    expect(box({ applies: false, acquirerId: "c", check: notHome }, { use: "rentedHouse" })).not.toContain(familyQ);
  });

  it("マンションでは「部屋」と聞く", () => {
    const condo: CondoAsset = {
      id: "C1",
      kind: "condo",
      label: "",
      location: "",
      landValueBeforeCorrection: 0,
      buildingFixedAssetValue: 0,
      builtYearsMonths: { years: 0, months: 0 },
      totalFloors: 0,
      floor: 0,
      landShareSqm: 0,
      exclusiveAreaSqm: 0,
      smallResidential: { applies: false, acquirerId: "c", check: notHome },
    };
    const h = renderToStaticMarkup(createElement(AssetEditor, { living, asset: condo, patch: noop }));
    expect(h).toContain(condoQ);
    expect(h).not.toContain(familyQ);
  });

  it("「はい」なら、配偶者以外の取得者にだけ、その家族本人で住み続け・持ち続けるかを聞く", () => {
    expect(box({ applies: false, acquirerId: "c", check: famYes })).toContain(keepQ);
    expect(box({ applies: false, acquirerId: "w", check: famYes })).not.toContain(keepQ);
    expect(box({ applies: false, check: famYes })).not.toContain(keepQ);
    expect(box({ applies: false, acquirerId: "c", check: { ...notHome, familyHome: "no" } })).not.toContain(keepQ);
    expect(box({ applies: false, acquirerId: "c", check: { ...notHome, familyHome: "unsure" } })).not.toContain(keepQ);
    // 自宅の敷地の「住み続け、持ち続けますか」とは別の文
    expect(box({ applies: false, acquirerId: "c", check: { ownHome: "yes", special: "no", livedTogether: "yes" } })).not.toContain(keepQ);
  });

  it("税理士への相談になるときは、確認のチェックを出す。使えないときは出さない", () => {
    const consult = [
      { acquirerId: "c", check: { ...notHome, familyHome: "unsure" as const } },
      { acquirerId: "w", check: famYes },
      { acquirerId: "c", check: { ...famYes, keep: "unsure" as const } },
      { acquirerId: "c", check: { ...famYes, keep: "yes" as const } },
    ];
    for (const sr of consult) {
      const h = box({ applies: false, ...sr });
      expect(h).toContain(confirm);
      expect(h).toContain("いまは特例を使わずに（高めに）計算しています。");
    }
    expect(box({ applies: false, acquirerId: "c", check: { ...famYes, keep: "yes" } })).toContain("生計を一にしていた（同じ家計だった）かは判断が難しい");
    expect(box({ applies: false, acquirerId: "w", check: famYes })).toContain("配偶者が取得すれば使えますが");
    // 確認したら「特例を使わずに計算しています」は出さない
    expect(box({ applies: true, acquirerId: "c", check: { ...famYes, keep: "yes", confirmedByAdvisor: true } })).not.toContain("いまは特例を使わずに（高めに）計算しています。");
    for (const check of [{ ...notHome, familyHome: "no" as const }, { ...famYes, keep: "no" as const }, famYes]) {
      expect(box({ applies: false, acquirerId: "c", check })).not.toContain(confirm);
    }
    expect(box({ applies: false, acquirerId: "c", check: { ...famYes, keep: "no" } })).toContain("住んでいた家族本人が取得し、申告期限まで住み続け・持ち続ける場合だけ特例を使えます。");
  });

  it("一緒に取得する人にも、配偶者でなければ同じことを聞き、相談になれば確認のチェックを出す", () => {
    expect(otherAcquirerQuestions("residence", famYes, {}, child, "この土地").map((q) => q.q)).toEqual(["一郎さんはその家族本人で、申告期限まで住み続け、持ち続けますか？"]);
    expect(otherAcquirerQuestions("residence", famYes, {}, child, "この土地").map((q) => q.key)).toEqual(["keep"]);
    expect(otherAcquirerQuestions("residence", famYes, {}, { ...child, name: "" }, "この土地")[0].q).toBe(keepQ);
    expect(otherAcquirerQuestions("residence", famYes, {}, spouse, "この土地")).toEqual([]);
    expect(otherAcquirerQuestions("residence", { ...notHome, familyHome: "no" }, {}, child, "この土地")).toEqual([]);
    expect(otherAcquirerQuestions("residence", { ...notHome, familyHome: "unsure" }, {}, child, "この土地")).toEqual([]);
    expect(otherAcquirerQuestions("residence", notHome, {}, child, "この土地")).toEqual([]);
    expect(otherAcquirerQuestions("residence", { ownHome: "no", business: "unsure" }, {}, child, "この土地")).toEqual([]);
    // 2人目の判定には、土地についての答え（家族が住んでいたか）は最初の人の答えを使う
    expect(otherAcquirerCheck({ ...famYes, keep: "no", confirmedByAdvisor: true }, { keep: "yes" })).toMatchObject({ ...famYes, keep: "yes" });
    // 妻（相談）と一郎さん（住み続ける：相談）。どちらにも確認のチェックを出す
    const two = box({ applies: false, acquirerId: "w", check: famYes, others: [{ acquirerId: "c", check: { keep: "yes" } }] });
    expect(two).toContain(`${othersSummary}（1人）`);
    expect(two).toContain("一郎さんはその家族本人で、申告期限まで住み続け、持ち続けますか？");
    expect(count(two, confirm)).toBe(2);
    // 一郎さんが住み続けない：一郎さんの分は使えないので、チェックは妻の分だけ
    const no = box({ applies: false, acquirerId: "w", check: famYes, others: [{ acquirerId: "c", check: { keep: "no" } }] });
    expect(count(no, confirm)).toBe(1);
    expect(no).toContain("住んでいた家族本人が取得し、申告期限まで住み続け・持ち続ける場合だけ特例を使えます。");
  });

  it("何人かで受け継ぐときの欄は、家族が住んでいた土地でないと決まったときだけ出さない", () => {
    expect(box({ applies: false, acquirerId: "w", check: notHome })).toContain(othersSummary);
    expect(box({ applies: false, acquirerId: "w", check: famYes })).toContain(othersSummary);
    expect(box({ applies: false, acquirerId: "w", check: { ...notHome, familyHome: "unsure" } })).toContain(othersSummary);
    expect(box({ applies: false, acquirerId: "w", check: { ...notHome, familyHome: "no" } })).not.toContain(othersSummary);
  });

  it("家族が住んでいたかを答え直すと、その先の答えと税理士への確認を引き継がない（土地についてのほかの答えは残す）", () => {
    const others = [{ acquirerId: "c", selectedSqm: 30, check: { keep: "yes" as const, confirmedByAdvisor: true } }];
    const sr = { applies: true, acquirerId: "d", check: { ...famYes, keep: "yes" as const, confirmedByAdvisor: true }, others };
    // 答えを変えると、最初の人の「住み続けるか」と確認を消し、一緒に取得する人の答えも消す（人と面積は残す）
    expect(answerFirstAcquirer(sr, "familyHome", "no")).toEqual({ check: { ...notHome, familyHome: "no", confirmedByAdvisor: false }, others: [{ acquirerId: "c", selectedSqm: 30 }] });
    expect(answerFirstAcquirer(sr, "familyHome", "unsure").check).toEqual({ ...notHome, familyHome: "unsure", confirmedByAdvisor: false });
    // 同じ答えなら、その先の答えと一緒に取得する人の答えは残す（確認は外す）
    const same = answerFirstAcquirer(sr, "familyHome", "yes");
    expect(same.check).toEqual({ ...famYes, keep: "yes", confirmedByAdvisor: false });
    expect(same.others).toBe(others);
    // 住み続けるか（人ごとの答え）を答え直しても、土地についての答えと一緒に取得する人の答えは残す
    const keep = answerFirstAcquirer(sr, "keep", "unsure");
    expect(keep.check).toEqual({ ...famYes, keep: "unsure", confirmedByAdvisor: false });
    expect(keep.others).toBe(others);
    // 自宅か・事業用かを答え直すと、家族が住んでいたかの答えも消す
    expect(answerFirstAcquirer(sr, "business", "yes")).toEqual({ check: { ownHome: "no", business: "yes", confirmedByAdvisor: false }, others: [{ acquirerId: "c", selectedSqm: 30 }] });
    expect(answerFirstAcquirer(sr, "ownHome", "yes").check).toEqual({ ownHome: "yes", confirmedByAdvisor: false });
    // これまでの答え直しも同じ
    expect(answerFirstAcquirer({ applies: false, check: { ownHome: "yes", special: "no", livedTogether: "yes" } }, "ownHome", "no")).toEqual({ check: { ownHome: "no", confirmedByAdvisor: false }, others: undefined });
    expect(answerFirstAcquirer({ applies: false, check: { ownHome: "no", business: "yes", continues: "yes" } }, "business", "no").check).toEqual({ ...notHome, confirmedByAdvisor: false });
  });

  it("家族が住んでいたかは土地についての答え：取得する人を変えても残し、一緒に取得する人の答えは消す", () => {
    const others = [{ acquirerId: "c", selectedSqm: 30, check: { keep: "yes" as const, confirmedByAdvisor: true } }];
    expect(othersAfterLotAnswer(others, "familyHome", famYes, "no")).toEqual([{ acquirerId: "c", selectedSqm: 30 }]);
    expect(othersAfterLotAnswer(others, "familyHome", famYes, "yes")).toBe(others);
    // 一緒に取得する人の欄から答えても、最初の人の check に入る
    const sr = { applies: false, acquirerId: "w", check: famYes, others };
    const next = answerOtherAcquirer(sr, 0, "familyHome", "unsure");
    expect(next.check).toEqual({ ...notHome, familyHome: "unsure" });
    expect(next.others).toEqual([{ acquirerId: "c", selectedSqm: 30 }]);
    // 「住み続けるか」はその人の答え
    expect(answerOtherAcquirer(sr, 0, "keep", "no").others).toEqual([{ acquirerId: "c", selectedSqm: 30, check: { keep: "no", confirmedByAdvisor: false } }]);
    expect(answerOtherAcquirer(sr, 0, "keep", "no").check).toBe(famYes);
    // 最初の取得者を変えると、家族が住んでいたかは残し、前の人の答えと確認は引き継がない
    const changed = firstAcquirerChange({ ...sr, acquirerId: "d", check: { ...famYes, keep: "yes", confirmedByAdvisor: true } }, "c");
    expect(changed.check).toEqual({ ...famYes, special: undefined, recent: undefined });
    expect(changed.others).toBeUndefined();
  });
});
