"use client";

import { AskCompass, useAsk } from "@/components/compass/AskCompass";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bubble, CompassAvatar } from "@/components/compass/CompassKun";
import { Reader } from "@/components/extract/Reader";
import { OfficeLookup } from "@/components/plan/OfficeLookup";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { Panel } from "@/components/ui/Panel";
import { jpDate } from "@/domain/procedures/dates";
import { DOCS, type DocCategory } from "@/domain/procedures/documents";
import { useOverall, useRequireHearing, type DocItem } from "@/lib/overall";
import { usePlan, type ItemStatus } from "@/lib/planStore";
import { CatIcon } from "./icons";
import { showBelowHeader } from "./scroll";
import { RowStatus } from "./StatusButtons";

/** 亡くなった方の住所で請求先が決まる書類 */
const LOOKUP = new Set(["juminhyoJokyo", "hyokaCert", "nayose", "houteiJoho"]);
const ORDER: DocCategory[] = ["戸籍・住民票", "預貯金", "保険", "不動産", "株式", "年金・税金", "その他"];

/** 書類のカードの id（「今集めるべき書類」から、同じ書類をもう一度押したときに探す） */
export const docAnchor = (id: string) => `doc-${id}`;

function DocCard({ item, address, open, onOpen, focus }: { item: DocItem; address: string; open: boolean; onOpen: (v: boolean) => void; focus: boolean }) {
  const { setStatus } = usePlan();
  const doc = DOCS[item.id];
  const key = `doc:${item.id}`;
  const ref = useRef<HTMLLIElement>(null);
  // 開いた書類は画面より長いので、名前とチェックが見えるよう、先頭を上の見出しのすぐ下に出す
  useEffect(() => {
    if (focus) showBelowHeader(() => ref.current);
  }, [focus]);
  const setSt = (v: ItemStatus) => {
    setStatus(key, v);
    // 読み取れる書類は、そろったらアップロードを促す
    if (v === "done" && doc.readable) onOpen(true);
  };
  const st: ItemStatus = item.done ? "done" : item.na ? "na" : "open";
  return (
    <li ref={ref} id={docAnchor(item.id)} className={`rounded-xl border bg-white ${focus ? "border-sky-500 ring-2 ring-sky-100" : item.done ? "border-emerald-200" : "border-stone-200"}`}>
      <div className="flex items-start gap-3 p-4">
        <span className="-mt-1.5">
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
          {doc.readable && <Reader docId={item.id} onRegistered={() => setStatus(key, "done")} />}
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
  // 聞き取りが済んでいなければトップへ戻す（移動は描画のあとに行う）
  const ready = useRequireHearing(o);

  if (!ready) return <AppShell>{null}</AppShell>;
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
          <Reader />
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
                        // もう選んである書類は、URLが変わらずカードも動かないので、ここで送る
                        if (focus === d.id) showBelowHeader(() => document.getElementById(docAnchor(d.id)));
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
                    <Link href="/case/assets" className="shrink-0 py-1.5 text-xs font-semibold text-sky-700 hover:underline">
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
