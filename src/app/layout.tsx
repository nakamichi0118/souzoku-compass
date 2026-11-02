import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "相続コンパス",
  description: "相続税の専門知識がなくても、Claudeの案内で相続税申告書と遺産分割協議書をつくれるWebアプリ",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-stone-50 text-stone-900 antialiased">{children}</body>
    </html>
  );
}
