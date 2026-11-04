"use client";

/**
 * 申告書PDFを作った後の流れ：残りの記入 → 添付書類 → 提出 → 納税。
 * 段階ごとに「済」を付けられ、納税まで済んだら、やることリストの「相続税の申告と納付」も完了にする。
 */
import { Check } from "lucide-react";
import { jpDate, monthsDeadline, nextOpenDay } from "@/domain/procedures/dates";
import { usePlan } from "@/lib/planStore";
import { useCase } from "@/lib/store";

/** 帳票の短い名前：末尾のかっこ書きの正式名を外す（「第14表（…の明細書）」→「第14表」） */
export const shortFormName = (form: string) => form.replace(/（[^（）]*）$/, "") || form;

export function FilingGuide({ missing, blanks }: { missing: { form: string; reason: string }[]; blanks: string[] }) {
  const { data, result } = useCase();
  const plan = usePlan();
  if (!result || !result.needsFiling) return null;
  const deadline = data.decedent.deathDate ? nextOpenDay(monthsDeadline(data.decedent.deathDate, 10)) : null;
  const t = data.filing?.taxOffice?.trim();
  const office = t ? (t.endsWith("税務署") ? t : `${t}税務署`) : "亡くなった方の住所地の税務署";
  const small = result.assets.some((l) => l.reduction > 0);
  const payers = result.persons.filter((p) => p.payable > 0);

  const stages: { id: string; title: string; body: React.ReactNode }[] = [
    {
      id: "prepared",
      title: "申告書を作る",
      body: <p>PDFを印刷して、家族全員で内容を確かめます。</p>,
    },
    {
      id: "filled",
      title: "残りを書き込む",
      body: (
        <ul className="list-disc space-y-1 pl-5">
          <li>手書きする欄：{blanks.join("、")}</li>
          {missing.length > 0 && <li>上の「別に用意する表」（{missing.map((m) => shortFormName(m.form)).join("・")}）を加えます。</li>}
          <li>申告書への押印は要りません。</li>
        </ul>
      ),
    },
    {
      id: "attached",
      title: "添付書類をそろえる",
      body: (
        <ul className="list-disc space-y-1 pl-5">
          <li>相続人全員の戸籍謄本（亡くなった日から10日を過ぎて作ったもの）か、法定相続情報一覧図の写し</li>
          <li>遺産分割協議書の写しと、全員の印鑑証明書（遺言書があればその写し）</li>
          <li>各人のマイナンバーカードの写し（なければ通知カード＋運転免許証などの写し）</li>
          {small && <li>小規模宅地等の特例：住民票の写しなど、特例ごとに必要な書類</li>}
          <li>あれば添える：残高証明書、固定資産税の課税明細書、保険金の支払通知書など</li>
        </ul>
      ),
    },
    {
      id: "submitted",
      title: "税務署に出す",
      body: (
        <p>
          <strong>{office}</strong>に
          {deadline && (
            <>
              <strong>{jpDate(deadline)}</strong>までに
            </>
          )}
          出します。窓口・郵送（控え用の返信封筒を同封）・e-Taxで出せます。
        </p>
      ),
    },
    {
      id: "paid",
      title: "相続税を納める",
      body:
        payers.length > 0 ? (
          <div>
            <p>申告と同じ期限までに、各自が納めます（税務署・金融機関の窓口、e-Tax、クレジットカード、30万円以下はコンビニ）。</p>
            <ul className="mt-1 space-y-0.5">
              {payers.map((p) => (
                <li key={p.person.id} className="flex justify-between gap-3 rounded bg-white px-2 py-1 tabular-nums">
                  <span>{p.person.name}</span>
                  <strong>{p.payable.toLocaleString("ja-JP")}円</strong>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p>納める税額は0円です。申告書の提出だけで完了です。</p>
        ),
    },
  ];
  const sid = (id: string) => `filing:${id}`;
  const doneCount = stages.filter((s) => plan.statusOf(sid(s.id)) === "done").length;

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-stone-800">申告が終わるまで</h2>
        <span className="text-sm text-stone-500">
          {doneCount}/{stages.length} 済
        </span>
      </div>
      <ol className="space-y-3">
        {stages.map((s, i) => {
          const done = plan.statusOf(sid(s.id)) === "done";
          const current = !done && stages.slice(0, i).every((x) => plan.statusOf(sid(x.id)) === "done");
          return (
            <li key={s.id} className={`rounded-xl border p-4 ${done ? "border-stone-200 bg-stone-50" : current ? "border-brand/50 bg-brand-soft/60" : "border-stone-200"}`}>
              <div className="flex items-center gap-3">
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold ${done ? "bg-stone-300 text-stone-600" : current ? "bg-brand text-white" : "bg-stone-200 text-stone-600"}`}>
                  {done ? <Check className="h-4 w-4" aria-hidden /> : i + 1}
                </span>
                <p className={`flex-1 font-bold ${done ? "text-stone-500" : "text-stone-900"}`}>{s.title}</p>
                <button
                  type="button"
                  onClick={() => {
                    plan.setStatus(sid(s.id), done ? "open" : "done");
                    if (s.id === "paid") plan.setStatus("inheritance-tax", done ? "open" : "done");
                  }}
                  className={`rounded-full px-3 py-2 text-xs font-semibold ${done ? "border border-stone-300 text-stone-600" : "bg-brand text-white"}`}
                >
                  {done ? "未完了に戻す" : { prepared: "作成済みにする", filled: "記入済みにする", attached: "そろった", submitted: "提出済みにする", paid: "納税済みにする" }[s.id]}
                </button>
              </div>
              {!done && <div className="mt-2 pl-10 text-sm leading-relaxed text-stone-700">{s.body}</div>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
