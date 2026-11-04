import { describe, expect, it } from "vitest";
import { demoCase } from "@/data/demo";
import { TOPICS, cashFromWithdrawal, draftReason, reviewSummary } from "@/domain/review/topics";
import { calculate } from "@/domain/tax/engine";
import { filingSteps } from "@/lib/progress";

describe("デモの家族", () => {
  it("申告前の確認がすべて答えてあり、申告書に「下書き」が入らない", () => {
    const s = reviewSummary(demoCase.review);
    expect(s.answered).toBe(TOPICS.length);
    expect(s.confirmed).toBe(true);
    expect(draftReason(demoCase.review)).toBeNull();
  });

  it("引き出しの残りが、財産の現金と同じ額", () => {
    const cash = demoCase.assets.find((a) => a.id === "cash");
    expect(cash && "amount" in cash ? cash.amount : -1).toBe(cashFromWithdrawal(demoCase.review?.withdrawal));
  });

  it("書類の作成の手前まで済んだ状態で始まる", () => {
    const steps = filingSteps(demoCase, calculate(demoCase));
    expect(steps.filter((s) => !s.done).map((s) => s.slug)).toEqual(["documents"]);
  });
});
