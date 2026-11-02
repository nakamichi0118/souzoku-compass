import type { Metadata } from "next";
import "./globals.css";
import { CaseProvider } from "@/lib/store";
import { PlanProvider } from "@/lib/planStore";

export const metadata: Metadata = {
  title: "相続コンパス",
  icons: { icon: "/brand/compass-logo-mark.png" },
  description: "身近な人が亡くなった後の手続きと期限、相続税がかかるかが分かり、申告書と遺産分割協議書までつくれるWebアプリ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">
        <CaseProvider>
          <PlanProvider>{children}</PlanProvider>
        </CaseProvider>
      </body>
    </html>
  );
}
