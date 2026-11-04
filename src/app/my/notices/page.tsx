"use client";

import { AppShell, PageHead } from "@/components/shell/AppShell";
import { NoticeTabs } from "@/components/shell/Notices";

export default function NoticesPage() {
  return (
    <AppShell>
      {/* 吹き出しはタブの名前と同じことを言うので出さない */}
      <PageHead title="お知らせ" />
      <div className="rounded-2xl border border-sky-100 bg-white p-2 shadow-sm">
        <NoticeTabs />
      </div>
    </AppShell>
  );
}
