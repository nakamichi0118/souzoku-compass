import { describe, expect, it } from "vitest";
import { TOPICS, cashFromWithdrawal, dropConsulted, consultPrompt, draftReason, reviewConsultLines, reviewSummary, topicById, topicStatus, type ReviewState } from "../review/topics";

const allNo = (): ReviewState => ({ answers: Object.fromEntries(TOPICS.map((t) => [t.id, "no"])) });

describe("申告前の確認", () => {
  it("何も答えていなければ未確認で、下書きになる", () => {
    const r = reviewSummary(undefined);
    expect(r.confirmed).toBe(false);
    expect(r.answered).toBe(0);
    expect(draftReason(undefined)).toBe("申告前の確認が終わっていません");
  });

  it("すべて「ない」なら確認OK", () => {
    expect(reviewSummary(allNo()).confirmed).toBe(true);
    expect(draftReason(allNo())).toBeNull();
  });

  it("「分からない」は「ない」として扱わない", () => {
    const s = allNo();
    s.answers!.nominee = "unsure";
    const r = reviewSummary(s);
    expect(r.confirmed).toBe(false);
    expect(r.unsure).toEqual(["nominee"]);
    expect(reviewConsultLines(s)[0]).toContain("分からない");
  });

  it("亡くなったあとに受け取るお金：1件ずつ判定し、相続財産だけを足すまで残す", () => {
    const t = topicById("receivables");
    const s = allNo();
    s.answers!.receivables = "yes";
    expect(topicStatus(t, s, "2026-03-15").kind).toBe("unanswered");
    // 以前の版でまとめて足した人は済み
    expect(topicStatus(t, { ...s, added: ["receivables"] }, "2026-03-15").kind).toBe("clear");
    s.receivables = [
      { id: "a", type: "kaigo", amount: 12_000 },
      { id: "b", type: "pension" },
      { id: "c", type: "kogakuRyoyo", basis: "2026-02", holder: "decedent" },
    ];
    const st = topicStatus(t, s, "2026-03-15");
    expect(st.kind).toBe("add");
    if (st.kind !== "add") throw new Error();
    expect(st.items.map((i) => i.key)).toEqual(["receivables:a", "receivables:c"]);
    expect(st.items[0].template).toMatchObject({ kind: "other", label: "介護保険料の還付金", amount: 12_000, pending: [], receivable: { type: "kaigo" } });
    expect(st.items[1].template.pending).toEqual(["受け取る金額"]);
    // 亡くなった日が分からないと判定できない
    expect(topicStatus(t, s).kind).toBe("unanswered");
    s.added = ["receivables:a", "receivables:c"];
    expect(topicStatus(t, s, "2026-03-15").kind).toBe("clear");
    s.receivables.push({ id: "d", type: "bonus" });
    expect(topicStatus(t, s, "2026-03-15").kind).toBe("consult");
    expect(reviewConsultLines(s, "2026-03-15")[0]).toContain("賞与");
  });

  it("選択肢で結論が決まる（持株会：上場は追加、非上場は相談）", () => {
    const s = allNo();
    s.answers!.esop = "yes";
    expect(topicStatus(topicById("esop"), s).kind).toBe("unanswered");
    s.sub = { esop: ["listed"] };
    expect(topicStatus(topicById("esop"), s)).toMatchObject({ kind: "add", items: [{ key: "esop:listed" }] });
    s.sub = { esop: ["unlisted"] };
    expect(topicStatus(topicById("esop"), s).kind).toBe("consult");
    s.consulted = ["esop"];
    expect(topicStatus(topicById("esop"), s).kind).toBe("clear");
  });

  it("複数選べる論点：相談がなくなっても、足す財産が残っていれば追加", () => {
    const s = allNo();
    s.answers!.valuables = "yes";
    s.sub = { valuables: ["cash", "art"] };
    const x = topicStatus(topicById("valuables"), s);
    expect(x.kind).toBe("consult");
    s.consulted = ["valuables"];
    expect(topicStatus(topicById("valuables"), s)).toMatchObject({ kind: "add", items: [{ key: "valuables:cash" }] });
  });

  it("話す論点は、話が終わるまで残り、相談の結論なら理由が決まっている", () => {
    const s = allNo();
    s.answers!.nominee = "yes";
    expect(topicStatus(topicById("nominee"), s).kind).toBe("talk");
    s.talk = { nominee: { outcome: "consult", summary: "長男名義の定期預金。原資は父", at: "2026-11-04" } };
    const x = topicStatus(topicById("nominee"), s);
    expect(x).toMatchObject({ kind: "consult", reasons: [topicById("nominee").talk!.consultReason] });
    expect(reviewConsultLines(s)[0]).toContain("長男名義の定期預金");
  });

  it("特殊事情・国外は「ある」なら必ず相談", () => {
    const s = allNo();
    s.answers!.homeSpecial = "yes";
    s.answers!.foreign = "yes";
    expect(reviewSummary(s).consult.map((c) => c.id)).toEqual(["homeSpecial", "foreign"]);
  });

  it("引き出した額から使い道の分かった額を引く（0未満は0）", () => {
    expect(cashFromWithdrawal({ amount: 3_000_000, used: 1_200_000 })).toBe(1_800_000);
    expect(cashFromWithdrawal({ amount: 100, used: 500 })).toBe(0);
    expect(cashFromWithdrawal(undefined)).toBe(0);
  });

  it("相談をすすめる文は理由のあとに続く", () => {
    expect(consultPrompt("名義預金にあたるかの判断が必要")).toBe("名義預金にあたるかの判断が必要です。税額が大きく変わる可能性があるため、税理士への相談をおすすめします。");
  });

  it("話す論点の結論は、決まったものだけ", () => {
    expect(topicById("nominee").talk!.outcomes).not.toContain("add");
    for (const t of TOPICS) if (t.talk) expect(t.talk.outcomes).toContain("consult");
  });
});

describe("申告前の確認：答え直したとき", () => {
  it("相談して確かめた印を外すと、新しい事実は相談に戻る", () => {
    const s: ReviewState = { ...allNo(), consulted: ["nominee"] };
    s.answers!.nominee = "yes";
    s.talk = { nominee: { outcome: "consult", summary: "", at: "" } };
    expect(topicStatus(topicById("nominee"), s).kind).toBe("clear");
    expect(topicStatus(topicById("nominee"), dropConsulted(s, "nominee")).kind).toBe("consult");
  });
});
