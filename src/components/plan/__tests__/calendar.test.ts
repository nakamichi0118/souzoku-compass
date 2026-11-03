import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Task } from "@/domain/procedures/rules";
import { MonthCalendar } from "../MonthCalendar";

const task = (id: string, date: string, hard = false) => ({ id, date, title: `手続き${id}`, hard }) as unknown as Task;
const tasks = [task("a", "2027-01-15", true), task("b", "2027-01-15"), task("c", "2027-01-20")];
const render = (compact?: boolean) => renderToStaticMarkup(createElement(MonthCalendar, { tasks, done: [], today: "2027-01-10", compact }));

describe("月のカレンダー（スマホ）", () => {
  it("スマホでは日のます目を低くし、手続きの名前の代わりに点を出す（日を押したときの一覧が画面に入るように）", () => {
    const html = render();
    expect(html.match(/min-h-12 p-1 sm:min-h-20/g)).toHaveLength(31);
    // 名前は sm 以上だけ
    expect(html).toMatch(/<span class="mt-0.5 hidden w-full space-y-0.5 text-left sm:block"><span [^>]*>手続きa<\/span>/);
    // 点は予定のある日（15日・20日）だけ、スマホだけ
    expect(html.match(/absolute h-1 w-1 rounded-full bottom-1.5 sm:hidden/g)).toHaveLength(2);
  });

  it("小さいカレンダー（compact）はこれまでどおり点だけ", () => {
    const html = render(true);
    expect(html).not.toContain("min-h-12");
    expect(html).not.toContain("手続きa</span></span>");
    expect(html.match(/absolute h-1 w-1 rounded-full bottom-0 /g)).toHaveLength(2);
  });
});
