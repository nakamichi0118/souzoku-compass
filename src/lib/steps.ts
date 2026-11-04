// title：ページの見出し・前後のボタン。short：ステップの帯（パソコンでも1行に収まる短い名前）
export const STEPS = [
  { slug: "decedent", title: "亡くなった方", short: "亡くなった方" },
  { slug: "heirs", title: "相続人", short: "相続人" },
  { slug: "assets", title: "財産", short: "財産" },
  { slug: "debts", title: "債務・葬式費用", short: "債務・葬式費用" },
  { slug: "review", title: "申告前の確認", short: "確認" },
  { slug: "division", title: "遺産の分け方", short: "分け方" },
  { slug: "tax", title: "税額の確認", short: "税額" },
  { slug: "documents", title: "書類の作成", short: "書類" },
] as const;
export type StepSlug = (typeof STEPS)[number]["slug"];
export const stepIndex = (slug: string) => STEPS.findIndex((s) => s.slug === slug);
