"use client";

import { ChevronDown } from "lucide-react";
import { useCase } from "@/lib/store";
import { DOC_OF, assetHasDoc, assetsMissingDoc } from "@/lib/assetDocs";
import { useCompassTopic } from "@/lib/compassChat";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bubble, CompassAvatar } from "@/components/compass/CompassKun";
import { Reader } from "@/components/extract/Reader";
import { AutoSort } from "@/components/docs/AutoSort";
import { DocFiles } from "@/components/docs/DocFiles";
import { OfficeLookup } from "@/components/plan/OfficeLookup";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { Panel } from "@/components/ui/Panel";
import { jpDate, yearOf } from "@/domain/procedures/dates";
import { DOCS, type DocCategory } from "@/domain/procedures/documents";
import { useOverall, useRequireHearing, type DocItem } from "@/lib/overall";
import { usePlan, type ItemStatus } from "@/lib/planStore";
import { CatIcon } from "./icons";
import { showBelowHeader } from "./scroll";
import { RowStatus } from "./StatusButtons";

/** 亡くなった方の住所で請求先が決まる書類 */
const LOOKUP = new Set(["juminhyoJokyo", "hyokaCert", "nayose", "houteiJoho"]);
/** 財産の書類の種類（そろったら相続税の判定へ誘う） */
const ASSET_CATS: DocCategory[] = ["預貯金", "保険", "不動産", "株式"];
const ORDER: DocCategory[] = ["戸籍・住民票", "預貯金", "保険", "不動産", "株式", "年金・税金", "その他"];

/** 今年なら「3月24日（火）」、違う年なら「2027年1月15日（金）」 */
const shortDate = (d: string, today: string) => (yearOf(d) === yearOf(today) ? jpDate(d).replace(/^\d+年/, "") : jpDate(d));

/** 書類のカードの id（「今集めるべき書類」から、同じ書類をもう一度押したときに探す） */
export const docAnchor = (id: string) => `doc-${id}`;

/** この書類を使う財産ごとの「書類あり／まだ」（口座・土地が2件以上あるとき。どの口座の書類がまだかを分かるように） */
function AssetDocList({ docId }: { docId: string }) {
  const { data } = useCase();
  const { done: doneIds } = usePlan();
  const list = data.assets.filter((a) => DOC_OF[a.kind] === docId);
  if (list.length < 2) return null;
  return (
    <div>
      <p className="font-semibold text-stone-500">財産ごと</p>
      <ul className="mt-1 space-y-0.5">
        {list.map((a) => (
          <li key={a.id} className="flex justify-between gap-3">
            <span className="min-w-0 truncate">{a.label || "（名称未入力）"}</span>
            <span className={`shrink-0 text-xs font-bold ${assetHasDoc(a, data.assets, doneIds) ? "text-stone-500" : "text-orange-700"}`}>{assetHasDoc(a, data.assets, doneIds) ? "書類あり" : "まだ"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function DocCard({ item, address, open, onOpen, focus }: { item: DocItem; address: string; open: boolean; onOpen: (v: boolean) => void; focus: boolean }) {
  const { setStatus, done: planDone } = usePlan();
  const { data, update } = useCase();
  const doc = DOCS[item.id];
  const key = `doc:${item.id}`;
  // 同じ種類の財産が2件以上あるとき、まだ書類がない財産（口座ごと）
  const missing = assetsMissingDoc(item.id, data.assets, planDone);
  const ref = useRef<HTMLLIElement>(null);
  // 開いた書類は画面より長いので、名前とチェックが見えるよう、先頭を上の見出しのすぐ下に出す
  useEffect(() => {
    if (focus) showBelowHeader(() => ref.current);
  }, [focus]);
  const setSt = (v: ItemStatus) => {
    setStatus(key, v);
    // 手で「済」にしたときは、まだ書類のない財産（口座など）も全部そろったものとする
    if (v === "done" && missing.length > 0) {
      const ids = new Set(missing.map((a) => a.id));
      update((c) => ({ ...c, assets: c.assets.map((a) => (ids.has(a.id) ? { ...a, docFrom: a.docFrom || "手元にあり" } : a)) }));
    }
    // そろったら、撮影・アップロードを促す（読み取れる書類は金額も読む）
    if (v === "done") onOpen(true);
  };
  const st: ItemStatus = item.done ? "done" : item.na ? "na" : "open";
  return (
    // そろった書類は、緑ではなくグレーの地で見せる（チェックもグレー）
    <li ref={ref} id={docAnchor(item.id)} className={`rounded-xl border ${focus ? "border-sky-500 bg-white ring-2 ring-sky-100" : item.done ? "border-stone-200 bg-stone-50" : "border-stone-200 bg-white"}`}>
      <div className="flex items-start gap-3 p-4">
        <span className="-mt-1.5">
          <RowStatus status={st} onChange={setSt} label={doc.name} muted />
        </span>
        <button type="button" onClick={() => onOpen(!open)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <p className={`font-bold ${item.done || item.na ? "text-stone-500" : "text-stone-900"}`}>
            {doc.name}
            {doc.readable && <span className="ml-2 whitespace-nowrap rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-800">読み取り可</span>}
          </p>
          {/* 閉じたときは件数だけ（1件なら名前）。一覧は開いたときに出す */}
          {!item.done && !item.na && missing.length > 0 && missing.length < data.assets.filter((a) => DOC_OF[a.kind] === item.id).length && (
            <p className="mt-0.5 text-xs font-semibold text-orange-700">まだ：{missing.map((a) => a.label || "（名称未入力）").join("、")}</p>
          )}
          {item.used.length > 0 && <p className="mt-0.5 text-xs text-stone-500">{item.used.length === 1 ? `${item.used[0].title}で使う` : `${item.used.length}件の手続きで使う`}</p>}
        </button>
        {/* 押すと開くことが分かるよう、右端に開閉の印を出す */}
        <button type="button" onClick={() => onOpen(!open)} aria-hidden tabIndex={-1} className="-mr-1 flex shrink-0 items-center gap-0.5 rounded-lg px-1.5 py-1 text-xs text-stone-500 hover:bg-stone-100">
          <span className="hidden sm:inline">{open ? "閉じる" : "詳しく"}</span>
          <ChevronDown className={`h-5 w-5 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      {open && (
        <div className="space-y-3 border-t border-stone-100 px-4 py-4 text-sm leading-relaxed text-stone-700 sm:pl-12">
          {item.done && (
            <div className="flex items-start gap-2">
              <CompassAvatar size={36} />
              <Bubble>{doc.readable ? "そろいましたね！撮影すると金額を読み取ります。" : "そろいましたね！撮影しておくと、税務署に出す書類にまとめます。"}</Bubble>
            </div>
          )}
          {doc.readable ? (
            <>
              <Reader docId={item.id} onRegistered={() => setStatus(key, "done")} />
              <DocFiles docId={item.id} buttons={false} />
            </>
          ) : (
            <DocFiles docId={item.id} onAdded={() => setStatus(key, "done")} />
          )}
          <AssetDocList docId={item.id} />
          <p>{doc.purpose}</p>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[7rem_1fr]">
            {item.used.length > 0 && (
              <>
                <dt className="font-semibold text-stone-500">使う手続き</dt>
                <dd>
                  {item.used.map((t, i) => (
                    <span key={t.id}>
                      {i > 0 && "／"}
                      <Link href={`/my/tasks?id=${t.id}`} className="text-sky-800 underline hover:text-sky-950">
                        {t.title}
                      </Link>
                    </span>
                  ))}
                </dd>
              </>
            )}
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
            {/* 手数料・請求方法は一般的な目安（自治体や金融機関で異なる） */}
            <dt className="font-semibold text-stone-500">手数料（目安）</dt>
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
  useCompassTopic("docs", docsContext, "例：除籍謄本と改製原戸籍はどう違う？");
  // 聞き取りが済んでいなければトップへ戻す（移動は描画のあとに行う）
  const ready = useRequireHearing(o);

  if (!ready) return <AppShell>{null}</AppShell>;
  const cats = ORDER.filter((k) => o.byCategory.has(k));
  // 期限の早い手続きで使う、まだそろっていない書類
  const soon = [...o.docs].filter((d) => !d.done && !d.na).sort((a, b) => (a.used[0]?.date ?? "").localeCompare(b.used[0]?.date ?? "")).slice(0, 4);
  const shown = cat === "すべて" ? cats : [cat];
  // 聞き取りで「ない」と答えた財産（見つかったら登録してもらう）
  const notYet = (
    [
      ["預貯金（ネット銀行・ゆうちょも）", o.iv.deposits > 0],
      ["株式・投資信託", o.iv.securities > 0],
      ["生命保険金", o.iv.insurance > 0],
      ["土地・建物（自宅以外も）", o.iv.homeValue + o.iv.otherRealEstate > 0],
    ] as const
  )
    .filter(([, has]) => !has)
    .map(([label]) => label);

  // 財産の書類（預貯金・保険・不動産・株式）がそろったら、相続税の判定・申告の準備へ誘う
  const assetDocs = ASSET_CATS.flatMap((k) => o.byCategory.get(k) ?? []).filter((d) => !d.na);
  const assetDocsReady = assetDocs.length > 0 && assetDocs.every((d) => d.done);
  const nextStep = o.steps.find((st) => !st.done);
  const taxDone = o.steps.find((st) => st.slug === "tax")?.done;
  const taxLikely = (o.verdict ?? o.est?.verdict) !== "none";

  return (
    <AppShell wide>
      <PageHead
        title="資料集め"
        say={
          <>
            <strong>{o.docs.length}種類</strong>中、{o.doneDocs}種類そろいました。
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
                <p className={`text-xs tabular-nums text-stone-500 ${n === live.length ? "font-bold" : ""}`}>{n === live.length ? "✓ そろった" : `${n}/${live.length}`}</p>
              </button>
            </li>
          );
        })}
      </ul>

      {assetDocsReady && !taxDone && (
        <section className="mb-5 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-brand/40 bg-brand-soft p-4">
          <CompassAvatar size={44} />
          <p className="min-w-0 flex-1 font-bold text-stone-900">
            財産の資料がそろいました！{taxLikely ? "相続税申告の準備をはじめましょう。" : "相続税がかかるか確かめましょう。"}
          </p>
          <Link href={`/case/${nextStep?.slug ?? "decedent"}`} className="rounded-full bg-brand px-6 py-2.5 font-bold text-white shadow hover:brightness-95">
            {taxLikely ? "申告の準備へ" : "相続税を判定する"} ›
          </Link>
        </section>
      )}

      <section data-tour="docs-scan" className="mb-5 rounded-xl border border-teal-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-bold text-teal-900">届いた書類を撮影する</h2>
          {o.filing && (
            <Link href="/case/documents#bundle" className="text-sm font-semibold text-sky-800 underline">
              税務署に出す書類をまとめる ›
            </Link>
          )}
        </div>
        <p className="mb-3 mt-1 text-sm text-stone-600">何枚でもまとめてどうぞ。コンパスくんが種類ごとに仕分けます。</p>
        <AutoSort />
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer py-1 text-teal-800">金額だけ読み取る（贈与の契約書・税金の通知書など）</summary>
          <div className="mt-2">
            <Reader />
          </div>
        </details>
      </section>

      {/* スマホでは「今集めるべき書類」を書類の一覧より上に出す。パソコンでは右の列の上（2行目を伸ばして、右の枠どうしの間を空けない） */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[auto_1fr]">
        <div className="lg:col-start-2 lg:row-start-1">
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
                      <span className="text-xs text-stone-500">{d.used[0] ? `${shortDate(d.used[0].date, o.now)}・${d.used[0].title}` : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="space-y-6 lg:col-start-1 lg:row-span-2 lg:row-start-1">
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
        </div>
        <div className="lg:col-start-2 lg:row-start-2">
          <Panel title="ほかに財産はありませんか？">
            <p className="text-sm text-stone-600">見つかったら登録すると、必要な書類がここに増えます。</p>
            {notYet.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-stone-700">
                {notYet.map((label) => (
                  <li key={label}>{label}</li>
                ))}
              </ul>
            )}
            <Link href="/case/assets" className="mt-3 inline-block rounded-lg border border-sky-300 px-3 py-1.5 text-sm font-semibold text-sky-800 hover:bg-sky-50">
              財産を登録する ›
            </Link>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
