import { isValidDate } from "@/domain/procedures/dates";
import { toICS } from "@/domain/procedures/calendar";
import { buildTasks } from "@/domain/procedures/rules";
import { decodeInterview } from "@/domain/procedures/share";

/**
 * カレンダーの購読用 URL。?d= に聞き取りの答え（名前を除く）を入れると、手続きリストを iCalendar で返す。
 * Google カレンダーや iPhone のカレンダーが、この URL を定期的に読みに来る。答えはサーバーに保存しない。
 */
export async function GET(req: Request) {
  const d = new URL(req.url).searchParams.get("d") ?? "";
  const iv = d.length <= 4000 ? decodeInterview(d) : null;
  if (!iv || !isValidDate(iv.deathDate)) return new Response("invalid", { status: 400 });
  const { tasks } = buildTasks(iv);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const origin = host ? `${proto}://${host}` : new URL(req.url).origin;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const ics = toICS(
    tasks.filter((t) => !t.optional),
    { name: "相続の手続き（相続コンパス）", stamp, appUrl: `${origin}/plan` },
  );
  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="souzoku-tetsuzuki.ics"',
      "cache-control": "public, max-age=3600",
    },
  });
}
