/**
 * 画面ごとの使い方（右上の「使い方」と、ヘルプのページで出す）。
 * 文は短く。1画面につき、ひとこと（what）と、できること（points）を3つまで。
 */
export interface HelpTopic {
  id: string;
  title: string;
  what: string;
  points: string[];
  /** この画面のパスか（いちばん先に当てはまったものを出す） */
  match: (path: string) => boolean;
}

export const HELP: HelpTopic[] = [
  {
    id: "home",
    title: "ホーム",
    what: "次にすることと、全体の進み具合が分かります。",
    points: ["「続きを進める」を押すと、次の手続きが開きます", "「手続きの流れ」で、この先の期限が分かります", "分からないことは、下のコンパスくんに聞けます"],
    match: (p) => p === "/my",
  },
  {
    id: "tasks",
    title: "やることリスト",
    what: "あなたの家族に必要な手続きを、期限の近い順に並べています。",
    points: ["一覧から選ぶと、窓口・持ち物・電話での伝え方が出ます", "済んだら「完了」、関係なければ「不要」を押します", "窓口の住所や電話番号は、ボタンで調べられます"],
    match: (p) => p.startsWith("/my/tasks"),
  },
  {
    id: "calendar",
    title: "カレンダー",
    what: "手続きの期限を、月ごとのカレンダーで見られます。",
    points: ["カレンダーからも「完了」「不要」を付けられます", "Googleカレンダーなど、いつものカレンダーに入れられます"],
    match: (p) => p.startsWith("/my/calendar"),
  },
  {
    id: "docs",
    title: "資料集め",
    what: "手続きと相続税の申告に使う書類を、種類ごとにそろえます。",
    points: ["書類ごとに、どこで・どうやって取るかが分かります", "手元にそろったらチェックを付けます", "通帳や残高証明書はアップロードすると、金額を読み取って財産に入れます"],
    match: (p) => p.startsWith("/my/docs"),
  },
  {
    id: "case",
    title: "財産と相続税",
    what: "①亡くなった方から順に入れると、相続税がかかるかを判定し、申告書まで作れます。",
    points: ["上のステップを①から順に進めます", "分からない質問は「分からない」を選ぶと、確かめ方が出ます", "判断に迷うところは、税理士に相談できます"],
    match: (p) => p.startsWith("/case/") && p !== "/case/registration" && p !== "/case/map",
  },
  {
    id: "map",
    title: "路線価図で土地を評価",
    what: "土地の場所から路線価図を探し、土地の評価額を計算します。",
    points: ["地図で土地の場所を押すと、路線価図を探します", "土地の形と道路を合わせると、評価額が出ます"],
    match: (p) => p === "/case/map",
  },
  {
    id: "papers",
    title: "書類・帳票",
    what: "入力した内容から、申告書・遺産分割協議書・登記の申請書をPDFで作ります。",
    points: ["入力を直したら、もう一度作り直します"],
    match: (p) => p.startsWith("/my/papers") || p === "/case/registration",
  },
  {
    id: "consult",
    title: "税理士への相談",
    what: "自分で決めにくいところを、税理士に相談できます。",
    points: ["入力した内容の要点を、相談の文面にまとめます"],
    match: (p) => p.startsWith("/my/consult") || p.startsWith("/consult"),
  },
];

/** ヘルプの最初に出す「進め方」 */
export const HELP_FLOW: { title: string; text: string }[] = [
  { title: "やることリスト", text: "期限の近い手続きから進めます" },
  { title: "資料集め", text: "手続きと申告に使う書類をそろえます" },
  { title: "財産と相続税", text: "相続税がかかるか判定し、申告書を作ります" },
  { title: "書類・帳票", text: "できた書類をPDFで受け取ります" },
];

export const helpFor = (path: string): HelpTopic | undefined => HELP.find((h) => h.match(path));
