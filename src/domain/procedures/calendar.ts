/**
 * 手続きリストをカレンダー（iCalendar 形式、RFC 5545）にする。
 * Google カレンダー・iPhone・Outlook に取り込める。各予定は終日の予定で、1週間前と前日に通知する。
 */
import { addDays } from "./dates";
import type { Task } from "./rules";

/** TEXT の値のエスケープ（RFC 5545 3.3.11）：\ ; , と改行 */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const compact = (d: string) => d.replace(/-/g, "");

/** DTSTAMP 用の日時（UTC、例：20261103T091500Z） */
export const icsStamp = (at: Date = new Date()) => at.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

/** 75オクテットを超える行を折り返す（UTF-8 の文字の途中では切らない） */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = "";
      size = 0;
    }
    cur += ch;
    size += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

export function taskDescription(t: Task, appUrl?: string): string {
  const lines = [t.what, "", `期限：${t.hard ? "法律上の期限" : "目安"}`];
  if (t.limit) lines.push(t.limit.text);
  lines.push(`どこで：${t.where}`);
  if (t.bring.length) lines.push(`持ち物：${t.bring.join("、")}`);
  if (t.law) lines.push(`根拠：${t.law}`);
  if (appUrl) lines.push("", `相続コンパス：${appUrl}`);
  return lines.join("\n");
}

export function toICS(tasks: Task[], opts: { name: string; stamp: string; appUrl?: string }): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//souzoku-compass//procedures//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(opts.name)}`,
    "X-WR-TIMEZONE:Asia/Tokyo",
  ];
  for (const t of tasks) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${t.id}-${compact(t.date)}@souzoku-compass`,
      `DTSTAMP:${opts.stamp}`,
      `DTSTART;VALUE=DATE:${compact(t.date)}`,
      `DTEND;VALUE=DATE:${compact(addDays(t.date, 1))}`,
      `SUMMARY:${esc(`${t.hard ? "【期限】" : ""}${t.title}`)}`,
      `DESCRIPTION:${esc(taskDescription(t, opts.appUrl))}`,
      `CATEGORIES:${esc(t.category)}`,
      "TRANSP:TRANSPARENT",
    );
    if (t.hard || t.important) {
      for (const trig of ["-P7D", "-P1D"]) {
        lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(t.title)}`, `TRIGGER:${trig}`, "END:VALARM");
      }
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** 1件だけを Google カレンダーに追加するリンク */
export function googleEventUrl(t: Task, appUrl?: string): string {
  const p = new URLSearchParams({
    action: "TEMPLATE",
    text: `${t.hard ? "【期限】" : ""}${t.title}`,
    dates: `${compact(t.date)}/${compact(addDays(t.date, 1))}`,
    details: taskDescription(t, appUrl),
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
