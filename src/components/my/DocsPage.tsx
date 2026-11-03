"use client";

import { AskCompass, useAsk } from "@/components/compass/AskCompass";
import { Upload } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bubble, CompassAvatar } from "@/components/compass/CompassKun";
import { OfficeLookup } from "@/components/plan/OfficeLookup";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { fmt } from "@/components/ui";
import { jpDate } from "@/domain/procedures/dates";
import { DOCS, type DocCategory } from "@/domain/procedures/documents";
import { TARGET_LABEL, applyExtracted, destination, findSame, missingItems, refExists, useExtract, type ExtractedAsset, type Ref } from "@/lib/extract";
import { useOverall, type DocItem } from "@/lib/overall";
import type { ItemStatus } from "@/lib/planStore";
import { useCase } from "@/lib/store";
import { Panel } from "./Home";
import { CatIcon } from "./icons";
import { RowStatus } from "./StatusButtons";

/** 亡くなった方の住所で請求先が決まる書類 */
const LOOKUP = new Set(["juminhyoJokyo", "hyokaCert", "nayose", "houteiJoho"]);
const SAMPLE: Record<string, { url: string; name: string }> = {
  balanceCert: { url: "/demo/zandaka-sample.pdf", name: "残高証明書（見本）.pdf" },
};
const ORDER: DocCategory[] = ["戸籍・住民票", "預貯金", "保険", "不動産", "株式", "年金・税金", "その他"];

/** 書類から読み取った値のうち、原本と見比べる主な項目 */
function fields(x: ExtractedAsset): [string, string][] {
  const yen = (n: number | null | undefined) => (n != null ? `${fmt(n)}円` : null);
  const rows: [string, string | null][] = [
    ["金融機関・会社", [x.institution, x.branch, x.accountType].filter(Boolean).join(" ") || null],
    ["所在", x.location],
    ["地番・家屋番号", [x.lotNumber, x.houseNumber].filter(Boolean).join(" ") || null],
    ["面積", x.areaSqm ? `${x.areaSqm}㎡` : null],
    [x.kind === "debt" ? "債務の額" : x.kind === "funeral" ? "葬儀費用" : x.kind === "gift" ? "贈与の額" : "金額", yen(x.amount)],
    ["既経過利息", yen(x.accruedInterest)],
    ["固定資産税評価額", yen(x.fixedAssetValue)],
    ["路線価", x.routePrice ? `${fmt(x.routePrice)}円/㎡` : null],
    ["株数", x.shares ? `${fmt(x.shares)}株` : null],
    ["4つの価格", x.prices ? [x.prices.close, x.prices.monthAvg, x.prices.prevMonthAvg, x.prices.prev2MonthAvg].map((v) => (v ? fmt(v) : "—")).join("・") + "円" : null],
    ["専有面積・敷地権", x.condo ? `${x.condo.exclusiveAreaSqm ?? "—"}㎡・${x.condo.landShareSqm ?? "—"}㎡` : null],
    ["築年数・階", x.condo ? `${x.condo.builtYears ?? "—"}年${x.condo.builtMonths ? `${x.condo.builtMonths}か月` : ""}・${x.condo.totalFloors ?? "—"}階建ての${x.condo.floor ?? "—"}階` : null],
    [x.kind === "insurance" ? "受取人" : x.kind === "gift" ? "受け取った人" : x.kind === "debt" || x.kind === "funeral" ? "負担した人" : "人", x.personName ?? null],
    ["納めた贈与税", x.kind === "gift" ? yen(x.giftTaxPaid) : null],
    ["日付", x.date],
  ];
  return rows.filter((r): r is [string, string] => !!r[1]);
}

/** アップロードした書類をコンパスくんが読み取り、確認してから財産・債務・贈与に登録する */
export function Reader({ docId, onRegistered }: { docId?: string; onRegistered: () => void }) {
  const { data: c, update } = useCase();
  const ex = useExtract();
  // 書類ごとに、登録した項目を候補の番号で覚える（別の書類を読んだら消える）
  const [done, setDone] = useState<Record<number, Ref>>({});
  const [readId, setReadId] = useState(0);
  useEffect(() => setDone({}), [readId]);
  const sample = docId ? SAMPLE[docId] : undefined;
  const register = (x: ExtractedAsset, i: number, replace?: Ref) => {
    const r = applyExtracted(c, x, replace);
    update(() => r.next);
    setDone((d) => ({ ...d, [i]: r.ref }));
    onRegistered();
  };
  const read = (f: File) => {
    setReadId((n) => n + 1);
    void ex.read(f);
  };
  return (
    <div className="rounded-xl border-2 border-dashed border-teal-400 bg-teal-50/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">
          <Upload className="h-4 w-4" aria-hidden />
          {ex.busy ? "コンパスくんが読み取り中…" : "写真・PDFをアップロード"}
          <input
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            disabled={ex.busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) read(f);
            }}
          />
        </label>
        {sample && (
          <button
            type="button"
            disabled={ex.busy}
            onClick={() => {
              setReadId((n) => n + 1);
              void ex.readSample(sample.url, sample.name);
            }}
            className="rounded-lg border border-teal-600 bg-white px-3 py-2 text-sm text-teal-800 hover:bg-teal-50"
          >
            見本の書類で試す
          </button>
        )}
        {sample && (
          <a href={sample.url} target="_blank" rel="noreferrer" className="text-xs text-teal-800 underline">
            見本を開く
          </a>
        )}
      </div>
      <p className="mt-2 text-xs text-stone-500">金額や名前をコンパスくんが読み取ります。財産・債務・葬式費用・贈与のどこに入るかも振り分けます。登録する前に、必ず書類と見比べてください。</p>
      {ex.err && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{ex.err}</p>}
      {ex.res && (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-semibold text-stone-700">
            読み取った書類：{ex.res.documentType}
            {ex.file ? `（${ex.file}）` : ""}
          </p>
          {ex.res.assets.length === 0 && <p className="text-sm text-stone-600">財産・債務の情報は見つかりませんでした。</p>}
          {ex.res.assets.map((x, i) => {
            const same = findSame(x, c);
            const mine = done[i] && refExists(c, done[i]) ? done[i] : undefined;
            const missing = missingItems(x, c.persons);
            const dest = destination(x.kind);
            const sameLabel = same && "id" in same ? (same.type === "asset" ? c.assets.find((a) => a.id === same.id)?.label : c.debts.find((d) => d.id === same.id)?.label) : "登録済みの贈与";
            return (
              <div key={`${readId}-${i}`} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-bold text-stone-900">
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] text-brand">{TARGET_LABEL[x.kind]}</span>
                  {x.label}
                </p>
                <table className="mt-2 w-full text-left">
                  <tbody>
                    {fields(x).map(([k, v]) => (
                      <tr key={k} className="border-t border-stone-100">
                        <th className="w-32 py-1 pr-2 align-top text-xs font-medium text-stone-500">{k}</th>
                        <td className="py-1 font-semibold tabular-nums text-stone-900">{v}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <details className="mt-1 text-xs text-stone-500">
                  <summary className="cursor-pointer">読み取った箇所</summary>
                  <p className="mt-1">「{x.evidence}」</p>
                </details>
                {missing.length > 0 && <p className="mt-1 text-xs text-orange-700">書類からは分からないため、登録後に入れてください：{missing.join("、")}。入れるまで「確認待ち」として扱い、税額は確定しません。</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {mine ? (
                    <span className="font-semibold text-emerald-700">✓ {dest}に登録しました</span>
                  ) : same ? (
                    <>
                      <span className="text-stone-700">登録済みの「{sameLabel}」と同じもののようです。</span>
                      <button type="button" onClick={() => register(x, i, same)} className="rounded-lg bg-sky-700 px-3 py-1.5 font-semibold text-white hover:bg-sky-800">
                        読み取った内容で更新
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setDone((d) => ({ ...d, [i]: same }));
                          onRegistered();
                        }}
                        className="rounded-lg border border-stone-300 px-3 py-1.5 hover:bg-stone-50">
                        内容は同じ（資料がそろったことにする）
                      </button>
                      <button type="button" onClick={() => register(x, i)} className="px-2 py-1.5 text-xs text-stone-600 underline">
                        別のものとして追加
                      </button>
                    </>
                  ) : (
                    <button type="button" onClick={() => register(x, i)} className="rounded-lg bg-sky-700 px-3 py-1.5 font-semibold text-white hover:bg-sky-800">
                      確認して{dest}に登録
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {ex.res.notes.map((n) => (
            <p key={n} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {n}
            </p>
          ))}
          {Object.keys(done).length > 0 && (
            <div className="flex flex-wrap gap-3 text-sm">
              <Link href="/case/assets" className="text-sky-800 underline">
                財産の一覧を見る ›
              </Link>
              <Link href="/case/debts" className="text-sky-800 underline">
                債務・葬式費用・贈与を見る ›
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DocCard({ item, address, open, onOpen, focus }: { item: DocItem; address: string; open: boolean; onOpen: (v: boolean) => void; focus: boolean }) {
  const o = useOverall();
  const doc = DOCS[item.id];
  const key = `doc:${item.id}`;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);
  const setSt = (v: ItemStatus) => {
    o.setStatus(key, v);
    // 読み取れる書類は、そろったらアップロードを促す
    if (v === "done" && doc.readable) onOpen(true);
  };
  const st: ItemStatus = item.done ? "done" : item.na ? "na" : "open";
  return (
    <li ref={ref} className={`rounded-xl border bg-white ${focus ? "border-sky-500 ring-2 ring-sky-100" : item.done ? "border-emerald-200" : "border-stone-200"}`}>
      <div className="flex items-start gap-3 p-4">
        <span className="mt-0.5">
          <RowStatus status={st} onChange={setSt} label={doc.name} />
        </span>
        <button type="button" onClick={() => onOpen(!open)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <p className={`font-bold ${item.done || item.na ? "text-stone-500" : "text-stone-900"}`}>
            {doc.name}
            {doc.readable && <span className="ml-2 rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-800">読み取りできます</span>}
          </p>
          <p className="mt-0.5 text-xs text-stone-500">使う手続き：{item.used.map((t) => t.title).join("／")}</p>
        </button>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${item.done ? "bg-emerald-100 text-emerald-800" : item.na ? "bg-stone-200 text-stone-600" : "bg-stone-100 text-stone-600"}`}>{item.done ? "✓ そろった" : item.na ? "不要" : "まだ"}</span>
      </div>
      {open && (
        <div className="space-y-3 border-t border-stone-100 px-4 py-4 text-sm leading-relaxed text-stone-700 sm:pl-12">
          {item.done && doc.readable && (
            <div className="flex items-start gap-2">
              <CompassAvatar size={36} />
              <Bubble>そろいましたね！書類をアップロードすると、ボクが金額を読み取って財産に登録します。</Bubble>
            </div>
          )}
          {doc.readable && <Reader docId={item.id} onRegistered={() => o.setStatus(key, "done")} />}
          <p>{doc.purpose}</p>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[6rem_1fr]">
            <dt className="font-semibold text-stone-500">どこに請求</dt>
            <dd>{doc.where}</dd>
            <dt className="font-semibold text-stone-500">請求の方法</dt>
            <dd>{doc.how.join("／")}</dd>
            {doc.need.length > 0 && (
              <>
                <dt className="font-semibold text-stone-500">必要なもの</dt>
                <dd>{doc.need.join("、")}</dd>
              </>
            )}
            <dt className="font-semibold text-stone-500">手数料</dt>
            <dd>{doc.fee}</dd>
          </dl>
          {doc.tip && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">{doc.tip}</p>}
          {doc.office && address && LOOKUP.has(doc.id) && (
            <OfficeLookup kind={doc.office} address={address} forProperty={doc.id === "hyokaCert" || doc.id === "nayose"} dept={doc.office === "city" ? `${doc.name}の請求窓口` : undefined} />
          )}
        </div>
      )}
    </li>
  );
}

export function DocsPage() {
  const o = useOverall();
  const params = useSearchParams();
  const router = useRouter();
  const focus = params.get("id");
  const [opened, setOpened] = useState<Record<string, boolean>>({});
  const [cat, setCat] = useState<DocCategory | "すべて">("すべて");
  useEffect(() => {
    if (focus) setOpened((x) => ({ ...x, [focus]: true }));
  }, [focus]);
  const docsContext = useCallback(
    () => [`亡くなった日：${o.iv.deathDate}`, "集める書類：", ...o.docs.map((d) => `- ${DOCS[d.id].name}${d.done ? "（済）" : d.na ? "（不要）" : ""}`)].join("\n"),
    [o.iv.deathDate, o.docs],
  );
  const ask = useAsk("docs", docsContext);

  if (!o.loaded) return <AppShell>{null}</AppShell>;
  if (!o.heard || !o.valid) {
    router.replace("/my");
    return <AppShell>{null}</AppShell>;
  }
  const cats = ORDER.filter((k) => o.byCategory.has(k));
  // 期限の早い手続きで使う、まだそろっていない書類
  const soon = [...o.docs].filter((d) => !d.done && !d.na).sort((a, b) => (a.used[0]?.date ?? "").localeCompare(b.used[0]?.date ?? "")).slice(0, 4);
  const shown = cat === "すべて" ? cats : [cat];

  return (
    <AppShell wide>
      <PageHead
        title="資料集め"
        say={
          <>
            あなたの手続きで必要な書類は <strong>{o.docs.length}種類</strong>、そろったのは {o.doneDocs}種類です。残高証明書などはアップロードすると、ボクが読み取ります！
          </>
        }
      />
      <ul className="mb-5 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {cats.map((k) => {
          const items = o.byCategory.get(k) ?? [];
          const live = items.filter((d) => !d.na);
          const n = live.filter((d) => d.done).length;
          return (
            <li key={k}>
              <button type="button" onClick={() => setCat(cat === k ? "すべて" : k)} className={`w-full rounded-xl border p-3 text-center ${cat === k ? "border-sky-500 bg-sky-50" : "border-sky-100 bg-white hover:bg-sky-50/50"}`}>
                <CatIcon k={k} className="mx-auto h-6 w-6" />
                <p className="text-sm font-semibold text-stone-800">{k}</p>
                <p className={`text-xs tabular-nums ${n === live.length ? "font-bold text-emerald-700" : "text-stone-500"}`}>{n === live.length ? "✓ そろった" : `${n}/${live.length}`}</p>
              </button>
            </li>
          );
        })}
      </ul>

      <details className="mb-5 rounded-xl border border-teal-200 bg-white p-4">
        <summary className="cursor-pointer font-bold text-teal-900">どの書類でもアップロードして読み取る（葬儀の領収書・税金の通知書・贈与の契約書など）</summary>
        <div className="mt-3">
          <Reader onRegistered={() => {}} />
        </div>
      </details>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {shown.map((k) => (
            <section key={k}>
              <h2 className="mb-2 flex items-center gap-2 font-bold text-sky-950">
                <CatIcon k={k} className="h-5 w-5" /> {k}
              </h2>
              <ul className="space-y-2">
                {(o.byCategory.get(k) ?? []).map((d) => (
                  <DocCard key={d.id} item={d} address={o.iv.address} open={!!opened[d.id]} onOpen={(v) => setOpened((x) => ({ ...x, [d.id]: v }))} focus={focus === d.id} />
                ))}
              </ul>
            </section>
          ))}
          <p className="text-xs text-stone-500">手数料・請求方法は一般的な目安です。自治体や金融機関によって異なります。</p>
        </div>
        <div className="space-y-5">
          <Panel title="今集めるべき書類">
            {soon.length === 0 ? (
              <p className="text-sm text-emerald-700">すべてそろいました！</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {soon.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setCat("すべて");
                        setOpened((x) => ({ ...x, [d.id]: true }));
                        router.replace(`/my/docs?id=${d.id}`, { scroll: false });
                      }}
                      className="block w-full rounded-lg px-2 py-1 text-left hover:bg-stone-50"
                    >
                      <span className="block font-semibold text-stone-800">{DOCS[d.id].name}</span>
                      <span className="text-xs text-stone-500">
                        {d.used[0] ? `「${d.used[0].title}」（${jpDate(d.used[0].date)}）で使います` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="ほかに財産はありませんか？">
            <p className="text-sm text-stone-600">聞き取りで答えなかった財産が見つかったら、登録してください。必要な手続きと書類がここに自動で追加されます。</p>
            <ul className="mt-2 space-y-1 text-sm">
              {[
                ["預貯金（ネット銀行・ゆうちょも）", o.iv.deposits > 0],
                ["株式・投資信託", o.iv.securities > 0],
                ["生命保険金", o.iv.insurance > 0],
                ["土地・建物（自宅以外も）", o.iv.homeValue + o.iv.otherRealEstate > 0],
              ]
                .filter(([, has]) => !has)
                .map(([label]) => (
                  <li key={String(label)} className="flex items-center justify-between gap-2">
                    <span className="text-stone-700">{label}</span>
                    <Link href="/case/assets" className="shrink-0 text-xs font-semibold text-sky-700 hover:underline">
                      見つかったら登録 ›
                    </Link>
                  </li>
                ))}
            </ul>
            <p className="mt-2 text-xs text-stone-500">見落としやすいもの：郵便物・通帳・スマホのアプリ、市区町村の「名寄帳」で分かる土地、証券保管振替機構への照会で分かる株式。</p>
          </Panel>
          <Panel title="コンパスくんのおすすめ">
            <ul className="list-disc space-y-2 pl-4 text-sm leading-relaxed text-stone-700">
              <li>戸籍は「広域交付」を使うと、最寄りの役所で亡くなった方の出生から死亡までをまとめて取れます。</li>
              <li>「法定相続情報一覧図」を法務局で作ると、銀行や登記で戸籍の束の代わりに使えて便利です（無料）。</li>
              <li>残高証明書は「亡くなった日現在」で、既経過利息も一緒に書いてもらうよう頼みましょう。</li>
              <li>固定資産評価証明書は、相続登記の登録免許税の計算にも使います。</li>
            </ul>
          </Panel>
        </div>
      </div>
      <div className="mt-6">
        <AskCompass state={ask} placeholder="例：除籍謄本と改製原戸籍はどう違う？" />
      </div>
    </AppShell>
  );
}
