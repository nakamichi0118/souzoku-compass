import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "相続コンパス",
  description: "身近な人が亡くなった後の手続きと期限、相続税がかかるかが分かり、申告書と遺産分割協議書までつくれるWebアプリ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">{children}</body>
    </html>
  );
}
