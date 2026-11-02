"use client";

import { useRouter } from "next/navigation";
import { Card, Note, TextInput } from "@/components/ui";
import { Choice, Counter, ManYen, Q, YesNo } from "@/components/plan/inputs";
import { isValidDate } from "@/domain/procedures/dates";
import { estimate, familyFromInterview, type Interview } from "@/domain/procedures/interview";
import { AppShell, PageHead } from "@/components/shell/AppShell";
import { useCase } from "@/lib/store";
import type { Person } from "@/domain/types";
import { usePlan } from "@/lib/planStore";

const LABEL: Record<string, string> = { spouse: "配偶者", child: "子", grandchild: "孫", parent: "親", sibling: "兄弟姉妹" };

/** 聞き取りの家族構成から、相続税申告の相続人の下書きを作る（名前は後で入力） */
function seedPersons(iv: Interview): Person[] {
  return familyFromInterview(iv).map((p) => ({ ...p, name: p.predeceased ? "（先に亡くなった子）" : `（${p.name}のお名前）`, relationLabel: LABEL[p.relation] }));
}

export function Hearing() {
  const { iv, saveIv, setHeard, loaded } = usePlan();
  const { data: c, replace } = useCase();
  const router = useRouter();
  const set = <K extends keyof Interview>(k: K, v: Interview[K]) => saveIv({ ...iv, [k]: v });
  const est = estimate(iv);
  const dateOk = isValidDate(iv.deathDate);
  const noHeirs = est.heirCount === 0 && !iv.spouse;

  function finish() {
    setHeard(true);
    // まだ何も入っていない相続税申告には、亡くなった方と家族構成の下書きを入れておく
    if (c.persons.length === 0 && c.assets.length === 0) {
      replace({ ...c, title: `${iv.decedentName || ""}さんの相続`, decedent: { ...c.decedent, name: iv.decedentName, deathDate: iv.deathDate, address: iv.address }, persons: seedPersons(iv) });
    } else if (c.decedent.deathDate !== iv.deathDate && c.persons.length === 0) {
      replace({ ...c, decedent: { ...c.decedent, name: iv.decedentName, deathDate: iv.deathDate, address: iv.address } });
    }
    router.push("/my");
  }

  if (!loaded) return null;
  return (
    <AppShell>
      <div className="mx-auto max-w-3xl pb-24">
      <PageHead title="最初に、状況を教えてください" say="いくつかの質問に答えるだけで、あなたの手続きの道筋が見えてきます！金額はだいたいで大丈夫です。" />

      <div className="mt-6 space-y-5">
        <Card title="1. 亡くなった方">
          <Q label="お名前（任意）">
            <TextInput value={iv.decedentName} onChange={(e) => set("decedentName", e.target.value)} placeholder="例：相続 太郎" />
          </Q>
          <Q label="亡くなった方は、あなたから見て？" hint="窓口に電話するときの伝え方の文例に使います。">
            <Choice value={iv.myRelation} onChange={(v) => set("myRelation", v)} options={["父", "母", "夫", "妻", "祖父", "祖母", "その他"].map((x) => ({ value: x, label: x }))} />
          </Q>
          <Q label="亡くなった方の最後の住所" hint="死亡届や相続税申告の提出先（市区町村役場・税務署など）を調べるのに使います。この端末にだけ保存されます。">
            <TextInput value={iv.address} onChange={(e) => set("address", e.target.value)} placeholder="例：東京都千代田区架空町一丁目2番3号" />
          </Q>
          <Q label="亡くなった日" hint="期限はこの日から数えます。">
            <TextInput type="date" value={iv.deathDate} onChange={(e) => set("deathDate", e.target.value)} className="max-w-56" />
          </Q>
        </Card>

        <Card title="2. ご家族">
          <Q label="配偶者（夫・妻）はご存命ですか？">
            <YesNo value={iv.spouse} onChange={(v) => set("spouse", v)} />
          </Q>
          <Q label="お子さんは何人いますか？" hint="養子も含めます。先に亡くなったお子さんは次の質問で答えてください。">
            <Counter value={iv.children} onChange={(v) => set("children", v)} />
          </Q>
          <Q label="先に亡くなったお子さんに、子ども（孫）はいますか？" hint="その孫が代わりに相続人になります（代襲相続）。いなければ0人のままで。">
            <Counter value={iv.grandchildrenOfPredeceased} onChange={(v) => set("grandchildrenOfPredeceased", v)} />
          </Q>
          {iv.children === 0 && iv.grandchildrenOfPredeceased === 0 && (
            <>
              <Q label="亡くなった方のご両親で、ご存命の方は何人ですか？">
                <Counter value={iv.parentsAlive} onChange={(v) => set("parentsAlive", v)} max={2} />
              </Q>
              {iv.parentsAlive === 0 && (
                <Q label="亡くなった方の兄弟姉妹は何人いますか？">
                  <Counter value={iv.siblings} onChange={(v) => set("siblings", v)} />
                </Q>
              )}
            </>
          )}
          <Q label="相続人の中に、18歳未満の方はいますか？">
            <YesNo value={iv.minorHeir} onChange={(v) => set("minorHeir", v)} />
          </Q>
          <Q label="相続人の中に、海外に住んでいる方はいますか？">
            <YesNo value={iv.heirAbroad} onChange={(v) => set("heirAbroad", v)} />
          </Q>
          <p className="mt-2 rounded-lg bg-teal-50 px-4 py-3 text-sm text-teal-900">
            相続税の計算に使う相続人の数は <strong>{est.heirCount}人</strong>、基礎控除は <strong>{(est.basicDeduction / 10_000).toLocaleString()}万円</strong> です。
          </p>
          {noHeirs && <Note tone="warn">相続人がいない場合は、家庭裁判所で相続財産清算人を選ぶ手続きになります。専門家に相談してください。</Note>}
        </Card>

        <Card title="3. 遺言書と借金">
          <Q label="遺言書はありますか？">
            <Choice
              value={iv.will}
              onChange={(v) => set("will", v)}
              options={[
                { value: "none", label: "ない" },
                { value: "notarized", label: "公正証書遺言がある" },
                { value: "handwritten", label: "自筆の遺言書が見つかった" },
                { value: "handwrittenStored", label: "法務局に預けている" },
                { value: "unknown", label: "分からない" },
              ]}
            />
          </Q>
          <Q label="借金やローンはありますか？">
            <Choice
              value={iv.debts}
              onChange={(v) => set("debts", v)}
              options={[
                { value: "none", label: "ない" },
                { value: "some", label: "少しある" },
                { value: "large", label: "財産より多いかも" },
                { value: "unknown", label: "分からない" },
              ]}
            />
          </Q>
          {iv.debts === "large" && <Note tone="warn">借金が多い場合は、3か月以内なら相続放棄ができます。財産を使ったり処分したりすると放棄できなくなるので注意してください。</Note>}
        </Card>

        <Card title="4. 財産のおおよその額">
          <p className="mb-3 text-sm text-stone-600">相続税がかかりそうかを判定するための目安です。分からないものは0のままで構いません。</p>
          <div className="grid gap-x-6 sm:grid-cols-2">
            <Q label="自宅（土地・建物）" hint="固定資産税の通知書の評価額や、近所の相場から。">
              <ManYen value={iv.homeValue} onChange={(v) => set("homeValue", v)} />
            </Q>
            <Q label="自宅以外の土地・建物">
              <ManYen value={iv.otherRealEstate} onChange={(v) => set("otherRealEstate", v)} />
            </Q>
            <Q label="預貯金・現金">
              <ManYen value={iv.deposits} onChange={(v) => set("deposits", v)} />
            </Q>
            <Q label="株式・投資信託">
              <ManYen value={iv.securities} onChange={(v) => set("securities", v)} />
            </Q>
            <Q label="生命保険金（亡くなった方が保険料を払っていたもの）">
              <ManYen value={iv.insurance} onChange={(v) => set("insurance", v)} />
            </Q>
            <Q label="その他（車・貴金属・貸したお金など）">
              <ManYen value={iv.otherAssets} onChange={(v) => set("otherAssets", v)} />
            </Q>
            <Q label="借金・未払いの税金や医療費">
              <ManYen value={iv.debtAmount} onChange={(v) => set("debtAmount", v)} />
            </Q>
            <Q label="葬儀費用">
              <ManYen value={iv.funeralCost} onChange={(v) => set("funeralCost", v)} />
            </Q>
          </div>
          {iv.homeValue > 0 && (
            <Q label="自宅は、配偶者か同居している家族が受け継ぎますか？" hint="受け継ぐ場合は、小規模宅地等の特例で自宅の土地の評価が最大80%下がる可能性があります。">
              <YesNo value={iv.homeToFamily} onChange={(v) => set("homeToFamily", v)} />
            </Q>
          )}
        </Card>

        <Card title="5. 暮らしのこと">
          <Q label="亡くなった方のお仕事は？">
            <Choice
              value={iv.work}
              onChange={(v) => set("work", v)}
              options={[
                { value: "pension", label: "年金生活" },
                { value: "employee", label: "会社員・公務員" },
                { value: "selfEmployed", label: "自営業・個人事業" },
                { value: "none", label: "その他" },
              ]}
            />
          </Q>
          <Q label="年金を受け取っていましたか？">
            <Choice
              value={iv.pension}
              onChange={(v) => set("pension", v)}
              options={[
                { value: "employees", label: "厚生年金（会社員だった）" },
                { value: "national", label: "国民年金だけ" },
                { value: "none", label: "受け取っていない" },
              ]}
            />
          </Q>
          <Q label="健康保険は？" hint="保険証に書いてあります。75歳以上は後期高齢者医療です。">
            <Choice
              value={iv.health}
              onChange={(v) => set("health", v)}
              options={[
                { value: "kouki", label: "後期高齢者医療" },
                { value: "kokuho", label: "国民健康保険" },
                { value: "shaho", label: "会社の健康保険" },
                { value: "unknown", label: "分からない" },
              ]}
            />
          </Q>
          <Q label="毎年、確定申告をしていましたか？" hint="不動産の賃貸収入や事業収入があった場合など。">
            <YesNo value={iv.filedTaxReturn} onChange={(v) => set("filedTaxReturn", v)} />
          </Q>
          <Q label="亡くなる前に入院するなど、医療費が多くかかりましたか？">
            <YesNo value={iv.highMedical} onChange={(v) => set("highMedical", v)} />
          </Q>
          <Q label="亡くなった方は世帯主で、同じ世帯に2人以上が残りますか？">
            <YesNo value={iv.householdHead} onChange={(v) => set("householdHead", v)} />
          </Q>
          <Q label="賃貸住宅に住んでいましたか？">
            <YesNo value={iv.rentedHome} onChange={(v) => set("rentedHome", v)} />
          </Q>
          <Q label="自動車を持っていましたか？">
            <YesNo value={iv.car} onChange={(v) => set("car", v)} />
          </Q>
          <Q label="スマートフォンやネット銀行を使っていましたか？">
            <YesNo value={iv.digital} onChange={(v) => set("digital", v)} />
          </Q>
          {iv.heirAbroad && <Note tone="info">海外に住む相続人は、印鑑証明書の代わりに現地の日本大使館等でサイン証明・在留証明を取ります。相続税は税理士への相談をおすすめします。</Note>}
        </Card>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <p className="text-sm text-stone-600">{dateOk ? "答えはこの端末にだけ保存されます。" : "亡くなった日を入力してください。"}</p>
          <button
            type="button"
            disabled={!dateOk}
            onClick={finish}
            className="rounded-lg bg-sky-700 px-6 py-3 font-semibold text-white hover:bg-sky-800 disabled:bg-stone-300"
          >
            次へ（マイページへ） →
          </button>
        </div>
      </div>
      </div>
    </AppShell>
  );
}
