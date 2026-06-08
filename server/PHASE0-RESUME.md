# Phase 0 デプロイ 再開手順（2026-06-02 中断時点）

販売版MVPのVPSデプロイ作業の続き。**証明書発行の直前で中断**。明日以降はここから再開する。

---

## いまの状態（done / 残り）

### ✅ 完了
- バックエンドをVPSにデプロイ済み。コンテナ `print-to-calendar` 稼働中（`restart: unless-stopped`）
- 内部E2E成功（`/health` / 管理API手動発行 / ライセンス検証 / 不正キー拒否）
- DNS: `print-to-calendar.tamago-ai-world.com` → `207.180.238.184`（権威ConoHa登録済み・主要resolver伝播確認済み）
- nginx の **`:80` だけの vhost** 作成済み（ACMEチャレンジ＋https리ダイレクト）
- **TLS証明書発行済み**（Let's Encrypt / 2026-06-06発行・2026-09-03期限）
- **nginx `:443` ブロック追加・リロード済み**（バックアップ `*.bak-ptc-443-*` あり）
- **HTTPS疎通確認OK**: `https://print-to-calendar.tamago-ai-world.com/health` → `{"ok":true,...}` / http→https 301

### ⏳ 残り
4. `.env` に APIキー4種を入力（ユーザーがVPS上で直接）← **ここから再開**
5. 外部サービス設定（Stripe / Google OAuth / Discord）
6. フロント `VITE_API_BASE` 設定 → 再ビルド → gh-pagesデプロイ
7. 公開E2E（連携→撮影→確認→保存→同期）

---

## 重要な場所・値

| 項目 | 値 |
|---|---|
| VPS | `ssh vps`（207.180.238.184 / Ubuntu / Contabo） |
| コード | `/opt/docker/print-to-calendar/` |
| `.env` | `/opt/docker/print-to-calendar/.env`（LICENSE/TOKEN/ADMIN生成済み、API鍵は空） |
| compose | `/opt/docker/docker-compose.yml`（`print-to-calendar:` サービス追記済み・バックアップ `*.bak-ptc-*` あり） |
| nginx vhost | `/opt/docker/nginx/conf.d/print-to-calendar.conf`（現在 `:80` のみ） |
| サブドメイン | `print-to-calendar.tamago-ai-world.com` |
| コンテナ内ポート | 8787（ホスト公開なし。nginxがdockerネット経由で proxy） |
| ADMIN_TOKEN | `.env` 内（`grep ADMIN_TOKEN /opt/docker/print-to-calendar/.env` で確認） |

---

## 再開手順（コマンド）

### Step 1: DNS最終確認 → 証明書発行
```bash
# 主要resolverで解決していることを確認（4つともIPが出ればOK）
for r in 8.8.8.8 1.1.1.1 9.9.9.9 208.67.222.222; do echo -n "$r: "; dig +short @$r print-to-calendar.tamago-ai-world.com A; done

# 証明書発行（webroot方式。1日以上経過していれば負キャッシュは確実に切れている）
ssh vps 'docker exec certbot certbot certonly --webroot -w /var/www/certbot -d print-to-calendar.tamago-ai-world.com -n --agree-tos --keep-until-expiring'
# 成功すると /etc/letsencrypt/live/print-to-calendar.tamago-ai-world.com/ に fullchain.pem / privkey.pem
```
> ⚠️ certbotの失敗試行はLet's Encryptのレート制限（1ホスト/時5回）対象。
> 中断前に2回失敗している（負キャッシュが原因）。**1時間以上空けていれば枠は回復**しているので問題なし。
> 念のため発行前に上の `dig` で4resolver全て解決を確認してから1回で通すこと。

### Step 2: nginx に `:443` ブロックを追記 → リロード
`/opt/docker/nginx/conf.d/print-to-calendar.conf` に以下を**追記**（既存の `:80` ブロックはそのまま残す）:
```nginx
server {
    listen 443 ssl;
    server_name print-to-calendar.tamago-ai-world.com;

    ssl_certificate /etc/letsencrypt/live/print-to-calendar.tamago-ai-world.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/print-to-calendar.tamago-ai-world.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Stripe Webhookは生body必須。バッファ等はデフォルトのままでOK。
    client_max_body_size 12m;   # 画像base64を受けるので少し緩める

    location / {
        set $backend_ptc "print-to-calendar:8787";
        proxy_pass http://$backend_ptc;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
```bash
ssh vps 'docker exec nginx nginx -t && docker exec nginx nginx -s reload'
```

### Step 3: HTTPS疎通確認
```bash
curl -s https://print-to-calendar.tamago-ai-world.com/health
# → {"ok":true,"service":"print-to-calendar",...} が返ればOK
# 管理画面: ブラウザで https://print-to-calendar.tamago-ai-world.com/admin （ADMIN_TOKEN入力）
```

### Step 4: APIキーを `.env` に入力（ユーザーがVPS上で直接。Claudeのターミナルに値を流さない）
```bash
ssh vps 'nano /opt/docker/print-to-calendar/.env'
# 以下を埋める:
#   GEMINI_API_KEY=...            （既存キー流用可）
#   STRIPE_SECRET_KEY=sk_live_...
#   STRIPE_WEBHOOK_SECRET=whsec_...
#   GOOGLE_CLIENT_ID=...
#   GOOGLE_CLIENT_SECRET=...
#   DISCORD_ERROR_WEBHOOK_URL=...
# GOOGLE_REDIRECT_URI は設定済み: https://print-to-calendar.tamago-ai-world.com/api/google/oauth/callback

# 反映（env変更はコンテナ再作成が必要）
ssh vps 'cd /opt/docker && docker compose up -d print-to-calendar'
```

### Step 5: 外部サービス設定（`server/README.md` のPhase 0参照）
- **Google OAuth**: 認証情報のリダイレクトURIに
  `https://print-to-calendar.tamago-ai-world.com/api/google/oauth/callback` を登録。
  同意画面はテスト中だとrefresh tokenが7日失効 → **販売は.ics先行が前提**（Google自動登録は審査通過後ON）。
- **Stripe**: Payment Link作成（¥500/6ヶ月）。success_urlに `?session_id={CHECKOUT_SESSION_ID}`。
  Webhookエンドポイント `https://print-to-calendar.tamago-ai-world.com/webhook/stripe`、イベント `checkout.session.completed`。
- **Discord**: 通知用WebhookのURLを `DISCORD_ERROR_WEBHOOK_URL` に。

### Step 6: フロント公開
```bash
cd ~/print-to-calendar
cp env.sample .env   # VITE_API_BASE=https://print-to-calendar.tamago-ai-world.com
npm run build
npx gh-pages -d dist -m "deploy: 販売版"
# legal/ も一緒に出る → https://tamagoojiji.github.io/print-to-calendar/legal/
```

### Step 7: 公開E2E
1. 本番URLを開く → ライセンスキー入力（管理画面で手動発行したキー or Stripe購入で発行）
2. Google連携 → 登録先カレンダー選択
3. プリント画像で読み取り → 確認画面 → 保存 → カレンダー登録/.ics
4. 同期失敗時のDiscord通知も確認

---

## 既知の注意点（ハマりどころ）
- **DNSネガティブキャッシュ**: 新サブドメインは伝播前に問い合わせると「存在しない(NXDOMAIN)」が最大1時間キャッシュされる。証明書発行は **4resolverで解決確認してから1回で**。
- **`:443`ブロックは証明書が存在してから追加**。先に書くと `nginx -t` が落ちてリロード不可。
- **env変更は `restart` ではなく `up -d`**（env_fileはコンテナ再作成時に読み直し）。
- **テスト用ライセンス**（`e2e@test.local`）がDBに1件残っている。管理画面から停止可。
- バックエンドの本番起動・E2Eは検証済み。残りはTLS公開と鍵入力のみ。

---

参考: 全体設計は `DESIGN.md`（v2ブロック）、各サービス作成手順は `server/README.md`。
