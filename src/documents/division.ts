/**
 * 遺産分割協議書の文面を組み立てる（PDF化は renderDivision.ts）。
 *
 * 法定の様式はないため、一般的な記載事項（被相続人の特定、相続人全員の合意、
 * 各人が取得する財産・代償金の支払い・負担する債務、後日判明した財産の扱い、署名押印欄）を備えた文面にする。
 */
import { civilHeirIds } from "@/domain/heirs";
import type { Asset, Case } from "@/domain/types";
import { regProperty } from "@/domain/registration";
import { ageAt, wareki } from "@/forms/format";
import { propertyLines } from "./propertyLines";

export interface DivisionDoc {
  title: string;
  decedent: string[];
  preamble: string;
  articles: { heading: string; items: string[] }[];
  closing: string;
  signers: { name: string; address: string; relation: string; minor: boolean }[];
  /** 画面に出す注意事項（PDFには含めない） */
  warnings: string[];
}

const kanjiFraction = (n: number, d: number) => (n === d ? "" : `${d}分の${n}`);
const yen = (n: number) => `金${n.toLocaleString("ja-JP")}円`;

/** 家族が1人も入っていないとき（計算エンジンの止める事項と同じ文） */
export const NO_PERSONS_MESSAGE = "相続人がまだ入っていません。相続人の画面で、亡くなった方の家族を入れてください。";
/**
 * 民法上の相続人がいないとき。最初の文は計算エンジンの止める事項（相続人不存在）と同じ。
 * 遺産分割協議は相続人どうしで行うもの（民法907条）なので、協議書は作らない（相続財産清算人の手続き。民法952条）
 */
export const NO_HEIRS_MESSAGE =
  "民法上の相続人がいません（全員が相続を放棄した、または相続人になる家族がいない）。遺産分割協議をする相続人がいないため、遺産分割協議書は作れません。家庭裁判所で「相続財産清算人」を選ぶ手続きなどが必要になります。税理士にご相談ください。";

/** 財産を特定する記載 */
export function describeAsset(a: Asset): string[] {
  switch (a.kind) {
    case "land":
    case "building":
    case "condo": {
      // 登記申請書と同じ部品で、登記簿どおりの不動産の表示（地番・家屋番号など）を書く
      const p = regProperty(a);
      const head = a.kind === "land" ? "土地" : a.kind === "building" ? "建物" : `区分所有建物（${a.label}）及びその敷地権`;
      return [head, ...(p ? propertyLines(p, "（登記事項証明書のとおり）") : [`所在　${a.location}`]).map((l) => `　${l}`)];
    }
    case "deposit":
      return [`預貯金　${[a.institution ?? a.label, a.branch, a.accountType].filter(Boolean).join("　")}`, `　（相続開始日の残高及び既経過利息を含む全額）`];
    case "cash":
      return [`現金　${yen(a.amount)}`];
    case "listedStock":
      return [`上場株式　${a.label}　${a.shares.toLocaleString("ja-JP")}株`];
    case "unlistedStock":
      return [`株式　${a.label}　${a.shares.toLocaleString("ja-JP")}株`];
    case "household":
    case "other":
      return [a.label];
    default:
      return [a.label];
  }
}

export function buildDivisionDoc(c: Case): DivisionDoc {
  const warnings: string[] = [];
  const civil = civilHeirIds(c.persons);
  if (c.persons.length === 0) throw new Error(NO_PERSONS_MESSAGE);
  if (civil.size === 0) throw new Error(NO_HEIRS_MESSAGE);
  const heirs = c.persons.filter((p) => civil.has(p.id));
  const byId = new Map(c.persons.map((p) => [p.id, p]));
  const allocs = new Map(c.allocations.map((a) => [a.assetId, a]));
  const death = wareki(c.decedent.deathDate);
  const birth = wareki(c.decedent.birthDate);

  // 取得者ごとに財産をまとめる（保険金・退職金は受取人固有の財産なので分割の対象外）
  const take = new Map<string, string[][]>();
  // 相続人でない人への割り当ては、財産がいくつあっても1人につき1回だけ知らせる
  const nonHeirs = new Set<string>();
  for (const a of c.assets) {
    if (a.kind === "insurance" || a.kind === "retirement") continue;
    const al = allocs.get(a.id);
    if (!al || al.shares.length === 0) {
      warnings.push(`「${a.label}」の取得者が決まっていないため、協議書に記載していません。`);
      continue;
    }
    for (const s of al.shares) {
      if (!civil.has(s.personId)) {
        nonHeirs.add(s.personId);
        continue;
      }
      const lines = describeAsset(a);
      const part = kanjiFraction(s.numerator, s.denominator);
      if (part && a.kind === "deposit") lines[1] = `　（相続開始日の残高及び既経過利息を合わせた元利金の${part}）`;
      else if (part) lines[0] = `${lines[0]}のうち${part}${a.kind === "land" || a.kind === "building" || a.kind === "condo" ? "の持分" : ""}`;
      take.set(s.personId, [...(take.get(s.personId) ?? []), lines]);
    }
  }
  for (const id of nonHeirs) {
    warnings.push(`「${byId.get(id)?.name || "不明"}」さんは相続人ではないため、遺産分割協議では財産を取得できません（遺言による場合は遺言書に従います）。`);
  }
  const bear = new Map<string, string[]>();
  for (const d of c.debts) {
    for (const b of d.bearers) {
      if (!b.amount) continue;
      bear.set(b.personId, [...(bear.get(b.personId) ?? []), `${d.kind === "funeral" ? "葬式費用" : "債務"}　${d.label}　${yen(b.amount)}`]);
    }
  }

  const articles: DivisionDoc["articles"] = [];
  let no = 1;
  /** 相続人ごとの「次の遺産を取得する」の条の番号（代償金の条で使う） */
  const articleOf = new Map<string, number>();
  for (const h of heirs) {
    const assets = take.get(h.id);
    if (!assets) continue;
    articleOf.set(h.id, no);
    articles.push({
      heading: `第${no++}条　相続人 ${h.name} は、次の遺産を取得する。`,
      items: assets.map((lines, i) => [`(${i + 1}) ${lines[0]}`, ...lines.slice(1)].join("\n")),
    });
  }
  // 代償金（代償分割）：遺産を多く受け継ぐ人が、ほかの相続人にお金を払う約束。1件ごとに1つの条にする
  const compensationTo = new Set<string>();
  (c.compensation ?? []).forEach((x, i) => {
    const from = byId.get(x.fromId);
    const to = byId.get(x.toId);
    if (!from || !to || x.fromId === x.toId || !civil.has(x.fromId) || !civil.has(x.toId) || !Number.isSafeInteger(x.amount) || x.amount <= 0) {
      warnings.push(`代償金（${i + 1}件目）は、払う人・受け取る人（どちらも相続人）・金額がそろっていないため、協議書に記載していません。遺産の分け方の画面で確かめてください。`);
      return;
    }
    // 代償金は、遺産を受け継ぐ人がその代わりに払うもの。協議書で遺産を受け継がない人には「遺産を取得する代償として」と書けない
    const k = articleOf.get(from.id);
    if (!k) {
      warnings.push(
        `代償金（${i + 1}件目）は、払う${from.name}さんがこの協議書で遺産を受け継がないため、協議書に記載していません（遺産を受け継がない人が払うお金は、贈与として扱われることがあります）。遺産の分け方の画面で確かめてください。`,
      );
      return;
    }
    compensationTo.add(to.id);
    articles.push({
      heading: `第${no++}条　相続人 ${from.name} は、第${k}条記載の遺産を取得する代償として、相続人 ${to.name} に対し、${yen(x.amount)}を支払う。`,
      items: [],
    });
  });
  for (const h of heirs) {
    const ds = bear.get(h.id);
    if (!ds) continue;
    articles.push({
      heading: `第${no++}条　相続人 ${h.name} は、次の債務及び葬式費用を負担する。`,
      items: ds.map((d, i) => `(${i + 1}) ${d}`),
    });
  }
  articles.push({
    heading: `第${no++}条　本協議書に記載のない遺産及び後日判明した遺産については、相続人全員で別途協議して分割する。`,
    items: [],
  });

  const signers = heirs.map((h) => {
    const age = ageAt(h.birthDate, c.decedent.deathDate);
    return { name: h.name, address: h.address ?? "", relation: h.relationLabel ?? "", minor: age !== undefined && age < 18 };
  });
  for (const s of signers.filter((x) => x.minor)) {
    warnings.push(
      `${s.name}さんは未成年のため、法定代理人（親権者）が代わりに署名します。親権者も相続人である場合は、家庭裁判所で特別代理人を選任する必要があります。`,
    );
  }
  const missing = heirs.filter((h) => !take.has(h.id) && !bear.has(h.id) && !compensationTo.has(h.id));
  if (missing.length) warnings.push(`${missing.map((h) => h.name).join("、")}さんは何も取得しませんが、相続人として協議書への署名押印が必要です。`);

  return {
    title: "遺産分割協議書",
    decedent: [
      `被相続人　${c.decedent.name}`,
      birth ? `生年月日　${birth.text}` : "",
      death ? `死亡日　　${death.text}` : "",
      `最後の住所　${c.decedent.address}`,
      `本籍　　　＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿＿`,
    ].filter(Boolean),
    preamble: "上記被相続人の遺産について、相続人全員で協議を行った結果、次のとおり分割することに合意した。",
    articles,
    closing: "以上のとおり相続人全員による遺産分割協議が成立したので、これを証するため本協議書を作成し、相続人全員が署名押印のうえ各自1通を保有する。",
    signers,
    // 同じ文が重なると画面に同じ注意が並ぶので、1つにまとめる
    warnings: [...new Set(warnings)],
  };
}

