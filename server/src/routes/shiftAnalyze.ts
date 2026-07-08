import { Hono } from 'hono';
import { generateContent } from '../lib/vertexClient.js';

// shift-calendar SPA（https://tamagoojiji.github.io/shift-calendar/）専用の解析API。
// 旧: SPAがユーザー入力のGemini APIキーで generativelanguage を直叩き
// 新: プロンプト・正規化をサーバーに移植し、Vertex（特典クレジット・キー不要）経由で解析。
// 認可: 家族用の小規模SPAのためライセンス不要。CORS許可オリジン＋$10予算ガードが補償コントロール。

export const shiftAnalyzeRoute = new Hono();

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 約8MB
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
- URL（画像中にリンクやURLが含まれていれば抽出、なければ空文字）

## ルール
- 複数のイベントがあれば全て抽出
- 日付不明は空文字、年が書いてなければ2026年と仮定

## 出力（JSONのみ）
\`\`\`json
{"events":[{"date":"2026-04-15","time":"15:00","content":"イベント名","url":""}]}
\`\`\``;

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

function normalizeEvents(data: Record<string, unknown>) {
  const rawEvents = Array.isArray(data.events)
    ? (data.events as { date?: string; time?: string; content?: string; url?: string }[])
    : [];
  return {
    events: rawEvents.map((e) => ({
      date: String(e.date || ''),
      time: String(e.time || ''),
      content: String(e.content || '').substring(0, 50),
      url: String(e.url || ''),
    })),
  };
}

// POST /api/shift-analyze
shiftAnalyzeRoute.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const kind = String(body.kind || 'shift');
  const imageBase64 = String(body.imageBase64 || '');
  const mimeType = String(body.mimeType || 'image/jpeg');

  if (kind !== 'shift' && kind !== 'event') {
    return c.json({ ok: false, error: 'kind は shift か event を指定してください' }, 400);
  }
  if (!imageBase64) {
    return c.json({ ok: false, error: 'imageBase64 が空です' }, 400);
  }
  if (!/^[A-Za-z0-9+/=\s]+$/.test(imageBase64)) {
    return c.json({ ok: false, error: 'imageBase64 の形式が不正です' }, 400);
  }
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(mimeType)) {
    return c.json({ ok: false, error: '対応していない画像形式です' }, 400);
  }
  if (imageBase64.length * 0.75 > MAX_IMAGE_BYTES) {
    return c.json({ ok: false, error: '画像が大きすぎます（8MBまで）' }, 400);
  }

  try {
    const { text, model } = await generateContent({
      prompt: kind === 'shift' ? SHIFT_PROMPT : EVENT_PROMPT,
      imageBase64,
      mimeType,
      models: SHIFT_MODELS,
      generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
    });
    const data = extractJson(text);
    const result = kind === 'shift' ? normalizeShift(data) : normalizeEvents(data);
    return c.json({ ok: true, model, result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[shift-analyze] ${kind} 失敗:`, msg);
    return c.json({ ok: false, error: `解析に失敗しました: ${msg.slice(0, 200)}` }, 502);
  }
});
