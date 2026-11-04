import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { demoCase } from "@/data/demo";
import { TOPICS } from "@/domain/review/topics";
import type { Case } from "@/domain/types";

const { current } = vi.hoisted(() => ({ current: { case: undefined as Case | undefined } }));
vi.mock("@/server/caseRequest", async (orig) => ({
  ...(await orig<typeof import("@/server/caseRequest")>()),
  readCaseRequest: vi.fn(async () => ({ case: current.case! })),
}));

import { POST } from "@/app/api/forms/route";

const post = () => new Request("http://localhost/api/forms", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
const consent = { terms: true, responsibility: true, at: "2026-11-04T00:00:00Z" };

describe("申告書のAPI：同意と下書き", () => {
  it("同意のチェックがなければ作らない", async () => {
    current.case = structuredClone(demoCase);
    const res = await POST(post());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("利用規約");
  });

  it("確認が終わっていなくても、同意があれば下書きとして作る", async () => {
    current.case = { ...structuredClone(demoCase), review: { consent } };
    const res = await POST(post());
    expect(res.status).toBe(200);
    const doc = await PDFDocument.load(new Uint8Array(await res.arrayBuffer()));
    expect(doc.getPageCount()).toBeGreaterThan(0);
  }, 30_000);

  it("すべて確かめて同意すれば作る", async () => {
    current.case = { ...structuredClone(demoCase), review: { consent, answers: Object.fromEntries(TOPICS.map((t) => [t.id, "no"])) } };
    const res = await POST(post());
    expect(res.status).toBe(200);
  }, 30_000);
});
