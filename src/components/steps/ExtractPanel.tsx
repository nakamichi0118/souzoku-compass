"use client";

import { Button, Card, Note, fmt } from "@/components/ui";
import { toAsset, useExtract, type ExtractedAsset } from "@/lib/extract";
import { useCase } from "@/lib/store";

/** 書類の写真・PDFから Claude が財産の入力候補を読み取る。登録は本人が確認してから */
export function ExtractPanel() {
  const { update, data } = useCase();
  const { busy, err, res, read } = useExtract();
  const adopt = (x: ExtractedAsset) => update((c) => ({ ...c, assets: [...c.assets, toAsset(x, data)] }));

  return (
    <Card title="書類から読み取る（コンパスくん）">
      <p className="mb-3 text-sm text-stone-600">
        残高証明書、固定資産税の課税明細書、保険金の支払通知書などの写真やPDFを選ぶと、コンパスくんが内容を読み取って入力候補を作ります。登録する前に、必ず書類と見比べてください。
      </p>
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-teal-600 px-4 py-3 text-sm font-semibold text-teal-800 hover:bg-teal-50">
        {busy ? "読み取り中…" : "📄 書類を選ぶ（画像・PDF）"}
        <input type="file" accept="image/*,application/pdf" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
      </label>
      <p className="mt-2 text-xs text-stone-500">デモではダミーの書類だけを使ってください。</p>
      {err && (
        <div className="mt-3">
          <Note tone="stop">{err}</Note>
        </div>
      )}
      {res && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold">読み取った書類：{res.documentType}</p>
          {res.assets.map((x, i) => (
            <div key={i} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-stone-200 p-3 text-sm">
              <div>
                <p className="font-semibold">{x.label}</p>
                <p className="text-stone-600">
                  {x.amount != null && `金額 ${fmt(x.amount)}円 `}
                  {x.accruedInterest != null && `既経過利息 ${fmt(x.accruedInterest)}円 `}
                  {x.fixedAssetValue != null && `固定資産税評価額 ${fmt(x.fixedAssetValue)}円 `}
                  {x.areaSqm != null && `${x.areaSqm}㎡ `}
                  {x.date && `（${x.date}時点）`}
                </p>
                <p className="text-xs text-stone-500">根拠：「{x.evidence}」</p>
              </div>
              <Button variant="secondary" onClick={() => adopt(x)}>
                確認して登録
              </Button>
            </div>
          ))}
          {res.notes.map((n) => (
            <Note key={n} tone="warn">
              {n}
            </Note>
          ))}
        </div>
      )}
    </Card>
  );
}
