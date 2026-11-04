# 相続コンパス（Cloud Run 用）
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 郵便番号 → 住所の表（日本郵便の郵便番号データから作る）。取れなくてもビルドは続け、住所は手で入れてもらう
RUN npx tsx scripts/zip/build.ts || echo "郵便番号データを作れませんでした（住所の自動入力なしで続けます）"
RUN npm run build

FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOSTNAME=0.0.0.0
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/assets ./assets
USER node
EXPOSE 8080
CMD ["node", "server.js"]
