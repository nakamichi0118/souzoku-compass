/**
 * 1000件のシナリオ（scripts/cases/generate.ts）を、アプリの入力に変換して（toCase.ts）計算エンジンに通し、
 * 法令・通達から独立に計算した正しい答え（oracle.ts）と比べる（run.ts の runAll）。
 *
 * - 例外・NaN・負の税額・円未満の端数（CRASH）と、変換や正しい答えの側の例外（HARNESS_ERROR）が0件であること
 * - アプリが止まらずに違う答えを出す件（WRONG）が、run.ts の WRONG_BUDGET 件以下であること（0 に近づけていく）
 * - 手続きの一覧（期限の日付・相続税の申告の手続き）と、API と同じ入力の確かめに問題がないこと
 *
 * 詳しい報告（どの件がどう違うか）は npx tsx scripts/cases/run.ts で /tmp/claude-0/cases/report.md に作る。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { generateScenarios } from "../../../scripts/cases/generate";
import { type CaseReport, UNREPRESENTABLE_BUDGET, UNSUPPORTED_BUDGET, WRONG_BUDGET, runAll } from "../../../scripts/cases/run";
import type { Scenario } from "../../../scripts/cases/scenario";
import { toCase } from "../../../scripts/cases/toCase";
import { ageAt } from "../tax/engine";
import type { Case, CondoAsset, LandAsset } from "../types";
import { smallLandKind } from "../valuation/smallResidential";

describe("1000件のシナリオ（相続税の計算と正しい答えの比較）", () => {
  let reports: CaseReport[] = [];

  beforeAll(() => {
    reports = runAll(generateScenarios(1000)).reports;
  }, 60_000);

  it("1000件すべてを処理した", () => {
    expect(reports).toHaveLength(1000);
  });

  it("落ちる件がない（CRASH・HARNESS_ERROR が0件）", () => {
    const bad = reports.filter((r) => r.class === "CRASH" || r.class === "HARNESS_ERROR").map((r) => `${r.id} ${r.class}: ${r.errors.join(" / ")}`);
    expect(bad).toEqual([]);
  });

  it(`黙って違う答えを出す件（WRONG）が上限 ${WRONG_BUDGET} 件以下`, () => {
    const wrong = reports.filter((r) => r.class === "WRONG");
    const list = wrong.slice(0, 20).map((r) => `${r.id}(${r.wrongKind})`).join(", ");
    expect(wrong.length, `WRONG ${wrong.length}件：${list}`).toBeLessThanOrEqual(WRONG_BUDGET);
  });

  it(`正しく計算できるのに止まる件（BLOCKED_UNSUPPORTED）が上限 ${UNSUPPORTED_BUDGET} 件以下、入力のしかたがない件（UNREPRESENTABLE）が上限 ${UNREPRESENTABLE_BUDGET} 件以下`, () => {
    const unsupported = reports.filter((r) => r.class === "BLOCKED_UNSUPPORTED").map((r) => `${r.id}: ${r.blockers[0] ?? ""}`);
    const unrep = reports.filter((r) => r.class === "UNREPRESENTABLE").map((r) => `${r.id}: ${r.unrepresentable.join("・")}`);
    expect(unsupported.length, unsupported.slice(0, 10).join("\n")).toBeLessThanOrEqual(UNSUPPORTED_BUDGET);
    expect(unrep.length, unrep.slice(0, 10).join("\n")).toBeLessThanOrEqual(UNREPRESENTABLE_BUDGET);
  });

  it("WRONG（近似）・UNREPRESENTABLE の件は、近似・入力できない事柄を取り除くと正しい答えと一致する（ほかの誤りが隠れていない）", () => {
    const hidden = reports.filter((r) => r.residual && !r.residual.explained).map((r) => `${r.id} ${r.class}→${r.residual!.class}`);
    expect(hidden).toEqual([]);
  });

  it("手続きの一覧と入力の形に問題がない", () => {
    const bad = reports.filter((r) => r.docErrors.length).map((r) => `${r.id}: ${r.docErrors.join(" / ")}`);
    expect(bad).toEqual([]);
  });
});

/**
 * シナリオ → アプリの入力（toCase.ts）の写し方。画面にある入力欄は、ふつうの人が入れるとおりに入れているか
 */
describe("シナリオをアプリの入力に写す（toCase）", () => {
  let pairs: { s: Scenario; c: Case }[] = [];

  beforeAll(() => {
    pairs = generateScenarios(1000).map((s) => ({ s, c: toCase(s).case! }));
  }, 60_000);

  const lands = (c: Case) => new Map(c.assets.filter((a): a is LandAsset => a.kind === "land").map((a) => [a.id, a]));

  it("すべての土地を入れ、使い方・賃貸割合・借地権割合・土地の事情・道路の間口を写す", () => {
    const bad: string[] = [];
    for (const { s, c } of pairs) {
      const by = lands(c);
      for (const it of s.estate) {
        if (it.type !== "land") continue;
        const a = by.get(it.id);
        if (!a) {
          bad.push(`${s.id} ${it.id} がない`);
          continue;
        }
        // 青空駐車場は「自分で使っている」土地として入れる
        const use = it.use === "parking" ? "self" : it.use;
        if ((a.use ?? "self") !== use) bad.push(`${s.id} ${it.id} 使い方 ${a.use}`);
        if (a.rentRatio !== (use === "rentedHouse" || use === "rentedLeasehold" ? it.rentRatio : undefined)) bad.push(`${s.id} ${it.id} 賃貸割合 ${a.rentRatio}`);
        const lease = it.valuation.kind === "multiplier" && use !== "self" ? it.valuation.leaseRatio : undefined;
        if (a.leaseRatio !== lease) bad.push(`${s.id} ${it.id} 借地権割合 ${a.leaseRatio}`);
        const cond = it.needsReduction === "irregular" || it.needsReduction === "setback" ? it.needsReduction : it.spouseResidenceRight ? "spouseResidence" : undefined;
        if (a.condition !== cond) bad.push(`${s.id} ${it.id} 事情 ${a.condition}`);
        if (it.valuation.kind === "rosenka" && a.method.type === "rosenka") {
          const fr = [...it.valuation.roads.map((r) => r.frontage)].sort((x, y) => x - y);
          const got = (a.method.roads ?? []).map((r) => r.frontage ?? 0).sort((x, y) => x - y);
          if (fr.join(",") !== got.join(",")) bad.push(`${s.id} ${it.id} 間口 ${got.join(",")}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("小規模宅地等の特例の種類は、アプリが使い方と答えから決める種類と一致する（青空駐車場は特例を使わない）", () => {
    const bad: string[] = [];
    for (const { s, c } of pairs) {
      for (const it of s.estate) {
        if ((it.type !== "land" && it.type !== "condo") || !it.smallLand) continue;
        const a = c.assets.find((x) => x.id === it.id) as LandAsset | CondoAsset;
        const sr = a.smallResidential;
        if (sr?.acquirerId !== it.smallLand.acquirer) bad.push(`${s.id} ${it.id} 取得者`);
        // 取得者があとから亡くなった（数次相続）ときは、画面の取得者の一覧にいないので「適用する」にならない（数次相続は止まる）
        const diedAfter = !!s.members.find((m) => m.id === it.smallLand!.acquirer)?.diedAfter;
        if (it.type === "land" && it.use === "parking") {
          if (sr?.applies) bad.push(`${s.id} ${it.id} 青空駐車場に特例`);
        } else if (smallLandKind(a) !== it.smallLand.kind || (!sr?.applies && !diedAfter)) bad.push(`${s.id} ${it.id} 種類 ${smallLandKind(a)} 適用 ${sr?.applies}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("貸家・賃貸中のマンションは「貸している」と賃貸割合・借地権割合を写す", () => {
    const bad: string[] = [];
    for (const { s, c } of pairs) {
      for (const it of s.estate) {
        const a = c.assets.find((x) => x.id === it.id);
        if (it.type === "building" && a?.kind === "building") {
          if (!!a.rented !== !!it.rented || a.rentRatio !== (it.rented ? it.rentRatio : undefined)) bad.push(`${s.id} ${it.id}`);
        }
        if (it.type === "condo" && a?.kind === "condo") {
          const ext = it as typeof it & { leaseRatio?: number; rentRatio?: number };
          if (!!a.rented !== !!it.rented || a.rentRatio !== (it.rented ? ext.rentRatio : undefined) || a.leaseRatio !== (it.rented ? ext.leaseRatio : undefined))
            bad.push(`${s.id} ${it.id}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("未分割は取得者を入れずに「分け方がまだ決まっていない」を選び、債務（葬式費用でないもの）の負担者は入れない（相基通13-3）", () => {
    const bad: string[] = [];
    let n = 0;
    for (const { s, c } of pairs) {
      if (s.division.kind !== "undivided") {
        // 一部だけ決まっている（partlyUndivided）ときは、決まった分だけ入れて「分け方がまだ決まっていない」を選ぶ
        if (!!c.undivided !== !!s.division.partlyUndivided) bad.push(`${s.id} 未分割の選び方`);
        continue;
      }
      n++;
      if (!c.undivided || c.allocations.length) bad.push(`${s.id} 未分割の入れ方`);
      for (const d of c.debts) if (d.kind === "debt" && d.bearers.length) bad.push(`${s.id} ${d.id} 債務の負担者`);
      for (const d of c.debts) if (d.kind === "funeral" && d.bearers.length !== s.debts.find((x) => x.id === d.id)!.bearers.length) bad.push(`${s.id} ${d.id} 葬式費用の負担者`);
    }
    expect(n).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it("代償金・相続時精算課税の贈与・相次相続控除の前の相続を写す", () => {
    const bad: string[] = [];
    for (const { s, c } of pairs) {
      const comp = s.division.kind === "agreed" ? (s.division.compensation ?? []) : [];
      const got = c.compensation ?? [];
      if (comp.length !== got.length || comp.some((x, i) => got[i].fromId !== x.from || got[i].toId !== x.to || got[i].amount !== x.amount || got[i].basis?.assetId !== x.basis?.item || got[i].basis?.marketValue !== x.basis?.marketValue)) bad.push(`${s.id} 代償金`);
      const settle = s.gifts.filter((g) => g.settlement).length;
      if (c.priorGifts.filter((g) => g.settlement).length !== settle || !!c.decedent.settlementGift !== settle > 0) bad.push(`${s.id} 精算課税`);
      if (c.priorGifts.length !== s.gifts.length) bad.push(`${s.id} 贈与の件数`);
      const pi = s.decedent.priorInheritance;
      const on = !!pi && pi.yearsAgo < 10 && pi.prevTax > 0;
      if (!!c.decedent.priorInheritanceTax !== on) bad.push(`${s.id} 相次相続の有無`);
      if (on) {
        const p = c.decedent.priorInheritance;
        // 前の相続から今回の相続までの年数（1年未満切捨て）が、シナリオの年数と同じになる日付。同じ日にはしない
        if (!p?.date || !(p.date < s.decedent.deathDate) || ageAt(p.date, s.decedent.deathDate) !== pi!.yearsAgo) bad.push(`${s.id} 前の相続の日 ${p?.date}`);
        if (p?.prevTax !== pi!.prevTax || p?.prevAcquired !== pi!.prevAcquired) bad.push(`${s.id} 前の相続の金額`);
      }
    }
    expect(bad).toEqual([]);
  });
});
