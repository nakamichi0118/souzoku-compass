import Link from "next/link";

/** マイページの白い枠（見出しと「詳しく見る」リンク付き） */
export function Panel({ title, more, children }: { title: string; more?: { href: string; label?: string }; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-sky-100 bg-white p-5 shadow-sm">
      {/* スマホで幅が足りないときは、リンクを縮めず見出しの右下へ回す（言葉の途中で折り返さない） */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <h2 className="font-bold text-sky-950">{title}</h2>
        {more && (
          <Link href={more.href} className="-my-1.5 ml-auto shrink-0 whitespace-nowrap py-1.5 text-sm text-sky-700 hover:underline">
            {more.label ?? "詳しく見る"} ›
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
