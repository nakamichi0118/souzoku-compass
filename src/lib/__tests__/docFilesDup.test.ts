import { describe, expect, it } from "vitest";
import { splitDuplicates, type DocFile } from "../docFiles";

const saved = (docId: string, name: string, size: number, type = "application/pdf"): DocFile => ({ id: name, docId, name, type, size, addedAt: "", src: "", load: async () => new Blob() });
const pdf = (name: string, bytes: number) => new File([new Uint8Array(bytes)], name, { type: "application/pdf" });

describe("同じ書類を2回アップロードしたとき（splitDuplicates）", () => {
  it("保存済みと種類・大きさが同じ書類は、名前が違っても同じ書類として分ける", async () => {
    const r = await splitDuplicates([pdf("残高証明書(1).pdf", 1000), pdf("戸籍.pdf", 2000)], [saved("balanceCert", "残高証明書.pdf", 1000)]);
    expect(r.fresh.map((f) => f.name)).toEqual(["戸籍.pdf"]);
    expect(r.dups).toHaveLength(1);
    expect(r.dups[0]).toMatchObject({ name: "残高証明書(1).pdf", same: { docId: "balanceCert", name: "残高証明書.pdf" } });
  });

  it("1回で同じ書類を2つ選んだときは、2つ目を同じものとする", async () => {
    const r = await splitDuplicates([pdf("a.pdf", 500), pdf("a のコピー.pdf", 500)], []);
    expect(r.fresh.map((f) => f.name)).toEqual(["a.pdf"]);
    expect(r.dups[0].same.docId).toBe("");
  });

  it("大きさが違えば別の書類", async () => {
    const r = await splitDuplicates([pdf("a.pdf", 501)], [saved("kosekiDecedent", "a.pdf", 500)]);
    expect(r.fresh).toHaveLength(1);
    expect(r.dups).toHaveLength(0);
  });
});
