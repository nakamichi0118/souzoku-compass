import { describe, expect, it } from "vitest";
import { toNumber } from "../fraction";
import { blankInterview, estimate, heirBreakdown, type Interview } from "../procedures/interview";
import { buildTasks } from "../procedures/rules";
import { decodeInterview, encodeInterview } from "../procedures/share";

const iv = (p: Partial<Interview>): Interview => ({ ...blankInterview(), deathDate: "2026-01-06", ...p });
const shareOf = (x: Interview, id: string) => toNumber(estimate(x).heirs.byPerson.get(id) ?? { n: 0n, d: 1n });

describe("最初の聞き取りでの相続人の判定", () => {
  it("子がいなければ親が相続人（配偶者2/3・親1/3）", () => {
    const x = iv({ spouse: true, hasChildren: "no", parentsAlive: 2 });
    const e = estimate(x);
    expect(e.heirCount).toBe(3);
    expect(e.basicDeduction).toBe(48_000_000);
    expect(shareOf(x, "spouse")).toBeCloseTo(2 / 3);
    expect(heirBreakdown(x)).toBe("配偶者、両親");
  });

  it("子がいれば親は相続人にならない", () => {
    const e = estimate(iv({ spouse: true, hasChildren: "yes", children: 2, parentsAlive: 2, siblings: 3 }));
    expect(e.heirCount).toBe(3);
    expect(e.heirs.rank).toBe(1);
  });

  it("「子はいない」と答えたら、前に入れた子の人数は数えない", () => {
    const e = estimate(iv({ spouse: true, hasChildren: "no", children: 2, parentsAlive: 1 }));
    expect(e.heirCount).toBe(2);
    expect(e.heirs.rank).toBe(2);
  });

  it("両親がいなければ祖父母、祖父母もいなければ兄弟姉妹", () => {
    expect(estimate(iv({ hasChildren: "no", parentsAlive: 0, grandparentsAlive: 2, siblings: 3 })).heirCount).toBe(2);
    const x = iv({ spouse: true, hasChildren: "no", hasSiblings: "yes", siblings: 2 });
    expect(estimate(x).heirCount).toBe(3);
    expect(shareOf(x, "spouse")).toBeCloseTo(3 / 4);
  });

  it("半血の兄弟姉妹は両親が同じ兄弟姉妹の半分（民法900条4号）。基礎控除では1人として数える", () => {
    const x = iv({ hasChildren: "no", hasSiblings: "yes", siblings: 1, halfSiblings: 1 });
    const e = estimate(x);
    expect(e.heirCount).toBe(2);
    expect(e.basicDeduction).toBe(42_000_000);
    expect(shareOf(x, "s0")).toBeCloseTo(2 / 3);
    expect(shareOf(x, "h0")).toBeCloseTo(1 / 3);
    expect(heirBreakdown(x)).toBe("兄弟姉妹2人（うち父母の一方のみ同じ1人）");
  });

  it("先に亡くなった兄弟姉妹の子（甥・姪）が代わりに相続する", () => {
    const x = iv({ hasChildren: "no", hasSiblings: "yes", siblings: 1, nephewsOfPredeceased: 2 });
    expect(estimate(x).heirCount).toBe(3);
    expect(shareOf(x, "s0")).toBeCloseTo(1 / 2);
    expect(shareOf(x, "n0")).toBeCloseTo(1 / 4);
  });

  it("「兄弟姉妹はいない」と答えたら、配偶者だけが相続人", () => {
    const e = estimate(iv({ spouse: true, hasChildren: "no", hasSiblings: "no", siblings: 2 }));
    expect(e.heirCount).toBe(1);
    expect(e.basicDeduction).toBe(36_000_000);
  });

  it("前の配偶者との子も同じ相続分の子として数え、戸籍の手続きで連絡先の案内を出す", () => {
    const x = iv({ spouse: true, hasChildren: "yes", children: 2, exSpouseChild: true });
    expect(estimate(x).heirCount).toBe(3);
    expect(shareOf(x, "c0")).toBeCloseTo(1 / 4);
    const koseki = buildTasks(x).tasks.find((t) => t.id === "koseki");
    expect(koseki?.what).toContain("戸籍の附票");
  });

  it("養子は、実子がいれば1人までしか基礎控除の人数に入れない（相続税法15条）", () => {
    expect(estimate(iv({ hasChildren: "yes", children: 4, adoptedChildren: 3 })).heirCount).toBe(2);
    expect(estimate(iv({ hasChildren: "yes", children: 3, adoptedChildren: 3 })).heirCount).toBe(2);
  });

  it("前の版で保存した答え（いる・いないの欄がない）は、人数の欄から判断する", () => {
    const old = { ...blankInterview(), deathDate: "2026-01-06", children: 2, hasChildren: "" as const };
    expect(estimate(old).heirCount).toBe(2);
  });

  it("新しい欄も購読URLで受け渡せる", () => {
    const x = iv({ hasChildren: "no", hasSiblings: "yes", siblings: 1, halfSiblings: 2, nephewsOfPredeceased: 1 });
    const back = decodeInterview(encodeInterview(x));
    expect(back && estimate(back).heirCount).toBe(4);
  });
});
