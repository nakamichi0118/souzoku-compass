"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Bubble, CompassAvatar } from "@/components/compass/CompassKun";
import { OfficeLookup } from "@/components/plan/OfficeLookup";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { fmt } from "@/components/ui";
import { jpDate } from "@/domain/procedures/dates";
import { DOCS, type DocCategory } from "@/domain/procedures/documents";
import { findSame, toAsset, useExtract, type ExtractedAsset } from "@/lib/extract";
import { useOverall, type DocItem } from "@/lib/overall";
import { useCase } from "@/lib/store";
import { CAT_ICON, Panel } from "./Home";

/** 亡くなった方の住所で請求先が決まる書類 */
const LOOKUP = new Set(["juminhyoJokyo", "hyokaCert", "nayose", "houteiJoho"]);
const SAMPLE: Record<string, { url: string; name: string }> = {
  balanceCert: { url: "/demo/zandaka-sample.pdf", name: "残高証明書（見本）.pdf" },
};
const ORDER: DocCategory[] = ["戸籍・住民票", "預貯金", "保険", "不動産", "株式", "年金・税金", "その他"];

/** アップロードした書類をコンパスくんが読み取り、確認してから財産に登録する */
function Reader({ docId, onRegistered }: { docId: string; onRegistered: () => void }) {
  const { data: c, update } = useCase();
  const ex = useExtract();
  const [added, setAdded] = useState<number[]>([]);
  const sample = SAMPLE[docId];
  const adopt = (x: ExtractedAsset, i: number) => {
    update((cur) => ({ ...cur, assets: [...cur.assets, toAsset(x, cur)] }));
    setAdded((a) => [...a, i]);
    onRegistered();
  };
  return (
    <div className="rounded-xl border-2 border-dashed border-teal-400 bg-teal-50/40 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">
          {ex.busy ? "コンパスくんが読み取り中…" : "📤 写真・PDFをアップロード"}
          <input type="file" accept="image/*,application/pdf" className="hidden" disabled={ex.busy} onChange={(e) => e.target.files?.[0] && ex.read(e.target.files[0])} />
        </label>
        {sample && (
          <button type="button" disabled={ex.busy} onClick={() => ex.readSample(sample.url, sample.name)} className="rounded-lg border border-teal-600 bg-white px-3 py-2 text-sm text-teal-800 hover:bg-teal-50">
            見本の書類で試す
          </button>
        )}
        {sample && (
          <a href={sample.url} target="_blank" rel="noreferrer" className="text-xs text-teal-800 underline">
            見本を開く
          </a>
        )}
      </div>
      <p className="mt-2 text-xs text-stone-500">金額や銀行名をコンパスくんが読み取ります。登録する前に、必ず書類と見比べてください。デモではダミーの書類だけを使ってください。</p>
      {ex.err && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{ex.err}</p>}
      {ex.res && (
        <div className="mt-3 space-y-2">
          <p className="text-sm font-semibold text-stone-700">
            読み取った書類：{ex.res.documentType}
            {ex.file ? `（${ex.file}）` : ""}
          </p>
          {ex.res.assets.length === 0 && <p className="text-sm text-stone-600">財産の情報は見つかりませんでした。</p>}
          {ex.res.assets.map((x, i) => {
            const same = findSame(x, c);
            const isAdded = added.includes(i);
            return (
              <div key={i} className="rounded-lg border border-stone-200 bg-white p-3 text-sm">
                <p className="font-bold text-stone-900">{x.label}</p>
                <dl className="mt-1 grid grid-cols-[7rem_1fr] gap-y-0.5 text-stone-700">
                  {x.institution && (
                    <>
                      <dt className="text-stone-500">金融機関</dt>
                      <dd>
                        {x.institution} {x.branch ?? ""} {x.accountType ?? ""}
                      </dd>
                    </>
                  )}
                  {x.amount != null && (
                    <>
                      <dt className="text-stone-500">金額</dt>
                      <dd className="font-bold tabular-nums">{fmt(x.amount)}円</dd>
                    </>
                  )}
                  {x.accruedInterest != null && (
                    <>
                      <dt className="text-stone-500">既経過利息</dt>
                      <dd className="tabular-nums">{fmt(x.accruedInterest)}円</dd>
                    </>
                  )}
                  {x.fixedAssetValue != null && (
                    <>
                      <dt className="text-stone-500">固定資産税評価額</dt>
                      <dd className="tabular-nums">{fmt(x.fixedAssetValue)}円</dd>
                    </>
                  )}
                  {x.date && (
                    <>
                      <dt className="text-stone-500">基準日</dt>
                      <dd>{x.date}</dd>
                    </>
                  )}
                </dl>
                <p className="mt-1 text-xs text-stone-500">読み取った箇所：「{x.evidence}」</p>
                <div className="mt-2">
                  {isAdded ? (
                    <span className="font-semibold text-emerald-700">✓ 財産に登録しました</span>
                  ) : same ? (
                    <span className="font-semibold text-emerald-700">✓ 登録済みの「{same.label}」と金額が一致しています</span>
                  ) : (
                    <button type="button" onClick={() => adopt(x, i)} className="rounded-lg bg-sky-700 px-3 py-1.5 font-semibold text-white hover:bg-sky-800">
                      確認して財産に登録
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {ex.res.notes.map((n) => (
            <p key={n} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              ⚠ {n}
            </p>
          ))}
          {(added.length > 0 || ex.res.assets.some((x) => findSame(x, c))) && (
            <Link href="/my/assets" className="inline-block text-sm text-sky-800 underline">
              財産の一覧を見る ›
            </Link>
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
  const check = () => {
    o.toggle(key);
    // 読み取れる書類は、そろったらアップロードを促す
    if (!item.done && doc.readable) onOpen(true);
  };
  return (
    <li ref={ref} className={`rounded-xl border bg-white ${focus ? "border-sky-500 ring-2 ring-sky-100" : item.done ? "border-emerald-200" : "border-stone-200"}`}>
      <div className="flex items-start gap-3 p-4">
        <input type="checkbox" checked={item.done} onChange={check} className="mt-1 h-5 w-5 shrink-0 accent-emerald-600" aria-label={`${doc.name}がそろった`} />
        <button type="button" onClick={() => onOpen(!open)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
          <p className={`font-bold ${item.done ? "text-stone-500" : "text-stone-900"}`}>
            {doc.name}
            {doc.readable && <span className="ml-2 rounded-full bg-teal-100 px-2 py-0.5 text-[11px] font-bold text-teal-800">読み取りできます</span>}
          </p>
          <p className="mt-0.5 text-xs text-stone-500">使う手続き：{item.used.map((t) => t.title).join("／")}</p>
        </button>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${item.done ? "bg-emerald-100 text-emerald-800" : "bg-stone-100 text-stone-600"}`}>{item.done ? "✓ そろった" : "まだ"}</span>
      </div>
      {open && (
        <div className="space-y-3 border-t border-stone-100 px-4 py-4 text-sm leading-relaxed text-stone-700 sm:pl-12">
          {item.done && doc.readable && (
            <div className="flex items-start gap-2">
              <CompassAvatar size={36} />
              <Bubble>そろいましたね！書類をアップロードすると、ボクが金額を読み取って財産に登録します。</Bubble>
            </div>
          )}
          {doc.readable && <Reader docId={item.id} onRegistered={() => !o.done.includes(key) && o.toggle(key)} />}
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
          {doc.tip && <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">💡 {doc.tip}</p>}
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

  if (!o.loaded) return <AppShell>{null}</AppShell>;
  if (!o.heard || !o.valid) {
    router.replace("/my");
    return <AppShell>{null}</AppShell>;
  }
  const cats = ORDER.filter((k) => o.byCategory.has(k));
  // 期限の早い手続きで使う、まだそろっていない書類
  const soon = [...o.docs].filter((d) => !d.done).sort((a, b) => (a.used[0]?.date ?? "").localeCompare(b.used[0]?.date ?? "")).slice(0, 4);
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
          const n = items.filter((d) => d.done).length;
          return (
            <li key={k}>
              <button type="button" onClick={() => setCat(cat === k ? "すべて" : k)} className={`w-full rounded-xl border p-3 text-center ${cat === k ? "border-sky-500 bg-sky-50" : "border-sky-100 bg-white hover:bg-sky-50/50"}`}>
                <span className="text-2xl" aria-hidden>
                  {CAT_ICON[k]}
                </span>
                <p className="text-sm font-semibold text-stone-800">{k}</p>
                <p className={`text-xs tabular-nums ${n === items.length ? "font-bold text-emerald-700" : "text-stone-500"}`}>{n === items.length ? "✓ そろった" : `${n}/${items.length}`}</p>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6">
          {shown.map((k) => (
            <section key={k}>
              <h2 className="mb-2 font-bold text-sky-950">
                {CAT_ICON[k]} {k}
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
          <Panel title="コンパスくんのおすすめ">
            <ul className="space-y-2 text-sm leading-relaxed text-stone-700">
              <li>👪 戸籍は「広域交付」を使うと、最寄りの役所で亡くなった方の出生から死亡までをまとめて取れます。</li>
              <li>📜 「法定相続情報一覧図」を法務局で作ると、銀行や登記で戸籍の束の代わりに使えて便利です（無料）。</li>
              <li>🏦 残高証明書は「亡くなった日現在」で、既経過利息も一緒に書いてもらうよう頼みましょう。</li>
              <li>🏠 固定資産評価証明書は、相続登記の登録免許税の計算にも使います。</li>
            </ul>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
