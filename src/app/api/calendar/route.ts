import { isValidDate } from "@/domain/procedures/dates";
import { icsStamp, toICS } from "@/domain/procedures/calendar";
import { buildTasks } from "@/domain/procedures/rules";
import { decodeFeed } from "@/domain/procedures/share";

/**
 * カレンダーの購読用 URL。?d= に聞き取りの答え（名前を除く）を入れると、手続きリストを iCalendar で返す。
 * 財産を評価した結果の判定と「不要」にした手続きも ?d= に入っていれば、マイページと同じ手続きを載せる。
 * Google カレンダーや iPhone のカレンダーが、この URL を定期的に読みに来る。答えはサーバーに保存しない。
 */
export async function GET(req: Request) {
  const d = new URL(req.url).searchParams.get("d") ?? "";
  const feed = d.length <= 4000 ? decodeFeed(d) : null;
  if (!feed || !isValidDate(feed.iv.deathDate)) return new Response("invalid", { status: 400 });
  const { tasks } = buildTasks(feed.iv, { verdict: feed.verdict });
  const skip = new Set(feed.skip);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${proto}://${host}` : new URL(req.url).origin;
  const ics = toICS(
    tasks.filter((t) => !t.optional && !skip.has(t.id)),
    { name: "相続の手続き（相続コンパス）", stamp: icsStamp(), appUrl: `${origin}/my` },
  );
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="souzoku-tetsuzuki.ics"',
      "cache-control": "public, max-age=3600",
    },
  });
}
