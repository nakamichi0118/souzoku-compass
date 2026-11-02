/**
 * 遺産分割協議書の文面を組み立てる（PDF化は renderDivision.ts）。
 *
 * 法定の様式はないため、一般的な記載事項（被相続人の特定、相続人全員の合意、
 * 各人が取得する財産・負担する債務、後日判明した財産の扱い、署名押印欄）を備えた文面にする。
 */
import { civilHeirIds } from "@/domain/heirs";
import type { Asset, Case } from "@/domain/types";
import { ageAt, wareki } from "@/forms/format";
import { splitLocation } from "@/forms/schedule11";

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

/** 財産を特定する記載 */
export function describeAsset(a: Asset): string[] {
  switch (a.kind) {
    case "land": {
      const l = splitLocation(a.location);
      return [
        `土地`,
        `　所在　${l.pref}${l.city}${l.town}`,
        `　地番　${l.lot || "（登記事項証明書のとおり）"}`,
        `　地目　${a.landUse}`,
        `　地積　${a.areaSqm.toFixed(2)}平方メートル`,
      ];
    }
    case "building":
      return [`建物`, `　所在　${a.location}`, `　（${a.label}）`];
    case "condo":
      return [
        `区分所有建物（${a.label}）及びその敷地権`,
        `　所在　${a.location}`,
        `　専有部分の床面積　${a.exclusiveAreaSqm.toFixed(2)}平方メートル`,
        `　敷地権の面積（持分相当）　${a.landShareSqm.toFixed(2)}平方メートル`,
      ];
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
  const heirs = c.persons.filter((p) => civil.has(p.id));
  const byId = new Map(c.persons.map((p) => [p.id, p]));
  const allocs = new Map(c.allocations.map((a) => [a.assetId, a]));
  const death = wareki(c.decedent.deathDate);
  const birth = wareki(c.decedent.birthDate);

  // 取得者ごとに財産をまとめる（保険金・退職金は受取人固有の財産なので分割の対象外）
  const take = new Map<string, string[][]>();
  for (const a of c.assets) {
    if (a.kind === "insurance" || a.kind === "retirement") continue;
    const al = allocs.get(a.id);
    if (!al || al.shares.length === 0) {
      warnings.push(`「${a.label}」の取得者が決まっていないため、協議書に記載していません。`);
      continue;
    }
    for (const s of al.shares) {
      if (!civil.has(s.personId)) {
        warnings.push(`「${byId.get(s.personId)?.name ?? "不明"}」さんは相続人ではないため、遺産分割協議では財産を取得できません（遺言による場合は遺言書に従います）。`);
        continue;
      }
      const lines = describeAsset(a);
      const part = kanjiFraction(s.numerator, s.denominator);
      if (part && a.kind === "deposit") lines[1] = `　（相続開始日の残高及び既経過利息を合わせた元利金の${part}）`;
      else if (part) lines[0] = `${lines[0]}のうち${part}${a.kind === "land" || a.kind === "building" || a.kind === "condo" ? "の持分" : ""}`;
      take.set(s.personId, [...(take.get(s.personId) ?? []), lines]);
    }
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
  for (const h of heirs) {
    const assets = take.get(h.id);
    if (!assets) continue;
    articles.push({
      heading: `第${no++}条　相続人 ${h.name} は、次の遺産を取得する。`,
      items: assets.map((lines, i) => [`(${i + 1}) ${lines[0]}`, ...lines.slice(1)].join("\n")),
    });
  }
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
  const missing = heirs.filter((h) => !take.has(h.id) && !bear.has(h.id));
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
    warnings,
  };
}

