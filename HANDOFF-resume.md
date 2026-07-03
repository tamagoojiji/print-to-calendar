# print-to-calendar 作業引き継ぎ（2026-06-10）

この続きをお願いします。現状は以下です。

## ゴール
PWA「print-to-calendar」（プリント撮影→AI解析→Googleカレンダー登録）を、アプリ保管庫 app.tamago-ai-world.com で有料販売できる状態にする。

## 完了済み（すべて本番稼働・実機検証済み）
- TLS証明書発行→HTTPS公開、フロント gh-pages 公開、保管庫カタログに専用サムネ付き¥500で掲載
- 決済統合B1: 保管庫で購入→Stripe webhook→PTCの `POST /provision` でライセンス自動発行→done.htmlでキー表示→PWAで有効化（実機で購入〜利用まで完走）
- Googleカレンダー連携（OAuth設定済み・テストモード）
- Gemini解析の不具合修正（思考トークン問題）→ プリント解析→カレンダー登録 成功

## リポジトリ / デプロイ
- PTC: `~/print-to-calendar`（GitHub: tamagoojiji/print-to-calendar, branch `feat/sales-mvp-backend`）。`server/` がバックエンド。
  - VPS: `/opt/docker/print-to-calendar/`、compose `/opt/docker/docker-compose.yml`、サービス名 `print-to-calendar`
  - デプロイ: `src/` を scp → `cd /opt/docker && docker compose up -d --build print-to-calendar`
- vault: `~/tamago-app-vault`（GitHub: tamagoojiji/tamago-app-vault [private], branch `master`）
  - VPS: `/opt/docker/tamago-app-vault/`、サービス名 `vault-api`。`web/` はマウント(即時反映)、`api/` はイメージビルド(要 `--build`)。`catalog.json` 変更後は vault-api 再起動(キャッシュのため)
- SSH: `ssh vps`（Contabo / 207.180.238.184）

## VPS .env の状態（値は確認しない・SET/EMPTYのみ）
- PTC `/opt/docker/print-to-calendar/.env`: GOOGLE_CLIENT_ID/SECRET=設定済 / GEMINI_API_KEY=設定済 / PROVISION_TOKEN=設定済 / GOOGLE_REDIRECT_URI=設定済。STRIPE_*（PTC自前）=未設定（保管庫経由販売では不要）
- vault `/opt/docker/tamago-app-vault/api/.env`: STRIPE_SECRET_KEY/WEBHOOK_SECRET=設定済（**sk_test＝テストモード**）/ PTC_PROVISION_TOKEN=設定済（PTCと同値）/ LIFF_CHANNEL_ID 等=設定済

## 未完了（実販売の前に必要）
1. ~~**Stripe本番化**~~ → **完了（2026-06-11）**: BridgeSquareは有効化済みだった。sk_liveをロール再発行→VPSの vault `.env` 更新（ユーザー直接入力）、本番Webhook登録（`https://app.tamago-ai-world.com/api/webhook`、checkout.session.completed）、vault-api再作成済み。POST無署名→400で疎通確認OK。※composeは `/opt/docker/tamago-app-vault/` 配下（`/opt/docker/docker-compose.yml` ではない）。実購入テストは未実施
2. ~~**Google同意画面の公開**~~ → **公開済み（2026-06-12）**: ステータスを「本番」に切替（審査は未申請）。テストユーザー登録不要・refresh token無期限に。ユーザー実機で再連携成功済み。残る制約: 連携時「確認されていないアプリ」警告（詳細→移動で突破可）＋審査完了まで累計100ユーザー上限。警告を消すにはGoogle審査（ドメイン所有確認・スコープ説明文・デモ動画）
   ※フロントdeployは必ず `npm run deploy`（package.jsonにVITE_API_BASE組み込み済み・2026-06-12）。素のviteビルドで公開するとAPIが404になる事故が起きた
3. ~~**特商法表記**の用意~~ → **完了（2026-06-10）**: 保管庫に特商法・利用規約・プラポリの3点を新設（https://app.tamago-ai-world.com/legal/ 配下、トップ・done.htmlフッターからリンク）。PTC側 LEGAL/ と public/legal/ も「販売場所=保管庫」に更新し gh-pages 公開済み。事業者情報は BridgeSquare（屋号表示・請求時開示のB案）、問い合わせ先は tamagoojiji@gmail.com に全書類統一。vault リポジトリは master に集約済み（feat/catalog-registry-phase1 は master と同内容で残置）。

## 直近の作業（いまここ）
実販売前の最終確認フェーズ。残り: ①本番Stripeでの実購入テスト1回（実損は手数料約¥18のみ・返金可）②プリント解析→カレンダー登録の一周確認 ③（任意）Google審査申請で「確認されていないアプリ」警告の除去と100人上限の解除。

## 重要な注意・ハマりどころ
- **秘密厳守**: APIキー/トークンの値をターミナルに流さない・ファイルに書かない。SET/EMPTY・文字数・HTTPステータスだけで判定。鍵設定はVPS上でユーザーが直接入力。
- `.env` 変更は `docker compose restart` では効かない → `up -d --force-recreate`
- vault `catalog.py` はキャッシュ → `catalog.json` 変更後は vault-api 再起動
- Gemini 2.5-flash は思考トークンで maxOutputTokens を食う → `thinkingConfig:{thinkingBudget:0}` + `responseMimeType:"application/json"` + `maxOutputTokens:8192` で解決済（`server/src/lib/gemini.ts`）
- `catalog.json` はユーザーが拡張済み（type/category/tags/visibility/order 等のフィールド、kakeibo 等も掲載）。print-to-calendar は `type:"pwa", price:500, provision:"ptc"`
- 設計書: `~/tamago-app-vault/DESIGN-ptc-payment.md` ／ 再開メモ: `~/print-to-calendar/server/PHASE0-RESUME.md`

## 関連URL（確認済みの正値・推測でない）
- PWA: https://tamagoojiji.github.io/print-to-calendar/
- バックエンド: https://print-to-calendar.tamago-ai-world.com （/health, /provision, /api/google/oauth/callback, /webhook/stripe）
- 保管庫: https://app.tamago-ai-world.com/
- Google リダイレクトURI: https://print-to-calendar.tamago-ai-world.com/api/google/oauth/callback
