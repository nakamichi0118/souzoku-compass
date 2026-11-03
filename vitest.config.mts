import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // .tsx の部品（cloud.tsx など）をテストから読み込めるように
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
