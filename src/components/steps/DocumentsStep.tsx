"use client";

import { useState } from "react";
import { Button, Card, Note } from "@/components/ui";
import { buildDivisionDoc } from "@/documents/division";
import { formsNotGenerated } from "@/forms/filing";
import { useCase } from "@/lib/store";
import { markCompleted } from "@/lib/progress";

async function download(url: string, body: unknown, filename: string) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error([j.error, ...(j.blockers ?? [])].filter(Boolean).join("\n") || "作成に失敗しました");
  }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export function DocumentsStep() {
  const { data, result, update } = useCase();
  const missing = result ? formsNotGenerated(data, result) : [];
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const division = (() => {
    try {
      return buildDivisionDoc(data);
    } catch {
      return { warnings: ["相続人の入力が終わっていないため、遺産分割協議書を確認できません。"] };
    }
  })();

  const run = async (key: string, url: string, name: string) => {
    setBusy(key);
    setErr(null);
    try {
      await download(url, data, name);
      update((c) => markCompleted(c, "documents"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      {result?.blockers.length ? (
        <Note tone="stop">自動では書類を完成できない事項があります。「税額の確認」で内容を確認し、税理士にご相談ください。</Note>
      ) : null}
      <Card title="相続税の申告書（国税庁 令和8年分様式）">
        <p className="mb-3 text-sm text-stone-600">
          国税庁が公開している令和8年分の正式様式に、計算結果を記入したPDFを作ります。自動で作るのは第1表・第1表（続）・第2表・第5表・第11表と付表1〜4・第13表・第15表です。
        </p>
        {missing.length > 0 && (
          <div className="mb-3 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-950">
            <p className="font-bold">このPDFだけでは申告書一式になりません。次の表は自動で作らないため、別に用意してください。</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {missing.map((m) => (
                <li key={m.form}>
                  {m.form}（{m.reason}）
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs">様式は国税庁のホームページ「相続税の申告書等の様式一覧（令和8年分用）」にあります。</p>
          </div>
        )}
        <Button onClick={() => run("tax", "/api/forms", "相続税申告書_令和8年分.pdf")} disabled={busy !== null}>
          {busy === "tax" ? "作成中…" : "申告書PDFをダウンロード"}
        </Button>
        <ul className="mt-4 list-disc space-y-1 pl-5 text-sm text-stone-600">
          <li>マイナンバー（個人番号）欄は空欄です。印刷後に記入してください。</li>
          <li>PDFを作るときだけ、入力内容をこのアプリのサーバーへ送ります。サーバーには保存しません。</li>
          <li>提出前に、内容を必ず確認してください。相続コンパスは税理士による確認の代わりにはなりません。</li>
        </ul>
      </Card>
      <Card title="遺産分割協議書">
        <p className="mb-3 text-sm text-stone-600">
          「遺産の分け方」で決めた内容から、遺産分割協議書の文案を作ります。日付・本籍を記入し、相続人全員が署名して実印を押してください（印鑑証明書を添付します）。
        </p>
        {division.warnings.map((w) => (
          <div key={w} className="mb-2">
            <Note tone="warn">{w}</Note>
          </div>
        ))}
        <Button onClick={() => run("division", "/api/division", "遺産分割協議書.pdf")} disabled={busy !== null}>
          {busy === "division" ? "作成中…" : "遺産分割協議書PDFをダウンロード"}
        </Button>
      </Card>
      {err && <Note tone="stop">{err}</Note>}
    </div>
  );
}
