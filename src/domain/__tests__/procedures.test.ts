import { describe, expect, it } from "vitest";
import { addMonths, skipWeekend, withinDays, isValidDate, jpDate } from "../procedures/dates";
import { blankInterview, demoInterview, estimate, needsFinalReturn, type Interview } from "../procedures/interview";
import { blueReturnDue, buildTasks, vacantHomeDue } from "../procedures/rules";
import { googleEventUrl, toICS } from "../procedures/calendar";
import { decodeInterview, encodeInterview } from "../procedures/share";
import { DOCS } from "../procedures/documents";
import { areaOf, cityOf, isTokyoWard } from "../procedures/offices";

const iv = (p: Partial<Interview>): Interview => ({ ...blankInterview(), deathDate: "2026-01-06", ...p });

describe("期限日の計算", () => {
  it("〇日以内は起算日を1日目として数える", () => {
    expect(withinDays("2026-01-06", 7)).toBe("2026-01-12");
  });
  it("〇か月以内は応当日、応当日がなければ月末", () => {
    expect(addMonths("2026-01-06", 10)).toBe("2026-11-06"); // 国税庁の例：1月6日死亡→11月6日
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-05-31", 10)).toBe("2027-03-31");
  });
  it("土日は翌月曜日にずらす", () => {
    expect(skipWeekend("2026-11-07")).toBe("2026-11-09"); // 土
    expect(skipWeekend("2026-11-08")).toBe("2026-11-09"); // 日
    expect(skipWeekend("2026-11-06")).toBe("2026-11-06");
  });
  it("日付の検証と表示", () => {
    expect(isValidDate("2026-02-30")).toBe(false);
    expect(isValidDate("2026-02-28")).toBe(true);
    expect(jpDate("2026-11-06")).toBe("2026年11月6日（金）");
  });
  it("青色申告の承認申請と空き家特例の期限", () => {
    expect(blueReturnDue("2026-03-10")).toBe("2026-07-10");
    expect(blueReturnDue("2026-09-15")).toBe("2026-12-31");
    expect(blueReturnDue("2026-11-15")).toBe("2027-02-15");
    expect(vacantHomeDue("2026-01-06")).toBe("2029-12-31");
  });
});

describe("相続税がかかるかの目安", () => {
  it("配偶者と子1人なら基礎控除は4,200万円", () => {
    const e = estimate(iv({ spouse: true, children: 1, deposits: 30_000_000, homeValue: 10_000_000 }));
    expect(e.heirCount).toBe(2);
    expect(e.basicDeduction).toBe(42_000_000);
    expect(e.verdict).toBe("borderline"); // 4,000万円は基礎控除の8割超
  });
  it("基礎控除を大きく下回れば申告不要", () => {
    const e = estimate(iv({ spouse: true, children: 2, deposits: 20_000_000 }));
    expect(e.verdict).toBe("none");
    expect(e.roughTotalTax).toBe(0);
  });
  it("生命保険金は500万円×法定相続人の数まで差し引く", () => {
    const e = estimate(iv({ children: 2, insurance: 12_000_000 }));
    expect(e.insuranceExempt).toBe(10_000_000);
    expect(e.taxableTotal).toBe(2_000_000);
  });
  it("特例を使えば基礎控除以下になる場合は「特例のための申告」", () => {
    const e = estimate(iv({ spouse: true, children: 2, homeValue: 32_000_000, homeToFamily: true, deposits: 18_000_000, securities: 4_000_000, insurance: 10_000_000, otherAssets: 500_000, debtAmount: 600_000, funeralCost: 1_800_000 }));
    expect(e.heirCount).toBe(3);
    expect(e.taxableTotal).toBe(52_100_000);
    expect(e.verdict).toBe("relief");
  });
  it("基礎控除を超えると総額の目安を出す（子2人・1億円）", () => {
    const e = estimate(iv({ children: 2, deposits: 100_000_000 }));
    // 課税遺産総額 5,800万円 → 各2,900万円 × 15% − 50万円 = 385万円 × 2
    expect(e.verdict).toBe("likely");
    expect(e.roughTotalTax).toBe(7_700_000);
    expect(e.roughTaxAfterSpouse).toBe(7_700_000);
  });
  it("代襲相続の孫も人数に入る", () => {
    expect(estimate(iv({ children: 1, grandchildrenOfPredeceased: 2 })).heirCount).toBe(3);
  });
  it("子がいなければ親、親もいなければ兄弟姉妹", () => {
    expect(estimate(iv({ spouse: true, parentsAlive: 2, siblings: 3 })).heirCount).toBe(3);
    expect(estimate(iv({ spouse: true, siblings: 3 })).heirCount).toBe(4);
  });
});

describe("手続きリスト", () => {
  it("期限順に並び、必ず必要な手続きが入る", () => {
    const { tasks } = buildTasks(iv({ spouse: true, children: 1 }));
    const ids = tasks.map((t) => t.id);
    for (const id of ["death-report", "renounce", "inheritance-tax", "shijuku", "isshuki", "utilities"]) expect(ids).toContain(id);
    const dates = tasks.map((t) => t.date);
    expect([...dates].sort()).toEqual(dates);
  });
  it("期限：死亡届7日・相続放棄3か月・相続税10か月", () => {
    const { tasks } = buildTasks(iv({ spouse: true, children: 1 }));
    const at = (id: string) => tasks.find((t) => t.id === id)!;
    expect(at("death-report").date).toBe("2026-01-13"); // 7日目の1/12は成人の日→翌日;
    expect(at("renounce").date).toBe("2026-04-06");
    expect(at("inheritance-tax").date).toBe("2026-11-06");
    expect(at("shijuku").date).toBe("2026-02-23");
    expect(at("isshuki").date).toBe("2027-01-06");
  });
  it("申告不要の見込みなら相続税は「該当する場合」に回す", () => {
    const { tasks } = buildTasks(iv({ spouse: true, children: 1, deposits: 5_000_000 }));
    const t = tasks.find((t) => t.id === "inheritance-tax")!;
    expect(t.optional).toBe(true);
    expect(t.title).toContain("不要");
  });
  it("条件で出し分ける（年金・不動産・保険・事業・賃貸）", () => {
    const none = buildTasks(iv({ children: 1, digital: false })).tasks.map((t) => t.id);
    expect(none).not.toContain("pension-stop");
    expect(none).not.toContain("registration");
    expect(none).not.toContain("insurance-claim");
    expect(none).not.toContain("final-return");
    const all = buildTasks(iv({ children: 1, pension: "employees", homeValue: 1, insurance: 1, work: "selfEmployed", rentedHome: true })).tasks;
    const ids = all.map((t) => t.id);
    for (const id of ["pension-stop", "registration", "insurance-claim", "final-return", "business-close", "rented-home"]) expect(ids).toContain(id);
    expect(all.find((t) => t.id === "pension-stop")!.date).toBe("2026-01-15"); // 厚生年金は10日以内
    expect(all.find((t) => t.id === "registration")!.date).toBe("2029-01-09"); // 3年後の1/6は土曜、1/8は成人の日→1/9
  });
  it("保険金の請求は申告に間に合う目安と、3年の期限を両方持つ", () => {
    const t = buildTasks(iv({ children: 1, insurance: 5_000_000 })).tasks.find((t) => t.id === "insurance-claim")!;
    expect(t.hard).toBe(false);
    expect(t.date).toBe("2026-03-06");
    expect(t.limit?.date).toBe("2029-01-09");
  });
  it("準確定申告の要否", () => {
    expect(needsFinalReturn(iv({ work: "selfEmployed" }))).toBe("required");
    expect(needsFinalReturn(iv({ work: "employee" }))).toBe("maybeRefund");
    expect(needsFinalReturn(iv({ work: "pension" }))).toBe("notNeeded");
  });
  it("自筆の遺言書がある場合は検認を重要扱い", () => {
    const t = buildTasks(iv({ children: 1, will: "handwritten" })).tasks.find((t) => t.id === "will-search")!;
    expect(t.title).toContain("検認");
    expect(t.important).toBe(true);
  });
});

describe("カレンダー", () => {
  const { tasks } = buildTasks(demoInterview());
  it("iCalendar 形式で、終日の予定として出力する", () => {
    const ics = toICS(tasks, { name: "相続の手続き", stamp: "20261102T000000Z" });
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("DTSTART;VALUE=DATE:20260323");
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(tasks.length);
    for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
  });
  it("Google カレンダーの追加リンク", () => {
    const u = new URL(googleEventUrl(tasks[0]));
    expect(u.hostname).toBe("calendar.google.com");
    expect(u.searchParams.get("dates")).toMatch(/^\d{8}\/\d{8}$/);
  });
  it("聞き取りの答えを URL 用に圧縮して戻せる（名前は含めない）", () => {
    const d = demoInterview();
    const back = decodeInterview(encodeInterview(d))!;
    expect(back).toEqual({ ...d, decedentName: "", address: "", myRelation: "" });
    expect(decodeInterview("@@@")).toBeNull();
  });
});

describe("書類と提出先", () => {
  it("手続きが参照する書類はすべて定義されている", () => {
    const all = buildTasks(iv({ spouse: true, children: 2, homeValue: 1, otherRealEstate: 1, securities: 1, insurance: 1, deposits: 1, work: "selfEmployed", pension: "employees", will: "handwrittenStored" })).tasks;
    for (const t of all) for (const d of t.docs) expect(DOCS[d], `${t.id}:${d}`).toBeDefined();
    expect(all.find((t) => t.id === "death-report")!.office).toBe("city");
    expect(all.find((t) => t.id === "inheritance-tax")!.office).toBe("taxOffice");
    expect(all.find((t) => t.id === "will-search")!.office).toBe("legalAffairs");
  });
  it("住所から市区町村を取り出す", () => {
    expect(cityOf("東京都千代田区架空町一丁目2番3号")).toEqual({ pref: "東京都", city: "千代田区" });
    expect(cityOf("神奈川県横浜市中区真砂町1-1")).toEqual({ pref: "神奈川県", city: "横浜市中区" });
    expect(cityOf("北海道虻田郡倶知安町北1条")).toEqual({ pref: "北海道", city: "虻田郡倶知安町" });
    expect(areaOf("東京都千代田区架空町一丁目2番3号")).toBe("東京都千代田区架空町");
    expect(areaOf("神奈川県横浜市中区真砂町1-1")).toBe("神奈川県横浜市中区真砂町");
    expect(isTokyoWard("東京都千代田区架空町")).toBe(true);
    expect(isTokyoWard("東京都八王子市元本郷町")).toBe(false);
  });
  it("評価済みの計算結果があれば判定を差し替える", () => {
    const t = buildTasks(iv({ children: 1 }), { verdict: "likely" }).tasks.find((t) => t.id === "inheritance-tax")!;
    expect(t.optional).toBe(false);
    expect(t.title).toBe("相続税の申告と納付");
  });
});

describe("休日と月末の期限（レビュー指摘）", () => {
  it("月末の相続開始日は応当月末を期限にする", async () => {
    const { addMonths: am, nextOpenDay } = await import("../procedures/dates");
    expect(am("2026-01-31", 10)).toBe("2026-11-30");
    expect(am("2026-04-30", 10)).toBe("2027-02-28");
    expect(nextOpenDay(am("2026-04-30", 10))).toBe("2027-03-01"); // 2/28は日曜
    expect(am("2026-08-31", 10)).toBe("2027-06-30");
  });
  it("祝日・振替休日・国民の休日・年末年始は次の平日にずらす", async () => {
    const { nextOpenDay, holidaysOf } = await import("../procedures/dates");
    const h = holidaysOf(2026);
    expect(h.has("2026-03-20")).toBe(true); // 春分の日
    expect(h.has("2026-09-23")).toBe(true); // 秋分の日
    expect(h.has("2026-05-06")).toBe(true); // 憲法記念日（日曜）の振替休日
    expect(h.has("2026-09-22")).toBe(true); // 敬老の日と秋分の日にはさまれた国民の休日
    expect(h.has("2026-01-12")).toBe(true); // 成人の日
    expect(nextOpenDay("2026-11-03")).toBe("2026-11-04"); // 文化の日
    expect(nextOpenDay("2026-12-29")).toBe("2027-01-04"); // 年末年始
    expect(nextOpenDay("2026-11-06")).toBe("2026-11-06");
  });
});
