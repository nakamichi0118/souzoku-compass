import type { Case } from "@/domain/types";

/**
 * 計算を止めている事項（エンジンの blockers）から、直す場所へのリンクを決める。
 * 文の中の「〜の画面」「遺産の分け方」などの言葉と、「」で囲んだ財産・債務の名前、〇〇さん の名前から、
 * どの画面のどの行かを探す。href の focus は、開いた画面でその行まで送って目立たせるための目印（data-focus）
 */
export interface FixTarget {
  href: string;
  /** リンクの文（例：「財産で直す」） */
  label: string;
  /** 税理士への相談をすすめる事項か（直す場所のリンクと一緒に「税理士に相談する」も出す） */
  consult: boolean;
}

const SCREEN = {
  decedent: { path: "/case/decedent", label: "亡くなった方で直す" },
  heirs: { path: "/case/heirs", label: "相続人で直す" },
  assets: { path: "/case/assets", label: "財産で直す" },
  debts: { path: "/case/debts", label: "債務・葬式費用で直す" },
  division: { path: "/case/division", label: "分け方で直す" },
  consult: { path: "/consult", label: "税理士に相談する" },
} as const;
type Screen = keyof typeof SCREEN;

/** 文に出てくる、画面を名指しした言葉（先に書いたものほど優先） */
const SCREEN_WORDS: [RegExp, Screen][] = [
  [/遺産の分け方|分け方の画面/, "division"],
  [/債務・葬式費用の画面/, "debts"],
  [/相続人の画面/, "heirs"],
  [/亡くなった方の画面/, "decedent"],
  [/(財産|土地|マンション|部屋)の画面/, "assets"],
];

/** 画面の名前がないときに、内容から決める */
const TOPIC_WORDS: [RegExp, Screen][] = [
  [/代償金/, "division"],
  [/贈与/, "debts"],
  [/債務|葬式費用|負担/, "debts"],
  [/相次相続控除|令和8年（2026年）中/, "decedent"],
  [/相続人|家族の一覧|養子|国外に住所|未成年者控除|障害者控除/, "heirs"],
];

const quoted = (msg: string) => [...msg.matchAll(/「([^」]+)」/g)].map((m) => m[1]);

export function fixTarget(c: Case, msg: string): FixTarget {
  const names = quoted(msg);
  const asset = c.assets.find((a) => names.includes(a.label || "名称未入力の財産") || (!a.label && names.some((n) => /^名称未入力/.test(n))));
  const debt = c.debts.find((d) => d.label && names.includes(d.label));
  const person = c.persons.find((p) => p.name && msg.includes(`${p.name}さん`));
  const gift = msg.match(/(?:贈与)（(\d+)件目/);
  const comp = msg.match(/代償金（(\d+)件目/);

  // 名指しした画面があればそこ。なければ、名前の出てきた財産・債務、内容の順に決める
  let screen: Screen | undefined = SCREEN_WORDS.find(([re]) => re.test(msg))?.[1];
  // 債務・葬式費用を負担する人は、遺産の分け方で決める
  if (!screen && /負担する人/.test(msg)) screen = "division";
  if (!screen && asset) screen = "assets";
  if (!screen && debt) screen = "debts";
  if (!screen) screen = TOPIC_WORDS.find(([re]) => re.test(msg))?.[1];
  if (!screen && person) screen = "heirs";
  if (!screen) screen = "consult";

  const focus = (() => {
    switch (screen) {
      case "assets":
        return asset ? `asset-${asset.id}` : undefined;
      case "division":
        if (comp) return `comp-${Number(comp[1]) - 1}`;
        if (asset) return `asset-${asset.id}`;
        if (debt) return `debt-${debt.id}`;
        return undefined;
      case "debts":
        if (gift) return `gift-${Number(gift[1]) - 1}`;
        if (debt) return `debt-${debt.id}`;
        return undefined;
      case "heirs":
        return person ? `person-${person.id}` : undefined;
      case "decedent":
        if (/相続時精算課税/.test(msg) && !/贈与の一覧/.test(msg)) return "settlementGift";
        if (/相次相続控除/.test(msg)) return "priorInheritance";
        if (/令和8年/.test(msg)) return "deathDate";
        return undefined;
      default:
        return undefined;
    }
  })();
  const s = SCREEN[screen];
  // 財産の画面は ?asset= でその財産を開く（地図から戻ったときと同じ）
  const q = screen === "assets" && asset ? `?asset=${encodeURIComponent(asset.id)}` : focus ? `?focus=${encodeURIComponent(focus)}` : "";
  return { href: `${s.path}${q}`, label: s.label, consult: screen !== "consult" && /税理士/.test(msg) };
}
