import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@/server/auth/auth";

const { who } = vi.hoisted(() => ({ who: { user: null as PublicUser | null, origin: true } }));
vi.mock("@/server/auth/http", () => ({
  currentUser: async () => who.user,
  sameOrigin: async () => who.origin,
}));

import { GET as list, POST as upload } from "@/app/api/files/route";
import { DELETE as remove, GET as read, PATCH as move } from "@/app/api/files/[id]/route";
import { CHUNK, memoryFileDb, setFileDb } from "@/server/files/store";

const alice: PublicUser = { id: "u1", email: "a@example.com", name: "相続 一郎", createdAt: "" };
const bob: PublicUser = { id: "u2", email: "b@example.com", name: "別人", createdAt: "" };
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

function post(docId: string, bytes = new Uint8Array([1, 2, 3]), type = "image/jpeg") {
  const fd = new FormData();
  fd.append("file", new File([bytes], "koseki.jpg", { type }));
  fd.append("docId", docId);
  return upload(new Request("http://localhost/api/files", { method: "POST", body: fd }));
}

beforeEach(() => {
  setFileDb(memoryFileDb());
  who.origin = true;
  who.user = alice;
});

describe("書類の保存のAPI", () => {
  it("ログインしていなければ保存も一覧もできない", async () => {
    who.user = null;
    expect((await post("kosekiDecedent")).status).toBe(401);
    expect((await list()).status).toBe(401);
  });

  it("ほかのサイトからは保存できない", async () => {
    who.origin = false;
    expect((await post("kosekiDecedent")).status).toBe(403);
  });

  it("保存した書類は本人の一覧に出て、中身をそのまま読める", async () => {
    const r = await post("kosekiDecedent");
    expect(r.status).toBe(200);
    const { item } = await r.json();
    expect(item).toMatchObject({ docId: "kosekiDecedent", type: "image/jpeg", size: 3 });
    expect((await (await list()).json()).items).toHaveLength(1);
    const got = await read(new Request("http://localhost"), ctx(item.id));
    expect(got.headers.get("content-type")).toBe("image/jpeg");
    expect([...new Uint8Array(await got.arrayBuffer())]).toEqual([1, 2, 3]);
  });

  it("ほかの人の書類は読めず、消せず、種類も変えられない", async () => {
    const { item } = await (await post("inkan")).json();
    who.user = bob;
    expect((await (await list()).json()).items).toHaveLength(0);
    expect((await read(new Request("http://localhost"), ctx(item.id))).status).toBe(404);
    expect((await remove(new Request("http://localhost", { method: "DELETE" }), ctx(item.id))).status).toBe(404);
    expect((await move(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ docId: "otherDoc" }) }), ctx(item.id))).status).toBe(404);
  });

  it("種類を変えて、消せる", async () => {
    const { item } = await (await post("otherDoc")).json();
    expect((await move(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ docId: "kosekiHeirs" }) }), ctx(item.id))).status).toBe(200);
    expect((await (await list()).json()).items[0].docId).toBe("kosekiHeirs");
    expect((await move(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ docId: "nope" }) }), ctx(item.id))).status).toBe(400);
    expect((await remove(new Request("http://localhost", { method: "DELETE" }), ctx(item.id))).status).toBe(200);
    expect((await (await list()).json()).items).toHaveLength(0);
  });

  it("知らない書類の種類・画像とPDF以外・大きすぎるファイルは断る", async () => {
    expect((await post("nope")).status).toBe(400);
    expect((await post("inkan", new Uint8Array([1]), "text/html")).status).toBe(400);
    expect((await post("inkan", new Uint8Array(8 * 1024 * 1024 + 1))).status).toBe(413);
  });

  it("大きなPDFは分けて保存し、つなげて読める", async () => {
    const big = new Uint8Array(CHUNK * 2 + 10).map((_, i) => i % 251);
    const { item } = await (await post("touki", big, "application/pdf")).json();
    const got = new Uint8Array(await (await read(new Request("http://localhost"), ctx(item.id))).arrayBuffer());
    expect(got.length).toBe(big.length);
    expect(got[CHUNK + 5]).toBe(big[CHUNK + 5]);
  });
});
