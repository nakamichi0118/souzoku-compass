/** 相談を受ける税理士事務所（申告前の確認や相談のページから、相談のフォームを送る先） */
export const CONSULT_FIRM = {
  name: "アイユーコンサルティング",
  /** 公式ホームページ（空のときは出さない） */
  url: "",
  /** ロゴ画像（public 以下のパス。空のときは名前の文字で出す） */
  logo: "",
  /**
   * 事務所の画面（/firm）に入れるアカウントのメールアドレス。このアドレスで相続コンパスに登録してログインする。
   * テストの間は dxs-info。本番では info@taxlawyer328.com を加える
   */
  staffEmails: ["dxs-info@taxlawyer328.com"],
};

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県",
  "奈良県", "和歌山県", "鳥取県", "島根県", "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県",
  "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

/** 住所の先頭から都道府県を取り出す（見つからなければ空） */
export const prefectureOf = (address: string | undefined) => PREFECTURES.find((p) => (address ?? "").trim().startsWith(p)) ?? "";

export const isStaffEmail = (email: string | undefined) => !!email && CONSULT_FIRM.staffEmails.includes(email.toLowerCase());
