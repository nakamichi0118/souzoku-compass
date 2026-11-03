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
import { type CaseReport, WRONG_BUDGET, runAll } from "../../../scripts/cases/run";

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

  it("WRONG（近似）・UNREPRESENTABLE の件は、近似・入力できない事柄を取り除くと正しい答えと一致する（ほかの誤りが隠れていない）", () => {
    const hidden = reports.filter((r) => r.residual && !r.residual.explained).map((r) => `${r.id} ${r.class}→${r.residual!.class}`);
    expect(hidden).toEqual([]);
  });

  it("手続きの一覧と入力の形に問題がない", () => {
    const bad = reports.filter((r) => r.docErrors.length).map((r) => `${r.id}: ${r.docErrors.join(" / ")}`);
    expect(bad).toEqual([]);
  });
});
