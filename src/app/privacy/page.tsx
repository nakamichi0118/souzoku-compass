import Link from "next/link";
import { LogoMark } from "@/components/compass/CompassKun";

export const metadata = { title: "プライバシーポリシー｜相続コンパス" };

const SECTIONS: { h: string; p: string[] }[] = [
  {
    h: "1. 保存する情報",
    p: [
      "利用者登録で入力したお名前・メールアドレスと、パスワードを復元できない形（ハッシュ）にしたもの。",
      "マイページで入力した内容（聞き取りの答え、手続きの記録とメモ、財産・債務・遺産の分け方など）。ログインした本人だけが読み書きできるよう、Google Cloud（Firestore、東京リージョン）に保存します。",
      "デモ（架空の家族）は、お使いのブラウザの中だけで動き、サーバーには保存しません。",
      "撮影・アップロードした書類の画像・PDF。ログインした本人だけが読み書きできるよう、Google Cloud（Firestore、東京リージョン）に保存します（デモではブラウザの中だけ）。税務署に出す書類一式のPDFはお使いの端末の中で作ります。",
    ],
  },
  {
    h: "2. AI（Anthropic社のClaude）へ送る情報",
    p: [
      "コンパスくんに自由に質問したとき：質問文と、回答に必要な範囲の入力内容の要約。画面に用意した想定質問は、あらかじめ用意した回答を表示するだけで、どこにも送りません。",
      "書類の読み取り（残高証明書など）・書類の仕分け・路線価図の読み取りのとき：選んだファイルや画像。",
      "窓口の連絡先を調べるとき：窓口の種類と住所（市区町村まで）。",
      "申告前の確認で、コンパスくんに詳しく話したとき：その項目についてのやりとり。",
      "AIへ送った内容は回答の作成にだけ使い、相続コンパスのサーバーには保存しません。Anthropic社での取り扱いは同社の方針に従います。質問にお名前や住所を書く必要はありません。",
    ],
  },
  {
    h: "3. 申告書などのPDFを作るとき",
    p: ["入力内容をサーバーへ送り、PDFを作ってお返しします。PDFも入力内容もサーバーには残しません。"],
  },
  {
    h: "3の2. 税理士への相談",
    p: [
      "相談のフォームから送ったお名前・都道府県・連絡先・相談内容と、その後のやりとり・打ち合わせの案内は、相談を受ける税理士事務所（アイユーコンサルティング）と共有するため、Google Cloud（Firestore、東京リージョン）に保存します。",
      "フォームを送るまで、相談の内容は事務所には届きません。",
    ],
  },
  {
    h: "4. 外部のサービス",
    p: ["地図は国土地理院の地理院タイル、住所の検索は国土地理院のAPI、路線価図は国税庁のサイトから取得します。"],
  },
  {
    h: "5. ご注意",
    p: [
      "相続コンパスは「Built with Claude: Japan 2026」ハッカソンの試作です。実在の方の情報ではなく、架空の内容でお試しください。",
      "登録の削除を希望される場合は、運営者までご連絡ください。",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="flex items-center gap-2 text-lg font-bold text-sky-950">
        <LogoMark size={30} />
        相続コンパス
      </Link>
      <h1 className="mt-6 text-2xl font-bold text-stone-900">プライバシーポリシー</h1>
      <div className="mt-6 space-y-6 text-sm leading-relaxed text-stone-700">
        {SECTIONS.map((s) => (
          <section key={s.h}>
            <h2 className="mb-2 font-bold text-stone-900">{s.h}</h2>
            <ul className="list-disc space-y-1 pl-5">
              {s.p.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
