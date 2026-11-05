import { describe, expect, it } from "vitest";
import { generateScenarios } from "../../../scripts/cases/generate";
import { toCase } from "../../../scripts/cases/toCase";
import { calculate } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";
import { fixTarget } from "../fixLink";

const base = (): Case =>
  ({
    title: "",
    decedent: { name: "相続 太郎", deathDate: "2026-04-01", address: "東京都千代田区架空町1-2-3" },
    persons: [{ id: "p1", name: "花子", relation: "spouse", birthDate: "1960-01-01" }],
    assets: [{ id: "a1", kind: "deposit", label: "架空銀行 普通預金", amount: 1_000_000 }],
    debts: [{ id: "d1", kind: "debt", label: "架空カード", amount: 10_000, bearers: [] }],
    priorGifts: [],
    allocations: [],
  }) as unknown as Case;

describe("止まっている事項から直す場所へのリンク", () => {
  it("分け方の事項は分け方の画面の、その財産の行へ", () => {
    const t = fixTarget(base(), "「架空銀行 普通預金」を受け継ぐ人が決まっていません。遺産の分け方で取得者を決めてください。");
    expect(t.href).toBe("/case/division?focus=asset-a1");
  });
  it("財産の確認待ちは財産の画面でその財産を開く", () => {
    const t = fixTarget(base(), "「架空銀行 普通預金」は、書類から読み取ったあと、まだ確かめていない項目があります（金額）。財産の画面で確かめて「入れて確かめました」を押してください。");
    expect(t.href).toBe("/case/assets?asset=a1");
  });
  it("土地の評価の事項（画面の名前なし）は財産の画面で、税理士への相談も出す", () => {
    const t = fixTarget(base(), "「架空銀行 普通預金」：評価乖離率が0以下になるため、通常の方法では評価できません。税理士にご相談ください。");
    expect(t.href).toBe("/case/assets?asset=a1");
    expect(t.consult).toBe(true);
  });
  it("贈与は債務・葬式費用の画面の、その贈与の行へ", () => {
    const t = fixTarget(base(), "亡くなる前3年以内の贈与（2件目、1,000,000円）の贈与の日が入っていないか、正しい日付ではありません。債務・葬式費用の画面で贈与の日を入れてください。");
    expect(t.href).toBe("/case/debts?focus=gift-1");
  });
  it("代償金は分け方の画面の、その代償金の行へ", () => {
    expect(fixTarget(base(), "代償金（1件目）の金額を、1円以上の整数で入れてください。").href).toBe("/case/division?focus=comp-0");
  });
  it("人の事項は相続人の画面の、その人の行へ", () => {
    expect(fixTarget(base(), "花子さんが最初に障害者控除を受けた相続の日が、今回亡くなった日より前になっていません。相続人の画面で日付を確かめてください。").href).toBe("/case/heirs?focus=person-p1");
  });
  it("相次相続控除は亡くなった方の画面のその欄へ", () => {
    expect(fixTarget(base(), "相次相続控除の「前の相続の日」が、今回亡くなった日より前になっていません。亡くなった方の画面で日付を確かめてください。").href).toBe(
      "/case/decedent?focus=priorInheritance",
    );
  });

  it("1000件のシナリオで出る止まる事項は、どれも直す画面か税理士への相談に結びつく", () => {
    const misses: string[] = [];
    let seen = 0;
    for (const s of generateScenarios(1000)) {
      let c: Case;
      try {
        const x = toCase(s).case;
        if (!x) continue;
        c = x;
      } catch {
        continue;
      }
      const r = calculate(c);
      for (const b of r.blockers) {
        seen++;
        const t = fixTarget(c, b);
        // 直す画面がなく税理士への相談だけになるのは、税理士への相談を案内する事項だけ
        if (t.href === "/consult" && !/税理士/.test(b)) misses.push(b);
      }
    }
    expect(seen).toBeGreaterThan(0);
    expect([...new Set(misses)]).toEqual([]);
  }, 120_000);
});
