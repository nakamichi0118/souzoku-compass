"use client";

import Link from "next/link";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { fmt } from "@/components/ui";
import { DOCS } from "@/domain/procedures/documents";
import type { AssetKind } from "@/domain/types";
import { useOverall } from "@/lib/overall";
import { Panel } from "./Home";

const GROUPS: { key: string; label: string; icon: string; kinds: AssetKind[] }[] = [
  { key: "re", label: "土地・建物", icon: "🏠", kinds: ["land", "building", "condo"] },
  { key: "money", label: "預貯金・現金", icon: "🏦", kinds: ["deposit", "cash"] },
  { key: "stock", label: "株式", icon: "📈", kinds: ["listedStock", "unlistedStock"] },
  { key: "ins", label: "保険金・退職金", icon: "☂️", kinds: ["insurance", "retirement"] },
  { key: "other", label: "その他", icon: "📦", kinds: ["household", "other"] },
];
const KIND_LABEL: Record<AssetKind, string> = {
  land: "土地",
  building: "建物",
  condo: "マンション",
  deposit: "預貯金",
  cash: "現金",
  listedStock: "上場株式",
  unlistedStock: "非上場株式",
  insurance: "死亡保険金",
  retirement: "死亡退職金",
  household: "家庭用財産",
  other: "その他",
};
/** 財産の種類ごとに、評価の根拠になる書類 */
const DOC_OF: Partial<Record<AssetKind, string>> = { land: "hyokaCert", building: "hyokaCert", condo: "hyokaCert", deposit: "balanceCert", listedStock: "securitiesCert", insurance: "insurancePay" };

export function AssetsPage() {
  const o = useOverall();
  if (!o.loaded) return <AppShell>{null}</AppShell>;
  const c = o.case;
  const r = o.result;
  const lines = r?.assets ?? [];
  const valueOf = (id: string) => lines.find((l) => l.asset.id === id);
  const debts = c.debts.reduce((s, d) => s + d.amount, 0);

  return (
    <AppShell wide>
      <PageHead
        title="財産・資料"
        say={c.assets.length ? "登録した財産と、評価の根拠になる書類の状況です。土地は地図から路線価で評価できます。" : "まだ財産が登録されていません。書類をアップロードするか、手で入力しましょう。"}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/case/assets" className="rounded-lg bg-sky-700 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-800">
              財産を入力・評価する
            </Link>
            <Link href="/case/map" className="rounded-lg border border-sky-300 bg-white px-4 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-50">
              🗺 土地を地図で評価
            </Link>
            <Link href="/my/docs" className="rounded-lg border border-teal-400 bg-white px-4 py-2 text-sm font-semibold text-teal-800 hover:bg-teal-50">
              📤 書類から読み取る
            </Link>
          </div>
        }
      />

      <ul className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {GROUPS.map((g) => {
          const items = c.assets.filter((a) => g.kinds.includes(a.kind));
          const sum = items.reduce((s, a) => s + (valueOf(a.id)?.valuation.value ?? 0), 0);
          return (
            <li key={g.key} className="rounded-xl border border-sky-100 bg-white p-3 shadow-sm">
              <p className="text-sm font-semibold text-stone-700">
                {g.icon} {g.label}
              </p>
              <p className="mt-1 text-lg font-bold tabular-nums text-sky-950">{items.length ? `${fmt(sum)}円` : "—"}</p>
              <p className="text-xs text-stone-500">{items.length}件</p>
            </li>
          );
        })}
        <li className="rounded-xl border border-rose-100 bg-white p-3 shadow-sm">
          <p className="text-sm font-semibold text-stone-700">➖ 借金・葬儀費用</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-rose-800">{c.debts.length ? `${fmt(debts)}円` : "—"}</p>
          <p className="text-xs text-stone-500">{c.debts.length}件</p>
        </li>
      </ul>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="overflow-x-auto rounded-2xl border border-sky-100 bg-white shadow-sm">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-sky-50/70 text-left text-xs text-stone-600">
              <tr>
                <th className="px-4 py-2">財産</th>
                <th className="px-2 py-2">種類</th>
                <th className="px-2 py-2 text-right">評価額</th>
                <th className="px-2 py-2">根拠の書類</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {c.assets.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-stone-500">
                    まだ財産がありません。
                    <Link href="/my/docs" className="ml-1 text-sky-800 underline">
                      残高証明書などをアップロード
                    </Link>
                    するか、
                    <Link href="/case/assets" className="text-sky-800 underline">
                      手で入力
                    </Link>
                    してください。
                  </td>
                </tr>
              )}
              {c.assets.map((a) => {
                const l = valueOf(a.id);
                const docId = DOC_OF[a.kind];
                const got = docId ? o.done.includes(`doc:${docId}`) : null;
                return (
                  <tr key={a.id} className="border-t border-stone-100">
                    <td className="px-4 py-2.5 font-semibold text-stone-800">{a.label}</td>
                    <td className="px-2 py-2.5 text-stone-600">{KIND_LABEL[a.kind]}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {l ? `${fmt(l.valuation.value)}円` : "—"}
                      {l && l.reduction > 0 && <span className="block text-xs text-emerald-700">特例で −{fmt(l.reduction)}円</span>}
                      {l?.valuation.needsConsultation && <span className="block text-xs text-amber-700">要相談</span>}
                    </td>
                    <td className="px-2 py-2.5">
                      {docId ? (
                        <Link href={`/my/docs?id=${docId}`} className={`rounded-full px-2 py-0.5 text-xs font-bold ${got ? "bg-emerald-100 text-emerald-800" : "bg-orange-100 text-orange-800"}`}>
                          {got ? "✓ " : ""}
                          {DOCS[docId]?.name.replace(/（.*?）/, "")}
                        </Link>
                      ) : (
                        <span className="text-xs text-stone-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link href={a.kind === "land" || a.kind === "condo" ? "/case/map" : "/case/assets"} className="text-xs text-sky-700 hover:underline">
                        編集 ›
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
        <div className="space-y-5">
          <Panel title="相続税の計算結果">
            {r && c.assets.length ? (
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-stone-600">財産の合計（特例後）</dt>
                  <dd className="font-semibold tabular-nums">{fmt(r.totalAcquired)}円</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-stone-600">借金・葬儀費用</dt>
                  <dd className="tabular-nums">−{fmt(r.totalDebts)}円</dd>
                </div>
                <div className="flex justify-between border-t border-stone-100 pt-1.5">
                  <dt className="text-stone-600">課税価格の合計</dt>
                  <dd className="font-semibold tabular-nums">{fmt(r.totalTaxable)}円</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-stone-600">基礎控除</dt>
                  <dd className="tabular-nums">{fmt(r.basicDeduction)}円</dd>
                </div>
                <div className="flex justify-between rounded-lg bg-sky-50 px-2 py-1.5">
                  <dt className="font-bold text-sky-950">納める相続税（合計）</dt>
                  <dd className="font-bold tabular-nums text-sky-950">{fmt(r.totalPayable)}円</dd>
                </div>
                <p className="pt-1 text-xs text-stone-500">{r.needsFiling ? "相続税の申告が必要です（期限：亡くなった日から10か月以内）。" : "基礎控除以下のため、申告は不要の見込みです。"}</p>
                <Link href="/case/tax" className="inline-block pt-1 text-sm text-sky-800 underline">
                  計算の内訳を見る ›
                </Link>
              </dl>
            ) : (
              <p className="text-sm text-stone-600">財産を登録すると、正確な相続税を計算します。</p>
            )}
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
