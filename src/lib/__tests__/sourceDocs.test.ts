import { describe, expect, it } from "vitest";
import type { Case } from "@/domain/types";
import { applyExtracted, type ExtractedAsset } from "../extract";
import { MAX_SOURCES, resolveSources, withSource } from "../sourceDocs";

const base: Case = {
  decedent: { name: "相続 太郎", deathDate: "2026-04-01" },
  persons: [],
  assets: [],
  debts: [],
  allocations: [],
  priorGifts: [],
} as unknown as Case;

const dep = (amount: number): ExtractedAsset => ({
  kind: "deposit",
  label: "みほん銀行 普通",
  institution: "みほん銀行",
  amount,
  accruedInterest: null,
  location: null,
  areaSqm: null,
  fixedAssetValue: null,
  date: null,
  evidence: "",
});

describe("財産に元の資料を結びつける", () => {
  it("読み取って登録した財産に、資料の id と名前が残る", () => {
    const r = applyExtracted(base, dep(1000));
    const c = withSource(r.next, r.ref, { fileId: "f1", name: "zandaka.pdf" });
    expect(c.assets[0].sourceFiles).toEqual([{ id: "f1", name: "zandaka.pdf" }]);
    expect(c.assets[0].docFrom).toBe("zandaka.pdf");
  });
  it("同じ財産を別の資料で更新すると、資料が足される（同じ資料は重ねない）", () => {
    const r = applyExtracted(base, dep(1000));
    let c = withSource(r.next, r.ref, { fileId: "f1", name: "a.pdf" });
    const r2 = applyExtracted(c, dep(1000), r.ref);
    c = withSource(r2.next, r2.ref, { fileId: "f2", name: "b.pdf" });
    c = withSource(c, r2.ref, { fileId: "f2", name: "b.pdf" });
    expect(c.assets[0].sourceFiles?.map((s) => s.id)).toEqual(["f1", "f2"]);
  });
  it("債務にも残る。贈与（id がない）はそのまま", () => {
    const r = applyExtracted(base, { ...dep(500), kind: "debt", label: "借入金" });
    const c = withSource(r.next, r.ref, { fileId: "d1", name: "loan.pdf" });
    expect(c.debts[0].sourceFiles).toEqual([{ id: "d1", name: "loan.pdf" }]);
    const g = applyExtracted(base, { ...dep(500), kind: "gift", label: "贈与" });
    expect(withSource(g.next, g.ref, { fileId: "x", name: "x" })).toBe(g.next);
  });
  it("上限を超えたら古い資料から外す", () => {
    const r = applyExtracted(base, dep(1000));
    let c = r.next;
    for (let i = 0; i < MAX_SOURCES + 5; i++) c = withSource(c, r.ref, { fileId: `f${i}`, name: `${i}.pdf` });
    expect(c.assets[0].sourceFiles).toHaveLength(MAX_SOURCES);
    expect(c.assets[0].sourceFiles?.[0].id).toBe("f5");
  });
});

describe("元の資料を、保存されている書類に当てはめる", () => {
  const files = [
    { id: "s1", name: "a.pdf" },
    { id: "s2", name: "b.jpg" },
  ];
  it("id で当てはめる（元のファイル名と保存した名前が違っても、余計な「保存されていません」を出さない）", () => {
    expect(resolveSources([{ id: "s2", name: "b.jpg" }], "b.png", files)).toEqual([{ kind: "file", file: files[1] }]);
  });
  it("端末からサーバーへ移して id が変わった資料は、それぞれ名前で当てはめる", () => {
    expect(
      resolveSources(
        [
          { id: "old1", name: "a.pdf" },
          { id: "old2", name: "b.jpg" },
        ],
        "b.jpg",
        files,
      ),
    ).toEqual([
      { kind: "file", file: files[0] },
      { kind: "file", file: files[1] },
    ]);
  });
  it("前の版の財産（名前だけ）も名前で当てはめる", () => {
    expect(resolveSources(undefined, "a.pdf", files)).toEqual([{ kind: "file", file: files[0] }]);
  });
  it("見本の書類と、消された資料", () => {
    expect(resolveSources([{ id: "sample:balanceCert", name: "残高証明書（見本）.pdf" }], undefined, files)).toEqual([{ kind: "sample", docId: "balanceCert" }]);
    expect(resolveSources([{ id: "gone", name: "c.pdf" }], "c.pdf", files)).toEqual([{ kind: "gone", name: "c.pdf" }]);
  });
  it("「手元にあり」だけのときは何も出さない", () => {
    expect(resolveSources(undefined, "手元にあり", files)).toEqual([]);
  });
});
