"use client";

import { useState } from "react";
import { Button, Card, Note } from "@/components/ui";
import { civilHeirIds } from "@/domain/heirs";
import type { TaxResult } from "@/domain/tax/engine";
import type { Case } from "@/domain/types";
import { buildDivisionDoc } from "@/documents/division";
import { smallLines } from "@/forms/attachments";
import { formsNotGenerated } from "@/forms/filing";
import { divisionStatus, siteRightRatio } from "@/forms/schedule11";
import { useCase } from "@/lib/store";
import { formsUpToDate, markFormsCreated, soleHeirId } from "@/lib/progress";
import { usePlan } from "@/lib/planStore";
import { FilingGuide, shortFormName } from "./FilingGuide";
import { SubmissionBundle } from "./SubmissionBundle";
import { saveBlob } from "@/lib/download";
import Link from "next/link";
import { draftReason, reviewSummary } from "@/domain/review/topics";
import { Check } from "@/components/ui";

async function fetchPdf(url: string, body: unknown): Promise<Blob> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error([j.error, ...(j.blockers ?? [])].filter(Boolean).join("\n") || "作成に失敗しました");
  }
  return res.blob();
}
async function download(url: string, body: unknown, filename: string) {
  saveBlob(await fetchPdf(url, body), filename);
}

/** 相続コンパスで聞いていないため、申告書で空欄にしている欄（印刷後に手で書く） */
export function handFilledBlanks(result: TaxResult | null): string[] {
  return [
    "マイナンバー",
    ...(result?.persons.some((p) => p.gifts > 0) ? ["第14表の贈与された財産の種類・細目・所在場所"] : []),
    ...(result?.persons.some((p) => p.successiveCredit > 0) ? ["第7表の前の相続で亡くなった方の氏名・続柄・申告書を出した税務署"] : []),
    ...(result?.assets.some((l) => smallLines(l).some((x) => x.detail.kind === "business")) ? ["第11・11の2表の付表1の事業内容（お店や工場などの事業の種類）"] : []),
    // 全部または一部の分け方が決まっているときは、第11表に分割の日を書く
    ...(result && divisionStatus(result) !== "3" ? ["第11表の分割の日（協議がまとまった日）"] : []),
    // マンションの敷地利用権の備考には敷地権の割合を書く。登記申請の画面で割合を入れていなければ空欄になる
    ...(result?.assets.some((l) => l.asset.kind === "condo" && !/分の/.test(siteRightRatio(l.asset.registry?.siteRight)))
      ? ["第11表の付表1の備考（マンションの敷地権の割合。登記事項証明書の『敷地権の割合』、例：10000分の169）"]
      : []),
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
  // 「申告が終わるまで」の案内（申告がいるときだけ出る）
  const guide = !!result?.needsFiling;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const noDivisionDoc = divisionDocUnavailable(data);
  const consent = data.review?.consent;
  const agreed = !!(consent?.terms && consent.responsibility);
  const setConsent = (k: "terms" | "responsibility", v: boolean) =>
    update((c) => {
      const cur = c.review?.consent ?? { terms: false, responsibility: false, at: "" };
      return { ...c, review: { ...c.review, consent: { ...cur, [k]: v, at: new Date().toISOString() } } };
    });
  const draft = draftReason(data.review);
  const review = reviewSummary(data.review);
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
      // 書類のステップが完了になるのは申告書PDFを作ったときだけ（遺産分割協議書だけでは完了にしない）
      if (key === "tax") {
        update(markFormsCreated);
        plan.setStatus("filing:prepared", "done");
      }
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
        <p className="text-sm text-stone-600">国税庁の正式様式に、計算結果を記入したPDFを作ります。</p>
        <details className="mb-3 text-xs text-stone-600">
          <summary className="cursor-pointer py-2 font-medium text-teal-800">作る表を見る</summary>
          <p className="leading-relaxed">
            令和8年分の様式の、第1表・第1表（続）・第2表・第5表・第6表・第7表・第8の8表・第9表・第10表・第11表と付表1〜4・第11・11の2表の付表1（小規模宅地等）・第13表・第14表・第15表です（使う表だけが入ります）。
          </p>
        </details>
        {missing.length > 0 && (
          <div className="mb-3 rounded-lg border border-orange-300 bg-orange-50 p-3 text-sm text-orange-950">
            <p className="font-bold">次の表は自動で作れないので、別に用意してください。</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">
              {missing.map((m, i) => (
                <li key={`${i}-${m.form}`}>
                  {shortFormName(m.form)}（{m.reason}）
                </li>
              ))}
            </ul>
            <details className="mt-1 text-xs">
              <summary className="cursor-pointer py-2 font-medium text-teal-800">表の正式名と様式</summary>
              <ul className="list-disc space-y-0.5 pl-5">
                {missing.map((m, i) => (
                  <li key={`${i}-${m.form}`}>{m.form}</li>
                ))}
              </ul>
              <p className="mt-1">様式は国税庁のホームページ「相続税の申告書等の様式一覧（令和8年分用）」にあります。</p>
            </details>
          </div>
        )}
        {draft && (
          <div className="mb-3">
            <Note tone="warn">
              申告前の確認が残り{review.open.length}件です。このまま作ると、各ページに「下書き」と入ります。
              <Link href="/case/review" className="ml-2 font-semibold underline">
                確認する ›
              </Link>
            </Note>
          </div>
        )}
        <div className="mb-3 space-y-1 rounded-lg border border-stone-200 bg-stone-50 p-3">
          <Check checked={!!consent?.terms} onChange={(v) => setConsent("terms", v)} label="利用規約に同意します" />
          <Check
            checked={!!consent?.responsibility}
            onChange={(v) => setConsent("responsibility", v)}
            label="相続コンパスは申告書を作るための道具であり、申告内容の確認と最終的な責任は自分にあることを理解しました"
          />
          <Link href="/terms" target="_blank" className="block pl-6 text-xs text-teal-800 underline">
            利用規約を読む
          </Link>
        </div>
        <Button onClick={() => run("tax", "/api/forms", "相続税申告書_令和8年分.pdf")} disabled={busy !== null || !agreed}>
          {busy === "tax" ? "作成中…" : "申告書PDFをダウンロード"}
        </Button>
        {data.progress?.formsKey && !formsUpToDate(data) && (
          <div className="mt-3">
            <Note tone="warn">申告書PDFを作ったあとに入力が変わりました。もう一度ダウンロードしてください。</Note>
          </div>
        )}
        {/* 手書きする欄と添付書類は、下の「申告が終わるまで」の手順2・3に出す（その案内が出ないときだけここに出す） */}
        {!guide && <p className="mt-3 text-sm text-stone-600">手書きする欄：{blanks.join("、")}</p>}
        <p className="mt-3 text-sm text-stone-600">相続コンパスは税理士による確認の代わりにはなりません。</p>
      </Card>
      {/* 相続人が1人なら協議は要らないので出さない */}
      {!soleHeirId(data) && (
      <Card title="遺産分割協議書">
        <p className="mb-3 text-sm text-stone-600">「遺産の分け方」の内容で文案を作ります。日付・本籍を書き、相続人全員が署名して実印を押します（印鑑証明書を添付）。</p>
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
      )}
      {err && <Note tone="stop">{err}</Note>}
      <SubmissionBundle
        formsReady={agreed && !!result && data.assets.length > 0 && result.blockers.length === 0}
        getForms={async () => {
          const b = await fetchPdf("/api/forms", data);
          update(markFormsCreated);
          plan.setStatus("filing:prepared", "done");
          return b;
        }}
      />
      <FilingGuide missing={missing} blanks={blanks} />
    </div>
  );
}
