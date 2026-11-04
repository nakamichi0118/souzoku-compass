"use client";

/**
 * お知らせ：「あなたへのお知らせ」（期限が近い・過ぎた手続き、相続税の申告期限など）と、
 * 「相続コンパスからのお知らせ」（機能の追加など）に分ける。既読はログイン中ならサーバーに保存する。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { SYSTEM_NOTICES } from "@/data/systemNotices";
import { daysBetween, jpDate } from "@/domain/procedures/dates";
import { kvGet, kvSet } from "./cloud";
import type { useOverall } from "./overall";

const READ_KEY = "souzoku-compass:notices-read:v1";
const READ_EVENT = "souzoku-compass:notices-read";

export interface Notice {
  id: string;
  kind: "personal" | "system";
  level: "danger" | "warn" | "info";
  date: string;
  title: string;
  body: string;
  href?: string;
}

export function personalNotices(o: ReturnType<typeof useOverall>): Notice[] {
  if (!o.loaded || !o.heard || !o.valid) return [];
  const out: Notice[] = [];
  for (const t of o.main) {
    if (o.closed(t.id)) continue;
    const left = daysBetween(o.now, t.date);
    if (left < 0 && t.hard)
      out.push({ id: `over:${t.id}`, kind: "personal", level: "danger", date: t.date, title: `「${t.title}」の期限を過ぎています`, body: `期限：${jpDate(t.date)}。まずは窓口に相談しましょう。`, href: `/my/tasks?id=${t.id}` });
    else if (left >= 0 && left <= (t.hard ? 14 : 7))
      out.push({
        id: `soon:${t.id}:${t.date}`,
        kind: "personal",
        level: t.hard ? "warn" : "info",
        date: t.date,
        title: left === 0 ? `「${t.title}」は今日が${t.hard ? "期限" : "目安"}です` : `「${t.title}」の${t.hard ? "期限" : "目安"}まであと${left}日です`,
        body: `${t.hard ? "期限" : "目安"}：${jpDate(t.date)}`,
        href: `/my/tasks?id=${t.id}`,
      });
  }
  const tax = o.main.find((t) => t.id === "inheritance-tax");
  if (tax && !o.closed(tax.id)) {
    const left = daysBetween(o.now, tax.date);
    if (left > 14 && left <= 90)
      out.push({ id: `tax:${tax.date}:${Math.floor(left / 30)}`, kind: "personal", level: "warn", date: tax.date, title: `相続税の申告期限まであと${left}日です`, body: `期限：${jpDate(tax.date)}`, href: "/case/assets" });
  }
  return out.sort(compareNotices);
}

/** 並び順：期限を過ぎたものを先に。それぞれの中では日付の早い順 */
export function compareNotices(a: Notice, b: Notice): number {
  const rank = (n: Notice) => (n.level === "danger" ? 0 : 1);
  return rank(a) - rank(b) || a.date.localeCompare(b.date);
}

export function useNotices(o: ReturnType<typeof useOverall>) {
  const [read, setRead] = useState<string[]>([]);
  useEffect(() => {
    if (!o.loaded) return;
    const load = () => {
      try {
        setRead(JSON.parse(kvGet(READ_KEY) ?? "[]"));
      } catch {
        setRead([]);
      }
    };
    load();
    // ほかの場所（ベルの一覧・お知らせの画面）で既読にしたら読み直す
    window.addEventListener(READ_EVENT, load);
    return () => window.removeEventListener(READ_EVENT, load);
  }, [o.loaded]);
  const personal = useMemo(() => personalNotices(o), [o]);
  const system: Notice[] = useMemo(() => SYSTEM_NOTICES.map((n) => ({ ...n, kind: "system" as const, level: "info" as const })), []);
  // 機能のお知らせは、使い始めた日より後に出たものだけを未読にする（初めての人に更新の履歴をまとめて未読で出さない）
  const since = o.account?.createdAt?.slice(0, 10) ?? "";
  const unread = (n: Notice) => !read.includes(n.id) && !(n.kind === "system" && since && n.date <= since);
  const markRead = useCallback(
    (ids: string[]) =>
      setRead((cur) => {
        const next = [...new Set([...cur, ...ids])].slice(-300);
        kvSet(READ_KEY, JSON.stringify(next));
        setTimeout(() => window.dispatchEvent(new Event(READ_EVENT)), 0);
        return next;
      }),
    [],
  );
  const unreadCount = personal.filter(unread).length + system.filter(unread).length;
  return { personal, system, unread, markRead, unreadCount };
}
