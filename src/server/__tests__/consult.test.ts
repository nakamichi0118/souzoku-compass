import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicUser } from "@/server/auth/auth";

// ログイン中の人と、同じサイトからの呼び出しかどうかをテストから決める
const { who } = vi.hoisted(() => ({ who: { user: null as PublicUser | null, origin: true } }));
vi.mock("@/server/auth/http", () => ({
  currentUser: async () => who.user,
  sameOrigin: async () => who.origin,
}));

import { GET as list, POST as create } from "@/app/api/consult/route";
import { GET as read, POST as message, PUT as meeting } from "@/app/api/consult/[id]/route";
import { memoryConsultDb, setConsultDb } from "@/server/consult/store";

const alice: PublicUser = { id: "u1", email: "alice@example.com", name: "相続 一郎", createdAt: "" };
const bob: PublicUser = { id: "u2", email: "bob@example.com", name: "別人", createdAt: "" };
const staff: PublicUser = { id: "s1", email: "dxs-info@taxlawyer328.com", name: "事務所", createdAt: "" };

const req = (method: string, body?: unknown, url = "http://localhost/api/consult") =>
  new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const form = { name: "相続 一郎", prefecture: "東京都", contact: "03-0000-0000", content: "名義預金について相談したい" };

beforeEach(() => {
  setConsultDb(memoryConsultDb());
  who.origin = true;
});

describe("税理士への相談のAPI", () => {
  it("ログインしていなければ送れない", async () => {
    who.user = null;
    expect((await create(req("POST", form))).status).toBe(401);
  });

  it("必須の項目がなければ送れない（都道府県は一覧から）", async () => {
    who.user = alice;
    const res = await create(req("POST", { ...form, prefecture: "東京" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("都道府県");
    expect((await create(req("POST", { ...form, contact: " " }))).status).toBe(400);
  });

  it("別のサイトからは送れない", async () => {
    who.user = alice;
    who.origin = false;
    expect((await create(req("POST", form))).status).toBe(403);
  });

  it("送った相談は本人と事務所だけが読め、やりとりと打ち合わせの案内ができる", async () => {
    who.user = alice;
    const { item } = await (await create(req("POST", form))).json();
    expect(item.userId).toBeUndefined();

    who.user = bob;
    expect((await read(req("GET"), ctx(item.id))).status).toBe(404);
    expect((await list(req("GET", undefined, "http://localhost/api/consult?all=1"))).status).toBe(403);
    expect((await meeting(req("PUT", { url: "https://meet.google.com/abc" }), ctx(item.id))).status).toBe(403);

    who.user = staff;
    const all = await (await list(req("GET", undefined, "http://localhost/api/consult?all=1"))).json();
    expect(all.items).toHaveLength(1);
    expect(all.items[0].unread).toBe(1);
    await message(req("POST", { text: "ご相談ありがとうございます。" }), ctx(item.id));
    expect((await meeting(req("PUT", { url: "http://insecure" }), ctx(item.id))).status).toBe(400);
    const m = await (await meeting(req("PUT", { url: "https://meet.google.com/abc-defg-hij", at: "11月10日 14:00" }), ctx(item.id))).json();
    expect(m.item.meeting.url).toBe("https://meet.google.com/abc-defg-hij");

    who.user = alice;
    const mine = await (await list(req("GET"))).json();
    expect(mine.items[0].unread).toBe(2);
    expect(mine.items[0].messages[0]).toMatchObject({ from: "firm" });
    const seen = await (await read(req("GET"), ctx(item.id))).json();
    expect(seen.item.unread).toBe(0);
  });
});
