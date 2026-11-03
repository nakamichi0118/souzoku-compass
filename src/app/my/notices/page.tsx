"use client";

import { AppShell, PageHead } from "@/components/shell/AppShell";
import { NoticeTabs } from "@/components/shell/Notices";

export default function NoticesPage() {
  return (
    <AppShell>
      <PageHead title="お知らせ" say="期限が近い手続きや、相続コンパスからのお知らせをまとめています。" />
      <div className="rounded-2xl border border-sky-100 bg-white p-2 shadow-sm">
        <NoticeTabs />
      </div>
    </AppShell>
  );
}
