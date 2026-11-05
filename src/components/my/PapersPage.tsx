"use client";

import { CalendarDays, Calculator, FolderCheck, House, Scale } from "lucide-react";
import Link from "next/link";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { useOverall } from "@/lib/overall";

export function PapersPage() {
  const o = useOverall();
  if (!o.loaded) return <AppShell>{null}</AppShell>;
  const c = o.case;
  const hasRealEstate = c.assets.some((a) => a.kind === "land" || a.kind === "building" || a.kind === "condo");
  // 申告書のPDFは、計算を止める問題が1つでもあると作れない
  const blockers = o.result?.blockers ?? [];
  const papers = [
    {
      Icon: Calculator,
      title: "相続税の申告書",
      text: "国税庁の様式（令和8年分・第1表〜第15表）",
      href: "/case/documents",
      ready: !!o.result && c.assets.length > 0 && blockers.length === 0,
      need: o.filing ? "申告が必要（10か月以内）" : "申告不要の見込み（確認用に作れます）",
      todo: blockers.length > 0 ? `${blockers[0]}${blockers.length > 1 ? `（ほかに${blockers.length - 1}件あります）` : ""}` : "財産と相続人を入力すると作れます",
    },
    {
      Icon: FolderCheck,
      title: "税務署に出す書類一式",
      text: "撮影した戸籍・証明書などを提出の順に並べ、申告書と1つのPDFにします。",
      href: "/case/documents#bundle",
      ready: o.filing,
      need: "印鑑証明書は原本を同封します",
      todo: "相続税の申告がいるときに使います",
    },
    {
      Icon: Scale,
      title: "遺産分割協議書",
      text: "誰が何を受け継ぐかの書面。銀行・登記・申告で使います。",
      href: "/case/division",
      ready: c.allocations.length > 0,
      need: "相続人全員の署名と実印での押印が必要です",
      todo: "遺産分割で、財産を受け継ぐ人を決めると作れます",
    },
    {
      Icon: House,
      title: "相続登記の申請書",
      text: "名義変更の申請書と登録免許税の計算。期限：相続を知った日から3年。",
      href: "/case/registration",
      ready: hasRealEstate && c.allocations.length > 0,
      need: "提出先：法務局（郵送・オンライン可）",
      todo: "不動産を登録し、受け継ぐ人を決めると作れます",
    },
    {
      Icon: CalendarDays,
      title: "手続きの予定（カレンダー）",
      text: "期限をスマホのカレンダーに入れます（1週間前と前日に通知）",
      href: "/my/calendar",
      ready: o.valid && o.heard,
      need: "",
      todo: "質問に答えると作れます",
    },
  ];
  return (
    <AppShell>
      <PageHead title="書類・帳票" say="入力した内容からPDFを作ります。" />
      <ul className="grid gap-4 sm:grid-cols-2">
        {papers.map((p) => (
          <li key={p.title} className="flex flex-col rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <h2 className="flex items-center gap-2 text-lg font-bold text-sky-950">
                <p.Icon className="h-5 w-5 text-brand" aria-hidden />
                {p.title}
              </h2>
              {/* 作れるときはボタンで分かるので、作れないときだけ札を出す */}
              {!p.ready && <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-bold text-stone-600">準備中</span>}
            </div>
            <p className="mt-2 text-sm leading-relaxed text-stone-700">{p.text}</p>
            {(p.ready ? p.need : p.todo) && <p className="mt-2 text-xs text-stone-500">{p.ready ? p.need : p.todo}</p>}
            <Link href={p.href} className={`mt-4 self-start rounded-lg px-4 py-2 text-sm font-semibold ${p.ready ? "bg-sky-700 text-white hover:bg-sky-800" : "border border-sky-300 text-sky-800 hover:bg-sky-50"}`}>
              {p.ready ? "作成する" : "入力へ"} →
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
