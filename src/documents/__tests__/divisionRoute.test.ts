import { describe, expect, it, vi } from "vitest";
import { demoCase } from "@/data/demo";
import type { Case } from "@/domain/types";

// 入口の確認（同じサイトからの呼び出し・回数・入力の形）は通したものとして、送られた相続の入力をそのまま渡す
const { current } = vi.hoisted(() => ({ current: { case: undefined as Case | undefined } }));
vi.mock("@/server/caseRequest", async (orig) => ({
  ...(await orig<typeof import("@/server/caseRequest")>()),
  readCaseRequest: vi.fn(async () => ({ case: current.case! })),
}));

import { POST } from "@/app/api/division/route";
import { NO_HEIRS_MESSAGE } from "@/documents/division";

const post = () => new Request("http://localhost/api/division", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });

describe("遺産分割協議書のAPI", () => {
  it("相続人がいないときは 400 と説明を返す", async () => {
    const c = structuredClone(demoCase);
    c.persons = c.persons.map((p) => ({ ...p, renounced: true }));
    current.case = c;
    const res = await POST(post());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: NO_HEIRS_MESSAGE });
  });

  it("相続人がいればPDFを返す", async () => {
    current.case = structuredClone(demoCase);
    const res = await POST(post());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
  }, 30_000);
});
