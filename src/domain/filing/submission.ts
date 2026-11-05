/**
 * 相続税の申告で税務署に出す書類の一覧（国税庁「相続税の申告のためのチェックシート」の添付書類の並びに合わせる）。
 * 申告書のあとに、戸籍 → 遺言書・遺産分割協議書 → 印鑑証明書 → マイナンバー → 特例の書類 → 財産の資料 の順に重ねる。
 */
import { DOCS } from "@/domain/procedures/documents";

/** 資料集めにはないが、提出のために撮影・アップロードする書類 */
export const EXTRA_DOCS: Record<string, string> = {
  divisionSigned: "遺産分割協議書（署名・押印したもの）",
  willCopy: "遺言書の写し",
  mynumber: "マイナンバーの確認書類（各相続人）",
  otherDoc: "その他の書類",
};

/** 書類の種類の名前（資料集めの書類か、提出用の追加の書類） */
export const docName = (id: string) => DOCS[id]?.name ?? EXTRA_DOCS[id] ?? "その他の書類";

export interface SubmitItem {
  id: string;
  label: string;
  /** この欄に入れる書類の種類 */
  docIds: string[];
  /** 相続コンパスが作る書類 */
  generated?: "forms";
  /** 原本を出す（印刷したコピーでは足りない） */
  original?: boolean;
  /** 出さなくてもよい（あれば添える） */
  optional?: boolean;
  note?: string;
}

export interface SubmitInput {
  /** 「相続税の申告」の手続きで使う書類（資料集めの id） */
  taxDocs: string[];
  /** 小規模宅地等の特例を使う */
  smallLand: boolean;
  /** 遺言書がある */
  will: boolean;
  /** 相続人が1人（遺産分割協議書も、そのための印鑑証明書も要らない） */
  soleHeir?: boolean;
}

const ASSET_DOCS = ["balanceCert", "securitiesCert", "touki", "hyokaCert", "nayose", "insurancePay", "funeralReceipt"];

export function submissionItems(x: SubmitInput): SubmitItem[] {
  const assets = ASSET_DOCS.filter((d) => x.taxDocs.includes(d) || (d === "nayose" && x.taxDocs.includes("hyokaCert")));
  return [
    { id: "forms", label: "相続税の申告書", docIds: [], generated: "forms" },
    {
      id: "family",
      label: "戸籍謄本（または法定相続情報一覧図の写し）",
      docIds: ["houteiJoho", "kosekiDecedent", "kosekiHeirs"],
      note: "亡くなった日から10日を過ぎて取ったもの",
    },
    ...(x.soleHeir
      ? x.will
        ? [{ id: "division", label: "遺言書の写し", docIds: ["willCopy"] }]
        : []
      : [
          {
            id: "division",
            label: x.will ? "遺言書の写し・遺産分割協議書の写し" : "遺産分割協議書の写し",
            docIds: x.will ? ["willCopy", "divisionSigned"] : ["divisionSigned"],
            note: "全員が署名・実印を押したもの",
          },
          { id: "inkan", label: "相続人全員の印鑑証明書", docIds: ["inkan"], original: true, note: "原本を出します（コピー不可）" },
        ]),
    { id: "mynumber", label: "マイナンバーの確認書類の写し", docIds: ["mynumber"], note: "カードの表と裏（なければ通知カード＋免許証など）" },
    ...(x.smallLand ? [{ id: "smallLand", label: "小規模宅地等の特例の書類", docIds: ["juminhyoHeir"], note: "住民票の写しなど" }] : []),
    { id: "assets", label: "財産・債務の資料の写し", docIds: [...assets, "otherDoc"], optional: true, note: "残高証明書・評価証明書など" },
  ];
}

/** 欄ごとの「そろった」：作る書類は作れるとき、それ以外は1枚でも入っているとき（あれば添える欄は数えない） */
export function itemReady(item: SubmitItem, count: (docId: string) => number, formsReady: boolean): boolean {
  if (item.generated) return formsReady;
  if (item.id === "family") return count("houteiJoho") > 0 || (count("kosekiDecedent") > 0 && count("kosekiHeirs") > 0);
  return item.docIds.some((d) => count(d) > 0);
}

/** 書類の名前・読み取った書類の種類の文から、書類の種類を当てる（当たらなければ null） */
export function guessDocId(text: string): string | null {
  const t = text.normalize("NFKC");
  const rules: [RegExp, string][] = [
    [/法定相続情報/, "houteiJoho"],
    [/印鑑(登録)?証明/, "inkan"],
    [/遺産分割協議/, "divisionSigned"],
    [/遺言書情報証明/, "willCert"],
    [/遺言/, "willCopy"],
    [/マイナンバー|個人番号|通知カード/, "mynumber"],
    [/除票|附票/, "juminhyoJokyo"],
    [/住民票/, "juminhyoHeir"],
    [/戸籍|除籍|原戸籍/, "kosekiDecedent"],
    [/(株式|証券|投資信託).*残高|残高.*(株式|証券|投資信託)/, "securitiesCert"],
    [/残高証明|預金|貯金/, "balanceCert"],
    [/評価証明|課税明細|納税通知/, "hyokaCert"],
    [/名寄/, "nayose"],
    [/登記事項|登記簿|全部事項/, "touki"],
    [/保険金|支払(明細|通知)/, "insurancePay"],
    [/葬儀|領収|お布施/, "funeralReceipt"],
    [/死亡診断|死体検案/, "deathCert"],
    [/年金/, "pensionCert"],
    [/源泉徴収/, "withholding"],
  ];
  for (const [re, id] of rules) if (re.test(t)) return id;
  return null;
}
