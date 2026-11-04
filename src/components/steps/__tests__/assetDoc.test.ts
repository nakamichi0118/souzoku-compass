import { describe, expect, it } from "vitest";
import type { Asset } from "@/domain/types";
import { assetHasDoc } from "../AssetsStep";

const dep = (id: string, docFrom?: string): Asset => ({ id, kind: "deposit", label: id, amount: 1, ...(docFrom ? { docFrom } : {}) });

describe("財産ごとの「書類あり」", () => {
  it("口座が2つ以上あるときは、書類を読んだ口座だけが書類あり", () => {
    const all = [dep("みほん銀行", "zandaka.pdf"), dep("別の銀行 定期")];
    const done = ["doc:balanceCert"];
    expect(assetHasDoc(all[0], all, done)).toBe(true);
    expect(assetHasDoc(all[1], all, done)).toBe(false);
  });
  it("口座が1つなら、資料集めで残高証明書に「済」を付けただけでも書類あり", () => {
    const all = [dep("みほん銀行")];
    expect(assetHasDoc(all[0], all, ["doc:balanceCert"])).toBe(true);
    expect(assetHasDoc(all[0], all, [])).toBe(false);
  });
});
