import { Hono } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../env.js';
import { generateContent } from '../lib/vertexClient.js';

// shift-calendar SPA（https://tamagoojiji.github.io/shift-calendar/）専用の解析API。
// 旧: SPAがユーザー入力のGemini APIキーで generativelanguage を直叩き
// 新: プロンプト・正規化をサーバーに移植し、Vertex（特典クレジット・キー不要）経由で解析。
// 認可（多層）:
//   ① Firebase IDトークン（Authorization: Bearer）。Google公開鍵で署名検証し、aud/iss=projectId・exp・
//      email_verified=true・email が env SHIFT_ALLOWED_EMAILS（カンマ区切り）に含まれることを要求。
//      env未設定なら常に401（fail-closed）、許可リスト外は403。
//   ② CORS許可オリジン（ブラウザ経由の水際）
//   ③ $10予算ガード（損害上限）

export const shiftAnalyzeRoute = new Hono();

// Firebase IDトークン検証。shift-calendar の Firebase プロジェクトに固定。
const FIREBASE_PROJECT_ID = 'shift-calendar-c92a9';
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);

type AuthResult = { ok: true } | { ok: false; status: 401 | 403; error: string };

async function verifyFirebaseUser(authHeader: string): Promise<AuthResult> {
  const allowed = env.SHIFT_ALLOWED_EMAILS.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0) return { ok: false, status: 401, error: '認可されていません' };
  const bearer = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!bearer) return { ok: false, status: 401, error: 'Googleログインが必要です' };
  try {
    const { payload } = await jwtVerify(bearer[1], FIREBASE_JWKS, {
      audience: FIREBASE_PROJECT_ID,
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      algorithms: ['RS256'],
    });
    const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
    if (payload.email_verified !== true || !email || !allowed.includes(email)) {
      return { ok: false, status: 403, error: 'このアカウントは読み取りを許可されていません' };
    }
    return { ok: true };
  } catch {
    return { ok: false, status: 401, error: 'ログインの確認に失敗しました。もう一度ログインしてください' };
  }
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 約8MB
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 合計約20MB
const MAX_IMAGES = 10;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const SHIFT_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-2.5-flash']; // 2.5-pro は廃止(404)。3.x は location=global 必須

const SHIFT_PROMPT = `あなたは医療施設のシフト表画像を正確に読み取るエキスパートです。

## シフト表の構造
- 上部に「YYYY年 M月 勤務表」というタイトル
- 左上に施設名（「交野」「枚方」など）が大きく書かれている場合がある
- 下部に「夜非常勤」セクションがあり、スタッフ名の行が並ぶ
- 表は前半（1〜15日）と後半（16〜末日）の2ブロック構成

## 解析対象
「四ツ橋」（よつはし）という名前の行のみ。

## 手順
1. 年月をタイトルから取得
2. 施設名判定: 左上に「交野」→katano / 「枚方」→hirakata / 「守口」→moriguchi / なし→kadoma
3. 日付列を正確にマッピング（前半・後半2ブロック、曜日行も参考に）
4. 四ツ橋の行で「夜」が入っている日を抽出
5. 文字色判定: 黒→time:"20" / 赤・青・緑→time:"17"

## 出力（JSONのみ）
\`\`\`json
{"facility":"katano","year":2026,"month":4,"shifts":[{"day":1,"place":"katano","time":"20"}]}
\`\`\`
四ツ橋の行が見つからない場合はshiftsを空配列に。`;

const EVENT_PROMPT = `この画像からイベント・予定情報を読み取ってください。

## 抽出する情報
- 日付 date（YYYY-MM-DD形式）
- 開演（開始）時間 time（HH:MM形式、不明なら空文字）
- 開場時間 openTime（HH:MM形式、書かれていなければ空文字）
- 内容 content（題名。30文字以内で簡潔に要約）
- 公演の呼び名 label（昼公演・夜公演・1回目・第2部など。無ければ空文字）
- 場所 location（会場名・店舗名・住所など。画像に書かれていなければ空文字）
- URL url（画像中にリンクやURLが含まれていれば抽出、なければ空文字）

## ルール
- 複数のイベントがあれば全て抽出
- 日付不明は空文字、年が書いてなければ2026年と仮定
- 画像が複数枚ある場合、それらは同じイベントの資料の続き（例: 1枚目に題名やポスター、2枚目にタイムスケジュールや会場案内）として扱い、全画像の情報を統合する
- 統合するときは、題名を content に、最初の開始時刻を time に、会場を location に、URLがあれば url に入れる
- 同じ演目が1日に複数回あり、回ごとに開演時間がある場合（昼の部/夜の部、1回目/2回目、マチネ/ソワレ等）は、回ごとに別の予定として出す（content は同じ題名、label に回の呼び名、openTime/time はその回のもの）
- タイムスケジュール内の出し物（例: 13:00 開会、14:00 トーク）は別件にしない。公演回が1つのイベントの中の時間帯（プログラム）は、まとめて1件にする
- 別々のイベントだと明確に分かる場合（日付も題名も異なる別のチラシ）は別件に分ける

## 出力（JSONのみ）
\`\`\`json
{"events":[{"date":"2026-04-15","time":"15:00","openTime":"14:30","content":"イベント名","label":"","location":"","url":""}]}
\`\`\``;

// merge=true のときに EVENT_PROMPT の末尾へ付ける（複数画像を1つのイベントとして統合させる）
const EVENT_MERGE_SUFFIX = `

## 必須条件
- 渡された画像はすべて「同じ1つのイベント」の資料である
- 公演回が1つなら、全画像から題名・日付・開場時間・最初の開始時刻・会場・URLを集めて1件に統合する
- 公演回が複数あるときだけ、回ごとに分けて出す（題名・会場・URLは全回共通）`;

function extractJson(text: string): Record<string, unknown> {
  const fence = text.match(/```json\s*([\s\S]*?)```/);
  const target = fence ? fence[1] : text;
  const brace = target.match(/\{[\s\S]*\}/);
  if (!brace) throw new Error('解析結果を読み取れませんでした');
  return JSON.parse(brace[0]) as Record<string, unknown>;
}

function normalizeShift(data: Record<string, unknown>) {
  const facilityMap: Record<string, string> = {
    交野: 'katano', 枚方: 'hirakata', 門真: 'kadoma', 守口: 'moriguchi',
  };
  let facility = String(data.facility || 'kadoma').toLowerCase();
  if (!['katano', 'hirakata', 'kadoma', 'moriguchi'].includes(facility)) {
    facility = facilityMap[String(data.facility)] || 'kadoma';
  }

  const rawShifts = Array.isArray(data.shifts) ? (data.shifts as { day: number | string; time: number | string }[]) : [];
  const shifts = rawShifts
    .map((s) => ({
      day: parseInt(String(s.day), 10),
      place: facility,
      time: String(s.time) === '17' ? '17' : '20',
    }))
    .filter((s) => s.day >= 1 && s.day <= 31)
    .sort((a, b) => a.day - b.day);

  return { facility, year: parseInt(String(data.year), 10), month: parseInt(String(data.month), 10), shifts };
}

// label があれば題名の末尾に「（昼公演）」の形で付ける（題名が既に含むなら付けない）
function withLabel(content: string, label: string) {
  const s = label && !content.includes(label) ? `${content}（${label}）` : content;
  return s.substring(0, 50);
}

export function normalizeEvents(data: Record<string, unknown>, merge = false) {
  const rawEvents = Array.isArray(data.events)
    ? (data.events as { date?: string; time?: string; openTime?: string; content?: string; label?: string; location?: string; url?: string }[])
    : [];
  const rows = rawEvents.map((e) => ({
    date: String(e.date || ''),
    time: String(e.time || ''),
    openTime: String(e.openTime || ''),
    content: String(e.content || ''),
    label: String(e.label || ''),
    location: String(e.location || '').substring(0, 50),
    url: String(e.url || ''),
  }));
  const out = (r: (typeof rows)[number]) => ({
    date: r.date, time: r.time, openTime: r.openTime, content: withLabel(r.content, r.label), location: r.location, url: r.url,
  });
  if (!merge || rows.length < 2) return { events: rows.map(out) };

  // merge=true で2件以上: 題名・会場・URLを共通化し、date 空は埋め、(date,time) 重複と time 空の余り行を除く
  const first = (k: 'date' | 'content' | 'location' | 'url') => rows.find((r) => r[k])?.[k] ?? '';
  const common = { date: first('date'), content: first('content'), location: first('location'), url: first('url') };
  const merged: typeof rows = [];
  for (const r of rows) {
    const row = { ...r, date: r.date || common.date, content: common.content, location: common.location, url: common.url };
    const dup = merged.find((m) => m.date === row.date && m.time === row.time);
    if (dup) {
      if (!dup.openTime) dup.openTime = row.openTime;
      if (!dup.label) dup.label = row.label;
      continue;
    }
    merged.push(row);
  }
  const kept = merged.filter((r) => r.time || !merged.some((m) => m.date === r.date && m.time));
  return { events: kept.map(out) };
}

// POST /api/shift-analyze
shiftAnalyzeRoute.post('/', async (c) => {
  // ① Firebaseログイン＋許可リスト認可（Vertexを叩く前に検証）
  const auth = await verifyFirebaseUser(c.req.header('Authorization') ?? '');
  if (!auth.ok) {
    return c.json({ ok: false, error: auth.error }, auth.status);
  }

  const body = await c.req.json().catch(() => ({}));
  const kind = String(body.kind || 'shift');
  const merge = body.merge === true;

  if (kind !== 'shift' && kind !== 'event') {
    return c.json({ ok: false, error: 'kind は shift か event を指定してください' }, 400);
  }

  // images 配列（新）と imageBase64/mimeType 単体（旧・互換）を配列に正規化して一本化
  const rawImages: { imageBase64?: unknown; mimeType?: unknown }[] = Array.isArray(body.images)
    ? body.images
    : body.imageBase64
      ? [{ imageBase64: body.imageBase64, mimeType: body.mimeType }]
      : [];
  const images = rawImages.map((img) => ({
    imageBase64: String(img?.imageBase64 || ''),
    mimeType: String(img?.mimeType || 'image/jpeg'),
  }));

  if (images.length === 0) {
    return c.json({ ok: false, error: '画像がありません' }, 400);
  }
  if (images.length > MAX_IMAGES) {
    return c.json({ ok: false, error: `画像は${MAX_IMAGES}枚までです` }, 400);
  }
  let totalBytes = 0;
  for (const { imageBase64, mimeType } of images) {
    if (!imageBase64) {
      return c.json({ ok: false, error: 'imageBase64 が空です' }, 400);
    }
    if (!/^[A-Za-z0-9+/=\s]+$/.test(imageBase64)) {
      return c.json({ ok: false, error: 'imageBase64 の形式が不正です' }, 400);
    }
    if (!ALLOWED_MIME.includes(mimeType)) {
      return c.json({ ok: false, error: '対応していない画像形式です' }, 400);
    }
    if (imageBase64.length * 0.75 > MAX_IMAGE_BYTES) {
      return c.json({ ok: false, error: '画像が大きすぎます（8MBまで）' }, 400);
    }
    totalBytes += imageBase64.length * 0.75;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    return c.json({ ok: false, error: '画像の合計が大きすぎます（20MBまで）' }, 400);
  }

  try {
    const { text, model } = await generateContent({
      prompt: kind === 'shift' ? SHIFT_PROMPT : merge ? EVENT_PROMPT + EVENT_MERGE_SUFFIX : EVENT_PROMPT,
      // shift は従来通り先頭1枚だけ使う
      images: kind === 'shift' ? images.slice(0, 1) : images,
      models: SHIFT_MODELS,
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
      provider: 'claude',
    });
    console.log(`[shift-analyze] ${kind} ok model=${model}`);
    const data = extractJson(text);
    const result = kind === 'shift' ? normalizeShift(data) : normalizeEvents(data, merge);
    return c.json({ ok: true, model, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[shift-analyze] ${kind} 失敗:`, msg);
    return c.json({ ok: false, error: `解析に失敗しました: ${msg.slice(0, 200)}` }, 502);
  }
});
