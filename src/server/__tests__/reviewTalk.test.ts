import { describe, expect, it } from "vitest";
import { TalkBody, checkTalk, talkSystem } from "../review/talk";

describe("申告前の確認：コンパスくんの聞き取り", () => {
  it("話す論点だけ受け付ける", () => {
    expect(TalkBody.safeParse({ topic: "nominee", messages: [{ role: "user", text: "長男の名義の口座" }] }).success).toBe(true);
    expect(TalkBody.safeParse({ topic: "receivables", messages: [{ role: "user", text: "x" }] }).success).toBe(false);
  });

  it("許されていない結論は相談にする", () => {
    const r = checkTalk("nominee", { reply: "", done: true, outcome: "add", summary: "" });
    expect(r.outcome).toBe("consult");
    expect(checkTalk("nominee", { reply: "", done: true, outcome: "none", summary: "" }).outcome).toBe("none");
    expect(checkTalk("nominee", { reply: "", done: true, outcome: null, summary: "" }).outcome).toBe("consult");
  });

  it("話が終わっていなければ結論は出さない", () => {
    expect(checkTalk("company", { reply: "", done: false, outcome: "none", summary: "" }).outcome).toBeNull();
  });

  it("出せる結論をシステムプロンプトに書く", () => {
    const s = talkSystem("nominee");
    expect(s).toContain("none：");
    expect(s).not.toContain("add：");
  });
});
