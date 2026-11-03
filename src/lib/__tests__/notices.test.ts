import { describe, expect, it, vi } from "vitest";

// 保存の仕組み（画面用の部品を含む）は読み込まず、並び順だけを確かめる
vi.mock("@/lib/cloud", () => ({ kvGet: () => null, kvSet: () => {} }));

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
