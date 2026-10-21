import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';
import { generateContent } from '../lib/vertexClient.js';

// shift-calendar SPA（https://tamagoojiji.github.io/shift-calendar/）専用の解析API。
// 旧: SPAがユーザー入力のGemini APIキーで generativelanguage を直叩き
// 新: プロンプト・正規化をサーバーに移植し、Vertex（特典クレジット・キー不要）経由で解析。
// 認可（多層）:
//   ① 共有トークン X-Shift-Token（env SHIFT_ANALYZE_TOKEN と一致必須。未設定なら常に401＝fail-closed）
//   ② CORS許可オリジン（ブラウザ経由の水際）
//   ③ $10予算ガード（万一漏れても ¥1,200 で aiplatform 自動無効化＝損害上限）
// ※SPAは公開クライアントのためトークンは配布バンドルに載る＝暗号学的な個人認証ではなく
//   「無差別なドライブバイ呼び出しを弾く」層。真の個人認証が要る場合はログイン必須化（要ユーザー判断）。

export const shiftAnalyzeRoute = new Hono();

// 共有トークン検証（定数時間比較）。env未設定時は fail-closed で全拒否。
function verifyToken(sent: string): boolean {
  const expected = env.SHIFT_ANALYZE_TOKEN;
  if (!expected) return false;
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 約8MB
const MAX_TOTAL_BYTES = 20 * 1024 * 1024; // 合計約20MB
const MAX_IMAGES = 10;
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const SHIFT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'];

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
- 日付（YYYY-MM-DD形式）
- 時間（HH:MM形式、不明なら空文字）
- 内容（30文字以内で簡潔に要約）
- 場所（会場名・店舗名・住所など。画像に書かれていなければ空文字）
- URL（画像中にリンクやURLが含まれていれば抽出、なければ空文字）

## ルール
- 複数のイベントがあれば全て抽出
- 日付不明は空文字、年が書いてなければ2026年と仮定
- 画像が複数枚ある場合、それらは同じイベントの資料の続き（例: 1枚目に題名やポスター、2枚目にタイムスケジュールや会場案内）として扱い、全画像の情報を統合して1件にまとめる
- 統合するときは、題名を content に、最初の開始時刻を time に、会場を location に、URLがあれば url に入れる
- 別々のイベントだと明確に分かる場合（日付も題名も異なる別のチラシ）だけ別件に分ける。同じイベント内の複数の時間帯（プログラム）は別件にしない

## 出力（JSONのみ）
\`\`\`json
{"events":[{"date":"2026-04-15","time":"15:00","content":"イベント名","location":"","url":""}]}
\`\`\``;

// merge=true のときに EVENT_PROMPT の末尾へ付ける（複数画像を必ず1件に統合させる）
const EVENT_MERGE_SUFFIX = `

## 必須条件
- 渡された画像はすべて「同じ1つのイベント」の資料である。出力する events は必ず1件だけにする
- 全画像から題名・日付・最初の開始時刻・会場・URLを集めて、その1件に統合する`;

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

function normalizeEvents(data: Record<string, unknown>, merge = false) {
  const rawEvents = Array.isArray(data.events)
    ? (data.events as { date?: string; time?: string; content?: string; location?: string; url?: string }[])
    : [];
  const events = rawEvents.map((e) => ({
    date: String(e.date || ''),
    time: String(e.time || ''),
    content: String(e.content || '').substring(0, 50),
    location: String(e.location || '').substring(0, 50),
    url: String(e.url || ''),
  }));
  // merge=true で2件以上返ったら、各フィールドの「最初に空でない値」で1件に畳む（固定保証）
  if (merge && events.length >= 2) {
    const first = (k: 'date' | 'time' | 'content' | 'location' | 'url') => events.find((e) => e[k])?.[k] ?? '';
    return {
      events: [{ date: first('date'), time: first('time'), content: first('content'), location: first('location'), url: first('url') }],
    };
  }
  return { events };
}

// POST /api/shift-analyze
shiftAnalyzeRoute.post('/', async (c) => {
  // ① 共有トークン認可（Vertexを叩く前に検証。未認可は 401 で即拒否）
  if (!verifyToken(c.req.header('X-Shift-Token') ?? '')) {
    return c.json({ ok: false, error: '認可されていません' }, 401);
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
    });
    const data = extractJson(text);
    const result = kind === 'shift' ? normalizeShift(data) : normalizeEvents(data, merge);
    return c.json({ ok: true, model, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[shift-analyze] ${kind} 失敗:`, msg);
    return c.json({ ok: false, error: `解析に失敗しました: ${msg.slice(0, 200)}` }, 502);
  }
});
