/**
 * 亡くなったあとに受け取るお金（還付金・高額療養費・家賃・配当など）が相続財産になるかを、種類と日付で決める。
 *
 * 根拠（確かめられたもの）
 * - 介護保険料・後期高齢者医療保険料の還付金、準確定申告の所得税の還付金は相続財産
 *   （国税庁「相続税の申告の誤りやすい事例集」⑦。還付請求権は死亡後に発生しても、被相続人の潜在的な請求権が死亡で顕在化したもの）。
 * - 未支給年金は、受け取る遺族の固有の権利（国税庁 質疑応答事例「未支給の国民年金に係る相続税の課税関係」、遺族の一時所得）。
 * - 亡くなった後に支給期が来る給与は相続財産（相続税法基本通達3-33）。死亡後に支給額が決まった賞与は退職手当金等（同3-32）なので相談。
 * - 家賃は、亡くなった日までに支払期日が来た未収分が相続財産。亡くなった後の期日の分は受け継いだ人の収入。
 * - 配当は、基準日が亡くなった日までなら相続財産（未収配当金・配当期待権）。
 *
 * 根拠が実務の扱いにとどまるもの（国税庁の明示の資料なし）
 * - 高額療養費・高額介護サービス費：亡くなった方が受給権者（後期高齢者・健康保険の本人・国保の世帯主）で、亡くなるまでの月の分なら相続財産として扱う。
 * - 国民健康保険料（税）の還付：保険料は世帯主にかかるため、亡くなった方が世帯主のときだけ相続財産。
 *
 * 共通：亡くなった日（当日を含む）までに受け取ったお金は、預金・現金の残高に入っているので、別には入れない。
 */
import type { ISODate } from "../types";

export type ReceivableType =
  | "kaigo"
  | "kouki"
  | "kokuho"
  | "kogakuRyoyo"
  | "kogakuKaigo"
  | "junkakutei"
  | "salary"
  | "bonus"
  | "rent"
  | "dividend"
  | "pension"
  | "funeralBenefit"
  | "other";

export interface Receivable {
  type: ReceivableType;
  /** 受け取った日（まだなら空） */
  receivedOn?: ISODate;
  /** 何の分か：高額療養費などは受診・利用した月（YYYY-MM）、家賃は支払期日、配当は基準日（YYYY-MM-DD） */
  basis?: string;
  /** 受け取る権利が亡くなった方にあるか（通知書の宛名）：本人の保険・国保の世帯主なら decedent */
  holder?: "decedent" | "other";
}

interface TypeDef {
  type: ReceivableType;
  label: string;
  /** 財産に入れるときの名前 */
  assetLabel: string;
  /** 何の分かを聞く */
  basis?: { kind: "month" | "date"; label: string };
  /** 受け取る権利が誰にあるかを聞く */
  holder?: { label: string };
}

export const RECEIVABLE_TYPES: TypeDef[] = [
  { type: "kaigo", label: "介護保険料の還付", assetLabel: "介護保険料の還付金" },
  { type: "kouki", label: "後期高齢者医療保険料の還付", assetLabel: "後期高齢者医療保険料の還付金" },
  { type: "kokuho", label: "国民健康保険料（税）の還付", assetLabel: "国民健康保険料の還付金", holder: { label: "国保の世帯主は亡くなった方" } },
  {
    type: "kogakuRyoyo",
    label: "高額療養費",
    assetLabel: "高額療養費（未収）",
    basis: { kind: "month", label: "受診した月" },
    holder: { label: "通知書の宛名が亡くなった方" },
  },
  {
    type: "kogakuKaigo",
    label: "高額介護サービス費",
    assetLabel: "高額介護サービス費（未収）",
    basis: { kind: "month", label: "介護サービスを使った月" },
    holder: { label: "通知書の宛名が亡くなった方" },
  },
  { type: "junkakutei", label: "準確定申告の所得税の還付", assetLabel: "所得税の還付金（準確定申告）" },
  { type: "salary", label: "給与（亡くなるまで働いた分）", assetLabel: "未収の給与" },
  { type: "bonus", label: "賞与（亡くなった後に額が決まった）", assetLabel: "賞与" },
  { type: "rent", label: "家賃", assetLabel: "未収の家賃", basis: { kind: "date", label: "家賃の支払期日" } },
  { type: "dividend", label: "株の配当", assetLabel: "未収の配当金", basis: { kind: "date", label: "配当の基準日" } },
  { type: "pension", label: "未支給年金", assetLabel: "未支給年金" },
  { type: "funeralBenefit", label: "葬祭費・埋葬料", assetLabel: "葬祭費・埋葬料" },
  { type: "other", label: "そのほか", assetLabel: "未収金" },
];

export const receivableType = (t: ReceivableType) => RECEIVABLE_TYPES.find((d) => d.type === t)!;

export type ReceivableVerdict =
  /** 相続財産：財産の一覧に入れる */
  | { kind: "estate"; reason: string }
  /** 相続財産ではない：入れない */
  | { kind: "notEstate"; reason: string }
  /** 亡くなる前に受け取ったので、預金・現金の残高に入っている */
  | { kind: "inBalance"; reason: string }
  /** 相続コンパスでは決めきれない */
  | { kind: "consult"; reason: string }
  /** 判定に足りない入力がある */
  | { kind: "incomplete"; need: string };

const isDate = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isMonth = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}$/.test(s) && Number(s.slice(5)) >= 1 && Number(s.slice(5)) <= 12;

export function judgeReceivable(r: Receivable, deathDate: ISODate | undefined): ReceivableVerdict {
  const def = receivableType(r.type);
  if (!def) return { kind: "incomplete", need: "種類" };
  // 相続財産にならないもの（日付によらない）
  if (r.type === "pension") return { kind: "notEstate", reason: "受け取る家族のお金です（一時所得）" };
  if (r.type === "funeralBenefit") return { kind: "notEstate", reason: "葬儀をした人が受け取るお金です" };
  if (r.type === "bonus") return { kind: "consult", reason: "亡くなった後に額が決まった賞与は、死亡退職金として扱う場合があり、判断が必要" };
  if (r.type === "other") return { kind: "consult", reason: "亡くなった後に受け取るお金が相続財産になるかは、権利がいつ・誰に生じたかによる個別の判断が必要" };

  if (!isDate(deathDate)) return { kind: "incomplete", need: "亡くなった日" };
  if (r.receivedOn) {
    if (!isDate(r.receivedOn)) return { kind: "incomplete", need: "受け取った日" };
    if (r.receivedOn <= deathDate) return { kind: "inBalance", reason: "亡くなる前に受け取った分は、預金・現金の残高に入っています" };
  }
  if (def.basis) {
    const ok = def.basis.kind === "month" ? isMonth(r.basis) : isDate(r.basis);
    if (!ok) return { kind: "incomplete", need: def.basis.label };
    const after = def.basis.kind === "month" ? r.basis! > deathDate.slice(0, 7) : r.basis! > deathDate;
    if (after) {
      if (r.type === "rent") return { kind: "notEstate", reason: "亡くなった後の期日の家賃は、受け継いだ人の収入です" };
      if (r.type === "dividend") return { kind: "notEstate", reason: "基準日が亡くなった後の配当は、株を受け継いだ人のものです" };
      return { kind: "notEstate", reason: "亡くなった後の月の分は、亡くなった方のものではありません" };
    }
  }
  if (def.holder) {
    if (!r.holder) return { kind: "incomplete", need: def.holder.label };
    if (r.holder === "other") return { kind: "notEstate", reason: r.type === "kokuho" ? "国保の保険料は世帯主にかかるため、世帯主のお金です" : "宛名の人のお金です" };
  }
  return { kind: "estate", reason: "亡くなった方が受け取るはずだったお金なので、相続財産です" };
}
