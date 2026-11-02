import { beforeEach, describe, expect, it } from "vitest";
import { createSession, endSession, hashPassword, login, passwordProblem, signup, userFromToken, verifyPassword } from "../auth/auth";
import { memoryDb, setDb } from "../auth/db";

beforeEach(() => setDb(memoryDb()));

describe("ログイン", () => {
  it("パスワードは塩付きハッシュで保存し、照合できる", async () => {
    const h = await hashPassword("abc12345");
    expect(h).not.toContain("abc12345");
    expect(h).not.toBe(await hashPassword("abc12345"));
    expect(await verifyPassword("abc12345", h)).toBe(true);
    expect(await verifyPassword("abc12346", h)).toBe(false);
  });
  it("弱いパスワードと重複したメールアドレスを断る", async () => {
    expect(passwordProblem("short1")).toBeTruthy();
    expect(passwordProblem("onlyletters")).toBeTruthy();
    expect(passwordProblem("letters123")).toBeNull();
    expect("user" in (await signup("一郎", "Ichiro@Example.com", "letters123"))).toBe(true);
    expect(await signup("二郎", "ichiro@example.com ", "letters123")).toEqual({ error: expect.stringContaining("すでに登録") });
  });
  it("登録→ログイン→トークンで本人を確認→ログアウトで無効", async () => {
    await signup("一郎", "ichiro@example.com", "letters123");
    expect(await login("ichiro@example.com", "wrong1234")).toBeNull();
    const u = await login("ICHIRO@example.com", "letters123");
    expect(u?.name).toBe("一郎");
    expect(u).not.toHaveProperty("password");
    const t = await createSession(u!.id);
    expect((await userFromToken(t))?.id).toBe(u!.id);
    expect(await userFromToken(t + "x")).toBeNull();
    await endSession(t);
    expect(await userFromToken(t)).toBeNull();
  });
});
