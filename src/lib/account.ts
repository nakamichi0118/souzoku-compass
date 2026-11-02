/** 画面に表示する利用者（ログイン中の人、またはデモの架空の利用者） */
export interface Account {
  name: string;
  email: string;
  createdAt: string;
  demo?: boolean;
}
