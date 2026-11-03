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
  landUsePatch,
  manualValueLabel,
  rentRatioLooksTooSmall,
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
    expect(h).toContain("家族に無料（固定資産税くらいの負担だけ）で貸しているときは「自分で使っている」を選びます");
    expect(h).toContain("Tips：土地の使い方の選び方");
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
      expect(h).toContain("家族に無料（固定資産税くらいの負担だけ）で貸しているときは、チェックしません。");
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
    expect(h).toContain("一時的に空いている部屋も、貸しているものとして数えます");
    expect(h).toContain("廊下・階段などは床面積に入れません");
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

  it("補正率の欄の案内は短くし、不整形地補正率・規模格差補正率・1 の入れ方は Tips で説明する", () => {
    const h = rosenka();
    expect(h).toContain("税理士に確認したときだけ入れます（例：0.92。減額なしなら 1）。空欄なら補正なしで計算します");
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

  it("当てはまることの案内は、配偶者居住権でも合うように「評価が変わる」と書く", () => {
    expect(html(land())).toContain("当てはまるときは評価が変わるため、税理士への相談をご案内します");
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
  const reduce = "330㎡までの部分の評価額を80%減らして計算します";

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
  const condoText =
    "自宅でも、事業に使っていた部屋でもないため、特例は使えません。家賃をもらって人に貸している部屋は、「家賃をもらって人に貸している」にチェックを入れてください。家族が無料で住んでいた部屋は、使える場合があるので税理士にご相談ください。";

  it("自宅でも事業用でもない部屋は、部屋の画面のチェックを案内し、土地の使い方は案内しない", () => {
    const h = renderToStaticMarkup(createElement(AssetEditor, { living, asset: condo({ ownHome: "no", business: "no" }), patch: noop }));
    expect(h).toContain(condoText);
    expect(h).not.toContain("「土地の使い方」");
    expect(h).not.toContain("人の土地を借りて建てたアパート・貸家を");
  });

  it("土地は、これまでどおり土地の使い方を案内する", () => {
    const h = html(land({ smallResidential: { applies: false, acquirerId: "c", check: { ownHome: "no", business: "no" } } }));
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
