import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/calendar/route";
import { blankInterview, type Interview } from "@/domain/procedures/interview";
import { encodeInterview } from "@/domain/procedures/share";

const iv = (p: Partial<Interview>): Interview => ({ ...blankInterview(), deathDate: "2026-01-06", ...p });
const feed = async (d: string) => {
  const res = await GET(new Request(`https://example.test/api/calendar?d=${d}`));
  return { status: res.status, body: await res.text() };
};
const uids = (ics: string) => [...ics.matchAll(/^UID:([a-z0-9-]+)-\d{8}@/gm)].map((m) => m[1]);

describe("カレンダーの購読 URL", () => {
  // 聞き取りの目安では申告不要だが、財産を評価したら申告が必要になった家族
  const family = iv({ spouse: true, children: 1, deposits: 5_000_000 });

  it("古い URL（判定なし）は聞き取りの目安で作る：相続税の申告は載らない", async () => {
    const { status, body } = await feed(encodeInterview(family));
    expect(status).toBe(200);
    expect(uids(body)).not.toContain("inheritance-tax");
  });
  it("評価した結果の判定があれば、相続税の申告期限を載せる", async () => {
    const { body } = await feed(encodeInterview(family, { verdict: "likely" }));
    expect(uids(body)).toContain("inheritance-tax");
  });
  it("「不要」にした手続きは載せない", async () => {
    const all = uids((await feed(encodeInterview(family))).body);
    expect(all).toContain("utilities");
    const { body } = await feed(encodeInterview(family, { skip: ["utilities"] }));
    expect(uids(body)).not.toContain("utilities");
    expect(uids(body).length).toBe(all.length - 1);
  });
  it("読めない URL は 400", async () => {
    expect((await feed("@@@")).status).toBe(400);
    expect((await feed(encodeInterview(iv({ deathDate: "" })))).status).toBe(400);
  });
});
