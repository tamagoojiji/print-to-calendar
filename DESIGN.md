# DESIGN.md — print-to-calendar

> **【v2: 販売版アーキテクチャ（2026-06〜）】**
> Phase 1（クライアントのみPWA）から、バックエンド付きの販売プロダクトへ移行。
> 以下の「## 1. 概要」以降はv1（クライアントのみ）の設計で履歴として残す。v2の正は本ブロック。
>
> ### 何が変わったか
> | 項目 | v1 | v2（販売版） |
> |---|---|---|
> | Geminiキー | ユーザーがlocalStorageに入力 | **バックエンドに隠蔽**（フロント不可視） |
> | バックエンド | なし | **VPS + Hono/Node + SQLite(better-sqlite3)**（`server/`） |
> | 課金 | なし | Stripe Payment Links + Webhook → ライセンス自動発行 |
> | ライセンス | なし | キー発行・HMACハッシュ照合・6ヶ月期限・月30回制限・翌月遅延リセット |
> | Googleカレンダー | 未実装 | **サーバー側OAuth + refresh token AES-256-GCM暗号化保存 + 自動同期** |
> | 予定保存先 | localStorage | DB（saved_events） |
> | 通知 | なし | 同期失敗時にDiscord Webhookへ原因付き通知 |
> | サポート | なし | 購入後3ヶ月無料 + 半年500円の有料サポート土台 |
> | その他 | なし | .ics出力 / 最低限の管理画面 / 複数アプリ共通ライセンス基盤 |
>
> ### 構成
> - フロント（このリポジトリ直下）: ライセンスキー方式に改修。`VITE_API_BASE` でバックエンドを指す。
> - バックエンド: `server/`（Hono/Node、SQLite、Docker）。詳細は `server/README.md`。
> - DB: 10テーブル（apps / plans / users / licenses / purchases / support_contracts /
>   google_connections / saved_events / calendar_sync_logs / usage_logs）+ oauth_states + license_reveals。
>   運用は print-to-calendar 1アプリのみ、構造は複数アプリ対応。
>
> ### セキュリティ原則
> - フロントに置かない: Geminiキー / Stripe secret / Webhook secret / Google secret /
>   Discord Webhook URL / ライセンス発行ロジック / 暗号鍵。すべてVPSの `.env`。
> - ライセンスキーはDBに平文保存せず HMAC-SHA256 ハッシュのみ。refresh tokenはAES-256-GCM暗号化。
>
> ### 残タスク（このv2初期構築の対象外＝後続フェーズ）
> - Phase 0（外部サービス作成）: `server/README.md` の手順をユーザーが実施
> - VPS上での実起動・E2E疎通確認（ローカルはbetter-sqlite3ネイティブビルド不可のため未実施）
> - LifeBear / TimeTree 向け案内画面、利用期限切れ画面などUIの作り込み
> - プライバシーポリシー / 特商法 / 利用規約（`terms-check` スキル）
>
> ---

## 1. 概要
- **一言で**: 子供の学校・塾の予定プリントを撮影 → Geminiで解析 → Googleカレンダーに登録するPWA
- **ターゲット**: 子育て中のスマホユーザー（最初はユーザー本人）
- **提供方法**: GitHub Pages（PWA）
- **実行環境**: クライアントのみ（バックエンドなし）
- **コスト**: 0円運用（Gemini無料枠 + GitHub Pages無料）

## 2. 機能一覧
| # | 機能名 | 説明 | 優先度 |
|---|--------|------|--------|
| 1 | 画像アップロード | カメラ撮影 or アルバムから画像選択 | 必須 |
| 2 | Gemini解析 | 画像から日付・時間・内容を抽出 | 必須 |
| 3 | 解析結果の編集 | 日付・時間・内容をテーブルで修正・追加・削除 | 必須 |
| 4 | localStorage保存 | 端末内に予定を保持・一覧表示 | 必須 |
| 5 | Googleカレンダー登録 | OAuthでログイン → 選択した予定をカレンダーに追加 | Phase 2（必須） |
| 6 | APIキー設定画面 | Gemini APIキーをlocalStorageに保存 | 必須 |
| 7 | PWA化 | ホーム画面追加・オフライン起動 | あれば嬉しい |

## 3. 画面一覧
| 画面名 | 用途 | 主な表示要素 |
|--------|------|-------------|
| メイン | 画像アップロード + 解析結果編集 + 反映ボタン | アップロードボタン、解析中スピナー、編集テーブル、「保存」「Googleカレンダーに送信」ボタン |
| 一覧 | 登録済み予定の確認 | 日付順リスト、Googleカレンダーへの再送信、削除 |
| 設定 | Gemini APIキー + Googleアカウント連携 | APIキー入力欄、Googleログインボタン、ログアウト |

## 4. データ構造
### 保存先: localStorage（端末内のみ）

```
ptc_events: [
  {
    id: string,             // 一意ID
    date: "YYYY-MM-DD",
    time: "HH:MM" | "",
    content: string,        // 予定内容
    url?: string,           // 画像から拾ったURLがあれば
    googleEventId?: string, // Googleカレンダー登録後にセット
    createdAt: number,
  }
]
ptc_gemini_key: string   // Gemini APIキー
ptc_google_token: string // Google OAuthアクセストークン（揮発、期限切れたら再ログイン）
```

### 保存しないもの
- 画像の生データ（解析後は破棄）
- 個人情報・子供の名前等（あくまで予定本文のみ）

## 5. 外部サービス・API
| サービス | 用途 | 認証方法 |
|----------|------|----------|
| Gemini API | 画像解析（gemini-2.5-flash） | APIキー（localStorage） |
| Google Calendar API | 予定登録 | OAuth 2.0（Google Identity Services / GIS） |
| GitHub Pages | ホスティング | — |

### 環境変数
PWA（クライアントのみ）なので、ビルド時に埋め込むのは **OAuth Client ID のみ**。
| キー | 説明 | 取得元 |
|------|------|--------|
| VITE_GOOGLE_CLIENT_ID | Google OAuth Client ID（Web） | Google Cloud Console |

※ Gemini APIキーは設定画面でユーザーが入力（localStorage保存）。

## 6. ユーザー作業（セットアップと最終確認）

### Phase 0: セットアップ（ユーザー作業）
所要時間: 約15〜20分

Claude Codeが事前に完了させること:
- [ ] 新規Viteプロジェクト作成 + 基本コードコピー（既存ShiftImport.tsx の Event 部分 + gemini.ts のevent解析）
- [ ] .env.example 作成（VITE_GOOGLE_CLIENT_ID のみ）
- [ ] vite.config.ts に base 設定（GitHub Pages用）
- [ ] PWA manifest + sw.js 配置

ユーザーがブラウザで行うこと:
- [ ] **Gemini APIキー取得**（既存のshift-calendarで使っているキーを流用可: localStorage `shift_gemini_key`）
      URL: https://aistudio.google.com/apikey
- [ ] **Google Cloud Console で OAuth Client ID 作成**（Phase 2用、後でもOK）
      URL: https://console.cloud.google.com/apis/credentials
      - 新規プロジェクト作成 or 既存利用
      - 「Google Calendar API」を有効化
      - OAuth同意画面を設定（外部、テストユーザー = 自分のGmail）
      - 認証情報 > OAuth 2.0 クライアントID（ウェブ）
      - 承認済みのJavaScript生成元: `https://tamagoojiji.github.io`
      - リダイレクトURIは不要（GIS popup方式）
- [ ] **新規GitHubリポジトリ作成**: `print-to-calendar`

ユーザー作業完了後、Claude Codeに「できた」と伝える。
→ Claude が npm install → ビルド → gh-pages デプロイ → 動作確認。

### ルール
- APIキー・トークンの値はClaude Codeに直接渡さない（設定画面でユーザー入力）
- OAuth Client ID は機密ではないので `.env` でビルドに埋め込んでよい

## 7. フェーズ定義
| Phase | 内容 | ローカル完了条件 | デプロイ完了条件 |
|-------|------|-----------------|------------|
| 0 | リポジトリ作成・OAuthクライアント発行 | — | ユーザー作業完了 |
| 1 | 画像→Gemini解析→localStorage保存→一覧表示 | `npm run dev` で画像をアップして解析結果が編集テーブルに出る / 保存ボタンで localStorage に入る | gh-pages デプロイ後、本番URLで同じ動作を確認 |
| 2 | Googleカレンダー同期 | ローカルで Googleログイン → 1件選んで送信 → カレンダー側で確認 | 本番URLで同じ動作 |
| 3 | PWA化（manifest + sw.js） | Chrome DevTools の Application タブで PWA インストール可能 | iPhoneでホーム画面追加 → 起動確認 |

### 開発フロー
```
各Phase内の流れ:
  ローカル開発（Claude Code自律）
    ├── コード作成・編集
    ├── npm run dev で動作確認（curl は不可、ブラウザ手動 or playwright）
    ├── 完了条件を満たす
    └── git commit
  デプロイ（Claude Code自律）
    ├── npm run build
    ├── npx gh-pages -d dist -m "..."
    ├── curl で本番アセットを取って差し替わったか確認
    └── 完了条件を満たす → 次のPhaseへ
```

### 完了条件の書き方
- ローカル完了条件: ブラウザでの動作確認（自動化できる範囲は playwright MCP）
- 本番完了条件: `curl` でアセットの差し替えを確認 + ユーザーに実機確認依頼

## 8. ファイル構成（計画）
```
print-to-calendar/
├── index.html
├── vite.config.ts          — base設定 + PWA
├── package.json
├── .env.example            — VITE_GOOGLE_CLIENT_ID のみ
├── public/
│   ├── manifest.json
│   └── sw.js               — オフライン起動用（fetch キャッシュなし）
└── src/
    ├── main.tsx
    ├── App.tsx             — ルーティング（Main / List / Settings）
    ├── components/
    │   ├── EventImport.tsx — 既存ShiftImport.tsx の EventImport を移植
    │   ├── EventList.tsx   — 登録済み一覧
    │   └── Settings.tsx    — APIキー設定 + Googleログイン
    ├── utils/
    │   ├── gemini.ts       — analyzeEventImage のみ移植
    │   ├── storage.ts      — ptc_events の CRUD
    │   └── googleCalendar.ts — GIS + Calendar API（Phase 2）
    └── index.css
```

## 9. やらないこと
- 月カレンダーUI（一覧表示のみ。Googleカレンダー側で見ればよい）
- 複数ユーザー対応・Firestore同期
- 画像の永続保存
- ネイティブアプリ化（PWAで十分）
- 通知・リマインダー（Googleカレンダー側に任せる）

## 10. 既知の制約・注意
- **Gemini無料枠**: gemini-2.5-flash は 1日 1500 リクエストまで。家族利用なら十分
- **Google OAuth テストユーザー**: 同意画面が「テスト中」状態だと使えるユーザーは登録した人のみ（自分が使う分には問題なし）
- **iOSのPWA**: Safari Webプッシュは別実装が必要（今回はスコープ外）
- **GitHub Pages**: `gh-pages` ブランチデプロイ。`main` push では反映されない（既存shift-calendarと同じ）
