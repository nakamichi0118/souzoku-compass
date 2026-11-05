/**
 * 「進めない」ところの画面の確かめ（ブラウザで実際に動かす）。開発サーバーを立ててから動かす：
 *   npx next dev -p 3100 &  BASE=http://localhost:3100 node scripts/e2e/gates.mjs [スクリーンショットの出力先]
 * デモ（架空の家族）に入り、ブラウザの保存に止まる入力の相続を入れて、次を確かめる。
 *  1. 税額の確認：止まる事項ごとに「〜で直す」リンクがあり、押すとその行へ送って枠で目立たせる
 *  2. 書類の作成：止まる事項があると申告書のボタンは押せず、理由を1行で出す
 *  3. 財産：形がいびつな土地は「入力待ち」にならず評価額を出し、相談する・しないを選べる
 *  4. 小規模宅地：答え始めて取得する人がいないと「あと少し」と未回答の印を出す
 *  5. 聞き取り：飛ばした質問に「未回答」の印、下の帯のリンクで未回答へ送る
 */
import path from "node:path";
import { createRequire } from "node:module";

// playwright はこのリポジトリの依存ではなく、環境に入っているものを使う
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = process.env.BASE || "http://localhost:3100";
const OUT = process.argv[2] || "";
const KEY = "souzoku-compass:case:v1";

const people = [
  { id: "sp", name: "架空 花子", relation: "spouse", birthDate: "1955-05-05" },
  { id: "c1", name: "架空 一郎", relation: "child", birthDate: "1985-08-08" },
];
const blocked = {
  title: "テスト",
  decedent: { name: "架空 太郎", deathDate: "2026-04-10", address: "東京都千代田区架空町1-2-3", birthDate: "1950-01-01" },
  persons: people,
  assets: [
    { id: "dep", kind: "deposit", label: "架空銀行 普通預金", amount: 30000000 },
    { id: "ins", kind: "insurance", label: "架空生命 死亡保険金", amount: 3000000, recipientId: "" },
    {
      id: "land",
      kind: "land",
      label: "自宅の土地",
      location: "千葉県船橋市架空町",
      areaSqm: 200,
      landUse: "宅地",
      condition: "irregular",
      method: { type: "rosenka", routePrice: 150000, depthCorrection: 1 },
      smallResidential: { applies: false, check: { ownHome: "yes" } },
    },
  ],
  debts: [],
  priorGifts: [],
  allocations: [{ assetId: "land", shares: [{ personId: "sp", numerator: 1, denominator: 1 }] }],
};

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "OK  " : "NG  "} ${name}${extra ? `  (${extra})` : ""}`);
};
const shot = async (page, name) => OUT && page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: OUT ? 2 : 1 });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/demo`);
  await page.waitForURL(/\/my$/, { timeout: 60000 });
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(blocked)]);

  // 1. 税額の確認 → 直すリンク
  await page.goto(`${BASE}/case/tax`);
  const list = page.getByTestId("blockers");
  await list.waitFor({ timeout: 30000 });
  const links = await list.getByRole("link").allTextContents();
  check("税額の確認に、止まる事項ごとの直すリンクが出る", links.some((t) => t.includes("分け方で直す")) && links.some((t) => t.includes("財産で直す")), links.join(" / "));
  await shot(page, "1_tax_blockers");
  await list.getByRole("link", { name: /分け方で直す/ }).first().click();
  await page.waitForURL(/\/case\/division/);
  const flashed = await page
    .waitForFunction(() => document.querySelector('[data-focus^="asset-"].ring-4'), null, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check("分け方で直す → その財産の行を枠で目立たせる", flashed);
  await shot(page, "2_division_flash");

  await page.goto(`${BASE}/case/tax`);
  await page.getByTestId("blockers").getByRole("link", { name: /財産で直す/ }).first().click();
  await page.waitForURL(/\/case\/assets\?asset=/);
  const opened = await page
    .waitForFunction(() => document.querySelector('[data-focus="asset-ins"] [aria-expanded="true"]'), null, { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  check("財産で直す → その財産（保険金）を開く", opened);

  // 2. 書類の作成
  await page.goto(`${BASE}/case/documents`);
  const btn = page.getByRole("button", { name: "申告書PDFをダウンロード" });
  await btn.waitFor();
  check("止まる事項があると申告書のボタンは押せない", await btn.isDisabled());
  check("押せない理由を1行で出す", (await page.getByText("ページ上の事項を直すと作れます。").count()) > 0);
  await shot(page, "3_documents");

  // 3. 形がいびつな土地は止めない
  await page.goto(`${BASE}/case/assets?asset=land`);
  await page.locator("[data-reduction]").waitFor({ timeout: 10000 });
  const row = await page.locator('[data-focus="asset-land"] button[aria-expanded]').first().innerText();
  check("形がいびつな土地も評価額を出す（入力待ちにしない）", !row.includes("入力待ち") && /30,000,000円/.test(row), row.replace(/\s+/g, " "));
  check("相談する・しないを選べる", (await page.getByRole("button", { name: "相談しない" }).count()) > 0);

  // 4. 小規模宅地：答え始めたのに取得する人がいない
  const srHint = page.getByText(/あと少し：/);
  check("小規模宅地：取得する人がいないと「あと少し」と出す", (await srHint.count()) > 0, (await srHint.first().innerText().catch(() => "")).slice(0, 40));
  await srHint.first().scrollIntoViewIfNeeded();
  await shot(page, "4_land_reduction_sr");

  // 5. 聞き取り：飛ばした質問
  await page.evaluate(() => {
    localStorage.setItem("souzoku-compass:answered:v1", JSON.stringify(["stage", "spouse"]));
  });
  await page.goto(`${BASE}/my/hearing`);
  await page.locator("#hearing-finish").waitFor({ timeout: 30000 });
  const marked = await page.locator("[data-missing]").count();
  check("聞き取り：飛ばした質問に未回答の印", marked >= 1, `${marked}件`);
  await page.getByRole("button", { name: /選んでいない質問があと/ }).click();
  await page.waitForTimeout(800);
  const all = await page.locator("[data-missing]").count();
  check("「あとN問」を押すと、未回答すべてに印をつけて送る", all > marked, `${all}件`);
  await shot(page, "5_hearing_missing");

  await browser.close();
  const ng = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - ng}/${results.length} OK`);
  process.exit(ng ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
