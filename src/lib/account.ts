/**
 * 簡易の利用者登録。名前とメールアドレスをこの端末のブラウザにだけ保存する（サーバーにアカウントは作らない）。
 * ハッカソンのデモ用の簡易版で、本番運用ではログイン基盤に置き換える前提。
 */
export interface Account {
  name: string;
  email: string;
  createdAt: string;
  demo?: boolean;
}
