import { beforeEach, describe, expect, it } from "vitest";
import { createSession, endSession, hashPassword, login, loginKey, passwordProblem, plausibleEmail, signup, userFromToken, validEmail, verifyPassword } from "../auth/auth";
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

describe("メールアドレスの形の確認", () => {
  it("ふつうのアドレスは通し、形の違うものは断る", () => {
    expect(validEmail("ichiro@example.co.jp")).toBe(true);
    expect(validEmail("a.b+c@example.com")).toBe(true);
    for (const bad of ["", "ichiro", "ichiro@", "@example.com", "ichiro@example", "ichiro@example..com", "ichiro@example.com.", "a b@example.com"]) expect(validEmail(bad)).toBe(false);
  });

  it("長すぎる入力は、正規表現を動かす前に断る（大きな入力でも一瞬で終わる）", () => {
    const huge = "a@" + "b".repeat(1_000_000) + "!";
    const t = performance.now();
    expect(validEmail(huge)).toBe(false);
    expect(validEmail("a@" + ".".repeat(300))).toBe(false);
    expect(plausibleEmail(huge)).toBe(false);
    expect(performance.now() - t).toBeLessThan(50);
  });

  it("ログインでは、以前の確認で登録できたアドレスも通す（長さと「@」だけを見る）", () => {
    expect(plausibleEmail("ichiro@example..com")).toBe(true);
    expect(plausibleEmail("ichiro@example.com")).toBe(true);
    for (const bad of ["", "ichiro", "a@b@c", "a b@c.d", "x".repeat(250) + "@example.com"]) expect(plausibleEmail(bad)).toBe(false);
  });

  it("ログインの失敗を数えるキーは、メールアドレスが長くても短い", () => {
    const k = loginKey("1.2.3.4", "x".repeat(250) + "@example.com");
    expect(k.length).toBeLessThan(50);
    expect(loginKey("1.2.3.4", "Ichiro@Example.com")).toBe(loginKey("1.2.3.4", "ichiro@example.com"));
  });
});
