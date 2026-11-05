import { describe, expect, it } from "vitest";
import { NO_UPLOAD, guessDocId, itemReady, submissionItems } from "../submission";
import { isDocId } from "@/server/files/limits";

const base = { taxDocs: ["kosekiDecedent", "kosekiHeirs", "inkan", "balanceCert", "funeralReceipt"], smallLand: false, will: false };

describe("税務署に出す書類の一覧", () => {
  it("申告書 → 戸籍 → 協議書 → 印鑑証明書 → マイナンバー → 財産の資料 の順", () => {
    expect(submissionItems(base).map((i) => i.id)).toEqual(["forms", "family", "division", "inkan", "mynumber", "assets"]);
  });

  it("相続人が1人なら協議書と印鑑証明書は出さない（遺言書があれば写しだけ）", () => {
    expect(submissionItems({ ...base, soleHeir: true }).map((i) => i.id)).toEqual(["forms", "family", "mynumber", "assets"]);
    expect(submissionItems({ ...base, soleHeir: true, will: true }).find((i) => i.id === "division")?.label).toBe("遺言書の写し");
  });

  it("印鑑証明書は原本を出す", () => {
    const inkan = submissionItems(base).find((i) => i.id === "inkan")!;
    expect(inkan.original).toBe(true);
    expect(inkan.note).toContain("原本");
  });

  it("小規模宅地等の特例を使うときだけ、特例の書類の欄が入る", () => {
    expect(submissionItems({ ...base, smallLand: true }).some((i) => i.id === "smallLand")).toBe(true);
  });

  it("遺言書があるときは遺言書の写しも入れる", () => {
    expect(submissionItems({ ...base, will: true }).find((i) => i.id === "division")!.docIds).toContain("willCopy");
  });

  it("財産の資料は、申告の手続きで使う書類だけ（不動産がなければ評価証明書は入らない）", () => {
    const assets = submissionItems(base).find((i) => i.id === "assets")!;
    expect(assets.docIds).toEqual(["balanceCert", "funeralReceipt", "otherDoc"]);
    const withLand = submissionItems({ ...base, taxDocs: [...base.taxDocs, "touki", "hyokaCert"] }).find((i) => i.id === "assets")!;
    expect(withLand.docIds).toContain("nayose");
  });

  it("戸籍は、法定相続情報一覧図か、亡くなった方と相続人の両方の戸籍があればそろった", () => {
    const family = submissionItems(base).find((i) => i.id === "family")!;
    const n = (have: string[]) => (d: string) => (have.includes(d) ? 1 : 0);
    expect(itemReady(family, n(["houteiJoho"]), false)).toBe(true);
    expect(itemReady(family, n(["kosekiDecedent"]), false)).toBe(false);
    expect(itemReady(family, n(["kosekiDecedent", "kosekiHeirs"]), false)).toBe(true);
  });

  it("書類の種類の名前から、資料集めの書類を当てる", () => {
    expect(guessDocId("預金残高証明書")).toBe("balanceCert");
    expect(guessDocId("投資信託 残高証明書")).toBe("securitiesCert");
    expect(guessDocId("印鑑登録証明書")).toBe("inkan");
    expect(guessDocId("除籍全部事項証明書")).toBe("kosekiDecedent");
    expect(guessDocId("固定資産税 課税明細書")).toBe("hyokaCert");
    expect(guessDocId("領収書")).toBe("funeralReceipt");
    expect(guessDocId("よくわからない紙")).toBeNull();
  });
});

describe("マイナンバーの書類は預からない", () => {
  const items = submissionItems({ taxDocs: [], smallLand: false, will: false });
  const my = items.find((i) => i.id === "mynumber")!;

  it("提出書類の欄には残すが、入れる書類の種類はなく「ご自身で用意」にする", () => {
    expect(my.selfOnly).toBe(true);
    expect(my.docIds).toEqual([]);
    expect(itemReady(my, () => 0, false)).toBe(true);
  });

  it("どの欄の書類の種類にもマイナンバーは出てこない", () => {
    expect(items.flatMap((i) => i.docIds).some((d) => NO_UPLOAD.has(d))).toBe(false);
  });

  it("サーバーは mynumber の種類で保存を受け付けない", () => {
    expect(isDocId("mynumber")).toBe(false);
    expect(isDocId("kosekiDecedent")).toBe(true);
  });

  it("読み取った書類の種類がマイナンバーなら、そうと分かる", () => {
    expect(NO_UPLOAD.has(guessDocId("個人番号カード") ?? "")).toBe(true);
    expect(NO_UPLOAD.has(guessDocId("通知カード") ?? "")).toBe(true);
  });
});
