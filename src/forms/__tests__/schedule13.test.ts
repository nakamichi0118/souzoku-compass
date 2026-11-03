import { describe, expect, it } from "vitest";
import { demoCase } from "@/data/demo";
import { calculate } from "@/domain/tax/engine";
import { build13, debtKind } from "../schedules";

describe("第13表の債務の種類", () => {
  it("種類を選んでいなければ、税金・保険料の名前で始まるものだけを公租公課にする", () => {
    expect(debtKind({ label: "令和8年度 固定資産税（未納分）" })).toEqual({ kind: "公租公課", detail: "固定資産税" });
    expect(debtKind({ label: "住民税（令和7年度分）" })).toEqual({ kind: "公租公課", detail: "住民税" });
    expect(debtKind({ label: "令和7年分所得税" })).toEqual({ kind: "公租公課", detail: "所得税" });
    expect(debtKind({ label: "介護保険料" })).toEqual({ kind: "公租公課", detail: "介護保険料" });
  });

  it("名前に「税」の字が入っているだけでは公租公課にしない", () => {
    expect(debtKind({ label: "未払医療費（税込）" })).toEqual({ kind: "その他", detail: "未払医療費（税込）" });
    expect(debtKind({ label: "税理士への報酬（未払）" })).toEqual({ kind: "その他", detail: "税理士への報酬（未払）" });
  });

  it("種類を選んでいればそれに従う", () => {
    expect(debtKind({ label: "住宅ローン残高", debtType: "銀行借入金" })).toEqual({ kind: "銀行借入金", detail: "住宅ローン残高" });
    expect(debtKind({ label: "入院費", debtType: "未払金" })).toEqual({ kind: "未払金", detail: "入院費" });
    expect(debtKind({ label: "固定資産税の立替分", debtType: "その他" })).toEqual({ kind: "その他", detail: "固定資産税の立替分" });
    expect(debtKind({ label: "未納の住民税", debtType: "公租公課" })).toEqual({ kind: "公租公課", detail: "住民税" });
    expect(debtKind({ label: "区の手数料", debtType: "公租公課" })).toEqual({ kind: "公租公課", detail: "区の手数料" });
  });

  it("申告書の欄に種類と細目が入る", () => {
    const c = structuredClone(demoCase);
    c.debts.push({ id: "med", kind: "debt", label: "未払医療費（税込）", amount: 50_000, creditor: "架空病院", bearers: [{ personId: "hanako", amount: 50_000 }] });
    const [pg] = build13(c, calculate(c));
    expect(pg.values["d0.kind"]).toBe("公租公課");
    expect(pg.values["d0.detail"]).toBe("固定資産税");
    expect(pg.values["d1.kind"]).toBe("その他");
    expect(pg.values["d1.detail"]).toBe("未払医療費（税込）");
  });
});
