import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloud Run 用に、実行に必要なファイルだけをまとめる
  output: "standalone",
  // 申告書PDFの作成でサーバーが読む様式画像・フォント
  outputFileTracingIncludes: {
    "/api/forms": ["./public/forms/**/*", "./assets/fonts/**/*"],
    "/api/division": ["./assets/fonts/**/*"],
  },
};

export default nextConfig;
