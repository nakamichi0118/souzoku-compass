"use client";

import { useState } from "react";
import { Button, Card, Note } from "@/components/ui";
import { civilHeirIds } from "@/domain/heirs";
import type { TaxResult } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";
import { buildDivisionDoc } from "@/documents/division";
import { formsNotGenerated } from "@/forms/filing";
import { divisionStatus } from "@/forms/schedule11";
import { useCase } from "@/lib/store";
import { markCompleted } from "@/lib/progress";
import { usePlan } from "@/lib/planStore";
import { FilingGuide } from "./FilingGuide";
import { saveBlob } from "@/lib/download";

async function download(url: string, body: unknown, filename: string) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error([j.error, ...(j.blockers ?? [])].filter(Boolean).join("\n") || "作成に失敗しました");
  }
  saveBlob(await res.blob(), filename);
}

/** 相続コンパスで聞いていないため、申告書で空欄にしている欄（印刷後に手で書く） */
export function handFilledBlanks(result: TaxResult | null): string[] {
  return [
    "マイナンバー（個人番号）欄",
    ...(result?.persons.some((p) => p.successiveCredit > 0) ? ["第7表の前の相続で亡くなった方の氏名・続柄・申告書を出した税務署"] : []),
    ...(result?.assets.some((l) => l.small?.kind === "business" && l.reduction > 0) ? ["第11・11の2表の付表1の事業内容（お店や工場などの事業の種類）"] : []),
    // 全部または一部の分け方が決まっているときは、第11表に分割の日を書く
    ...(result && divisionStatus(result) !== "3" ? ["第11表の分割の日（遺産分割協議がまとまった日）"] : []),
  ];
}

/** 遺産分割協議書を作れないときの理由（作れるときは null）。協議は相続人どうしで行うため、相続人がいなければ作れない */
export function divisionDocUnavailable(c: Case): string | null {
  let heirs: Set<string>;
  try {
    heirs = civilHeirIds(c.persons);
  } catch {
    return null; // 入力途中（下の確認で知らせる）
  }
  if (heirs.size > 0) return null;
  return c.persons.length === 0 ? "先に「相続人」で家族を登録してください。" : "相続人がいない（全員が相続を放棄したなど）ため、遺産分割協議書は作れません。";
}

export function DocumentsStep() {
  const { data, result, update } = useCase();
  const plan = usePlan();
  const missing = result ? formsNotGenerated(data, result) : [];
  const blanks = handFilledBlanks(result);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const noDivisionDoc = divisionDocUnavailable(data);
  const division = (() => {
    if (noDivisionDoc) return { warnings: [] };
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
      if (key === "tax") plan.setStatus("filing:prepared", "done");
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
          国税庁が公開している令和8年分の正式様式に、計算結果を記入したPDFを作ります。自動で作るのは第1表・第1表（続）・第2表・第5表・第6表・第7表・第9表・第10表・第11表と付表1〜4・第11・11の2表の付表1（小規模宅地等）・第13表・第15表です（使う表だけが入ります）。
        </p>
        {missing.length > 0 && (
          <div className="mb-3 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-950">
            <p className="font-bold">このPDFだけでは申告書一式になりません。次の表は自動で作らないため、別に用意してください。</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {missing.map((m, i) => (
                <li key={`${i}-${m.form}`}>
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
          <li>{blanks.join("、")}は空欄です。印刷後に記入してください。</li>
          {result?.assets.some((l) => l.reduction > 0) && <li>小規模宅地等の特例を受けるときは、遺産分割協議書の写し・取得者の住民票などの添付書類も必要です。</li>}
          <li>提出前に、内容を必ず確認してください。相続コンパスは税理士による確認の代わりにはなりません。</li>
        </ul>
      </Card>
      <Card title="遺産分割協議書">
        <p className="mb-3 text-sm text-stone-600">
          「遺産の分け方」で決めた内容から、遺産分割協議書の文案を作ります。日付・本籍を記入し、相続人全員が署名して実印を押してください（印鑑証明書を添付します）。
        </p>
        {division.warnings.map((w, i) => (
          <div key={`${i}-${w}`} className="mb-2">
            <Note tone="warn">{w}</Note>
          </div>
        ))}
        <Button onClick={() => run("division", "/api/division", "遺産分割協議書.pdf")} disabled={busy !== null || !!noDivisionDoc}>
          {busy === "division" ? "作成中…" : "遺産分割協議書PDFをダウンロード"}
        </Button>
        {noDivisionDoc && <p className="mt-2 text-xs text-stone-600">{noDivisionDoc}</p>}
      </Card>
      {err && <Note tone="stop">{err}</Note>}
      <FilingGuide missing={missing} />
    </div>
  );
}
