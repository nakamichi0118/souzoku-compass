import { describe, expect, it, vi } from "vitest";

// 保存の仕組み（画面用の部品を含む）は読み込まず、並び順だけを確かめる
vi.mock("@/lib/cloud", () => ({ kvGet: () => null, kvSet: () => {} }));

import { SYSTEM_NOTICES } from "@/data/systemNotices";
import { compareNotices, personalNotices, type Notice } from "@/lib/notices";
import type { useOverall } from "@/lib/overall";

const n = (id: string, level: Notice["level"], date: string): Notice => ({ id, kind: "personal", level, date, title: id, body: "" });

describe("お知らせの並び順", () => {
  it("期限を過ぎたものを先に、それぞれ日付の早い順に並べる", () => {
    const list = [n("soon-late", "warn", "2026-11-20"), n("over-new", "danger", "2026-10-30"), n("soon-early", "info", "2026-11-05"), n("over-old", "danger", "2026-09-01")];
    expect([...list].sort(compareNotices).map((x) => x.id)).toEqual(["over-old", "over-new", "soon-early", "soon-late"]);
  });

  it("並べる前の順番によらず同じ結果になる", () => {
    const list = [n("a", "danger", "2026-10-01"), n("b", "danger", "2026-08-01"), n("c", "danger", "2026-09-01"), n("d", "warn", "2026-11-04")];
    const expected = ["b", "c", "a", "d"];
    expect([...list].sort(compareNotices).map((x) => x.id)).toEqual(expected);
    expect([...list].reverse().sort(compareNotices).map((x) => x.id)).toEqual(expected);
  });

  it("期限切れの手続きが複数あると、古い期限から表示する", () => {
    const o = {
      loaded: true,
      heard: true,
      valid: true,
      now: "2026-11-03",
      closed: () => false,
      main: [
        { id: "early", title: "前の期限", date: "2026-09-10", hard: true },
        { id: "late", title: "あとの期限", date: "2026-10-20", hard: true },
        { id: "soon", title: "もうすぐ", date: "2026-11-10", hard: true },
      ],
    } as unknown as ReturnType<typeof useOverall>;
    expect(personalNotices(o).map((x) => x.id)).toEqual(["over:early", "over:late", "soon:soon:2026-11-10"]);
  });
});

describe("あなたへのお知らせの文", () => {
  const base = { loaded: true, heard: true, valid: true, closed: () => false };
  it("期限を過ぎたものは「期限：日付」と、まず窓口に相談することを短く出す", () => {
    const o = { ...base, now: "2026-11-03", main: [{ id: "death", title: "死亡届", date: "2026-10-20", hard: true }] } as unknown as ReturnType<typeof useOverall>;
    const [x] = personalNotices(o);
    expect(x.title).toBe("「死亡届」の期限を過ぎています");
    expect(x.body).toBe("期限：2026年10月20日（火）。まずは窓口に相談しましょう。");
  });
  it("相続税の申告期限のお知らせは、日付だけを「期限：」で出す（ほかの期限のお知らせと同じ書き方）", () => {
    const o = { ...base, now: "2026-11-04", main: [{ id: "inheritance-tax", title: "相続税の申告と納付", date: "2027-01-15", hard: true }] } as unknown as ReturnType<typeof useOverall>;
    const tax = personalNotices(o).find((x) => x.id.startsWith("tax:"))!;
    expect(tax.title).toBe("相続税の申告期限まであと72日です");
    expect(tax.body).toBe("期限：2027年1月15日（金）");
  });
});

describe("相続コンパスからのお知らせ（SYSTEM_NOTICES）", () => {
  // 並び順は「新しい順に並ぶ」で確かめる。中身は id で引く（お知らせを足しても壊れないように）
  const byId = (id: string) => SYSTEM_NOTICES.find((n) => n.id === id) ?? ({ id: "", date: "", title: "", body: "" } as (typeof SYSTEM_NOTICES)[number]);

  it("右下のコンパスくんのチャットのお知らせ", () => {
    const chat = byId("2026-11-07-chat");
    expect(chat.title).toBe("コンパスくんに右下から聞けます");
    expect(chat.body).toContain("このチャットで解決できましたか？");
  });

  it("財産ごとに元の資料を開けること", () => {
    expect(byId("2026-11-06-source-docs")).toMatchObject({ id: "2026-11-06-source-docs", date: "2026-11-06" });
  });

  it("マイナンバーの書類を預からないこと", () => {
    const no = SYSTEM_NOTICES.find((n) => n.id === "2026-11-06-no-mynumber")!;
    expect(no).toMatchObject({ id: "2026-11-06-no-mynumber", date: "2026-11-06" });
    expect(no.body).toContain("ご自身で写しを用意");
  });

  it("保険金を何人かで受け取れること", () => {
    const latest = byId("2026-11-06-recipients");
    expect(latest).toMatchObject({ id: "2026-11-06-recipients", date: "2026-11-06" });
    expect(latest.body).toContain("受取人を追加");
  });

  it("書類をまとめてアップロード・続けて撮影できること", () => {
    const upload = byId("2026-11-06-upload");
    expect(upload).toMatchObject({ id: "2026-11-06-upload", date: "2026-11-06" });
    expect(upload.body).toContain("追加でアップロード");
  });

  it("口座・保険が複数あっても続けて読めること", () => {
    const more = byId("2026-11-06-more-docs");
    expect(more).toMatchObject({ id: "2026-11-06-more-docs" });
    expect(more.body).toContain("ほかにもある");
    expect(more.body).toContain("これで全部");
  });

  it("使い方ガイドで開く場所を示すことと、聞き取りの完了案内", () => {
    const guide = byId("2026-11-06-guide-nav");
    expect(guide.date).toBe("2026-11-06");
    expect(guide.body).toContain("上のメニュー");
  });

  it("税額の画面の財産の合計の内訳（小規模宅地等の特例・保険金の非課税）", () => {
    const breakdown = byId("2026-11-05-breakdown");
    expect(breakdown).toMatchObject({ id: "2026-11-05-breakdown", date: "2026-11-05" });
    expect(breakdown.body).toContain("500万円×法定相続人の数");
    expect(breakdown.body).toContain("小規模宅地等の特例");
  });

  it("その前は、止まった理由から直す場所へ飛べること", () => {
    const gates = byId("2026-11-05-gates");
    expect(gates).toMatchObject({ id: "2026-11-05-gates", date: "2026-11-05" });
    expect(gates.body).toContain("未回答");
    expect(gates.body).toContain("下書き");
  });

  it("その前は、還付金・高額療養費の判定、画面をめぐる操作ガイドと右上の「使い方」", () => {
    const [receivables, tour, help] = ["2026-11-05-receivables", "2026-11-05-tour", "2026-11-05-help"].map(byId);
    expect(receivables).toMatchObject({ id: "2026-11-05-receivables", date: "2026-11-05" });
    expect(receivables.body).toContain("高額療養費");
    expect(tour).toMatchObject({ id: "2026-11-05-tour", date: "2026-11-05" });
    expect(tour.body).toContain("もう表示しない");
    expect(help).toMatchObject({ id: "2026-11-05-help", date: "2026-11-05" });
    expect(help.body).toContain("分からない");
  });

  it("その前のお知らせは、書類の撮影、小規模宅地等の特例の割り当て、受け取る人が決まっていない財産、第8の8表・第14表、郵便番号から住所を入れること、画面の文字を減らしたこと", () => {
    const [scan, small, unsettled, latest, first, second] = ["2026-11-05-scan-bundle", "2026-11-04-small-land", "2026-11-04-unsettled-check", "2026-11-04-forms-8-8-14", "2026-11-04-zip", "2026-11-04-less-text"].map(byId);
    expect(scan).toMatchObject({ id: "2026-11-05-scan-bundle", date: "2026-11-05", title: "書類を撮影して提出用にまとめられます" });
    expect(scan.body).toContain("印鑑証明書は原本");
    expect(small).toMatchObject({ id: "2026-11-04-small-land", date: "2026-11-04", title: "小規模宅地等の特例の割り当てを見直しました" });
    expect(small.body).toContain("税理士に確認できれば");
    expect(unsettled).toMatchObject({ id: "2026-11-04-unsettled-check", date: "2026-11-04" });
    expect(latest).toMatchObject({ id: "2026-11-04-forms-8-8-14", date: "2026-11-04", title: "第8の8表と第14表も自動で作ります" });
    expect(first).toMatchObject({ id: "2026-11-04-zip", date: "2026-11-04", title: "郵便番号から住所を入れられます" });
    expect(second).toMatchObject({ id: "2026-11-04-less-text", date: "2026-11-04", title: "画面の文字を減らし、見やすくしました" });
    expect(second.body.match(/。/g)).toHaveLength(1);
  });
  it("id は重ならず、新しい順に並ぶ", () => {
    expect(new Set(SYSTEM_NOTICES.map((n) => n.id)).size).toBe(SYSTEM_NOTICES.length);
    const dates = SYSTEM_NOTICES.map((n) => n.date);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
  it("不具合を直したお知らせは1件にまとめる（区の路線価図の件も入れる）", () => {
    const fixes = SYSTEM_NOTICES.filter((n) => /不具合/.test(n.title));
    expect(fixes).toHaveLength(1);
    expect(fixes[0].title).toBe("細かな不具合を直しました");
    expect(fixes[0].body).toContain("路線価図");
    expect(SYSTEM_NOTICES.some((n) => n.id === "2026-11-03-rosenka-ku")).toBe(false);
  });
  it("相次相続控除は計算できる（「計算できない」という古い文を残さない）", () => {
    for (const n of SYSTEM_NOTICES) expect(n.body).not.toMatch(/相次相続控除は[^。]*計算できない/);
    expect(SYSTEM_NOTICES.some((n) => n.body.includes("相次相続控除") && n.body.includes("計算できます"))).toBe(true);
  });
  it("タイトルは短く（25字まで）。申告書の「下書き」と相続登記の期限のお知らせは残す", () => {
    for (const n of SYSTEM_NOTICES) expect(n.title.length).toBeLessThanOrEqual(25);
    expect(SYSTEM_NOTICES.some((n) => n.body.includes("「下書き」"))).toBe(true);
    expect(SYSTEM_NOTICES.some((n) => n.body.includes("2027年3月31日"))).toBe(true);
    expect(SYSTEM_NOTICES.some((n) => n.body.includes("次の平日"))).toBe(true);
  });
});
