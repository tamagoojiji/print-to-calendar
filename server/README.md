# print-to-calendar backend

販売版 print-to-calendar のバックエンド（Hono + better-sqlite3）。
Geminiキー・Stripe secret・Google secret・暗号鍵をフロントから隠蔽し、
ライセンス検証 / 画像解析 / Googleカレンダー同期 / Stripe Webhook / 管理画面を提供する。

## 構成
```
server/
├── src/
│   ├── index.ts          Honoアプリ（ルートのマウント・CORS・起動）
│   ├── db.ts             SQLite初期化 + マイグレーション + 初期データ
│   ├── schema.sql/.ts    DDL（10テーブル + oauth_states + license_reveals）
│   ├── env.ts            環境変数
│   ├── lib/              crypto / license / gemini / google / stripe / discord / ics / time / ids
│   ├── services/         issueLicense（ライセンス発行）/ sync（Google同期エンジン）
│   └── routes/           license / analyze / events / google / webhook / admin
├── Dockerfile
├── docker-compose.snippet.yml
└── env.sample
```

## API一覧
| メソッド | パス | 用途 |
|---|---|---|
| POST | `/api/license/validate` | ライセンス検証（期限・月間残回数・サポート状態） |
| POST | `/api/analyze` | 画像をGemini解析（検証→月30回チェック→+1） |
| POST | `/api/events/save-and-sync` | 予定保存＋Googleカレンダー自動登録 |
| POST | `/api/events/update-and-sync` | 予定更新＋Google更新 |
| POST | `/api/events/delete` | 削除（`deleteFromGoogle`でGoogle側も削除） |
| POST | `/api/events/retry-sync` | 同期失敗予定の再同期 |
| GET  | `/api/events` | 保存済み一覧 |
| POST | `/api/events/ics` | .icsファイル出力 |
| GET  | `/api/google/oauth/start` | Google認可開始（リダイレクト） |
| GET  | `/api/google/oauth/callback` | 認可コールバック（refresh token暗号化保存） |
| GET  | `/api/google/status` / `/calendars` | 連携状態・カレンダー一覧 |
| POST | `/api/google/default-calendar` / `/disconnect` | 登録先設定・連携解除 |
| POST | `/webhook/stripe` | Stripe Webhook（署名検証・冪等・ライセンス発行） |
| GET  | `/webhook/result` | 購入直後に1回だけライセンスキー取得 |
| GET  | `/admin` | 管理ダッシュボード（ADMIN_TOKEN） |

## ローカル開発
```bash
cd server
npm install
cp env.sample .env   # 値を記入
npm run dev          # tsx watch（:8787）
```
※ better-sqlite3 はネイティブモジュール。ビルドに python3 / make / g++ が必要
（Dockerfileでは導入済み。Linux/VPSでは問題なし。macOSはXcode Command Line Toolsが必要）。

## デプロイ（VPS / Docker）
`~/print-to-calendar/CLAUDE.md` と `docker-compose.snippet.yml` を参照。

```bash
scp -r server/ vps:/opt/docker/print-to-calendar/
ssh vps "cd /opt/docker/print-to-calendar && cp env.sample .env"   # 実値を記入（次のPhase 0）
# docker-compose.snippet.yml の services を /opt/docker/docker-compose.yml に追記後:
ssh vps "cd /opt/docker && docker compose up -d --build print-to-calendar"
ssh vps "curl -s localhost:8787/health"
```

公開は前段のリバースプロキシ（nginx / caddy）でTLS終端し、
`https://<api-host>` を `GOOGLE_REDIRECT_URI` と Stripe Webhook の宛先、フロントの `VITE_API_BASE` に使う。

---

# Phase 0：ユーザーが行うセットアップ作業

新規作成が必要なのは **Stripe / Google OAuth / Discord Webhook / 各シークレット** の4種。
（Cloudflareアカウントは今回VPS採用のため不要。Gemini APIキーは既存のものを流用可。）

## 1. シークレット生成（VPS上で）
```bash
openssl rand -hex 32   # → LICENSE_SECRET に
openssl rand -hex 32   # → TOKEN_ENCRYPTION_SECRET に
openssl rand -hex 24   # → ADMIN_TOKEN に
```
※ `LICENSE_SECRET` / `TOKEN_ENCRYPTION_SECRET` は後から変えると
発行済みライセンス・保存済みrefresh tokenが無効化されるので確定したら固定。

## 2. Google Cloud（OAuth Web クライアント）
- https://console.cloud.google.com/apis/credentials
- 「Google Calendar API」を有効化
- OAuth同意画面（外部）：スコープ `calendar.events` `calendar.readonly` を追加。テスト中はテストユーザーに購入者を登録 → 本番公開申請（審査）
- 認証情報 → OAuthクライアントID（ウェブ）：
  - 承認済みリダイレクトURI: `https://<api-host>/api/google/oauth/callback`
- 取得した `client_id` / `client_secret` を `.env` の `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` に

## 3. Stripe（Payment Links + Webhook）
- 商品「print-to-calendar 6ヶ月」¥500 を作成 → Payment Link発行
  - 成功時リダイレクト先（success_url）に `?session_id={CHECKOUT_SESSION_ID}` を付ける
    例: `https://tamagoojiji.github.io/print-to-calendar/?session_id={CHECKOUT_SESSION_ID}`
- Webhook エンドポイント追加: `https://<api-host>/webhook/stripe`、イベント `checkout.session.completed`
- `STRIPE_SECRET_KEY`（sk_live_…）と Webhookの署名シークレット `whsec_…` を `.env` に

## 4. Discord（同期エラー通知）
- 通知用チャンネルのWebhook URLを `DISCORD_ERROR_WEBHOOK_URL` に
  （Claude Codeの `discord-channel-create` スキルで新規作成も可）

## 5. Gemini
- `GEMINI_API_KEY` に既存キー（https://aistudio.google.com/apikey）

## 6. フロント側
- リポジトリ直下 `cp env.sample .env` → `VITE_API_BASE=https://<api-host>` → `npm run build` → `npx gh-pages -d dist`

設定完了後、`/health` と管理画面（`https://<api-host>/admin`）で疎通確認し、
管理画面の「手動発行」でテスト用ライセンスを作って一連の流れ（連携→撮影→確認→保存→同期）を実機確認する。
