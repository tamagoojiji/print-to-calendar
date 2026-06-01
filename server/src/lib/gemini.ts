import { env } from '../env.js';

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'];

export interface AnalyzedEvent {
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  location: string | null;
  memo: string | null;
  confidence: number;
}

export interface AnalyzeResult {
  events: AnalyzedEvent[];
  warnings: string[];
  modelName: string;
}

function buildPrompt(): string {
  const currentYear = new Date().getFullYear();
  return `あなたは学校・塾・習い事の予定プリントを読み取り、
カレンダー登録用の予定データを抽出するアシスタントです。

画像内の日本語テキストから、予定として登録できそうな項目を抽出してください。

対象例:
- 行事 / 授業参観 / 懇談 / 遠足 / 運動会 / 発表会
- 休校 / 休講 / 締切 / 提出期限 / 持ち物が必要な日
- 塾の予定 / 習い事の予定

必ず以下のJSON形式だけで返してください。説明文やMarkdownは不要です。

{
  "events": [
    {
      "title": "予定名",
      "date": "YYYY-MM-DD",
      "startTime": "HH:mm または null",
      "endTime": "HH:mm または null",
      "isAllDay": true または false,
      "location": "場所 または null",
      "memo": "補足情報 または null",
      "confidence": 0.0
    }
  ],
  "warnings": ["読み取り時の注意点"]
}

ルール:
- 日付が不明なものは events に入れない
- 年が書かれていない場合は ${currentYear} 年または文脈から推定し、推定した旨を memo または warnings に書く
- 時間が不明な場合は null
- 時間がない予定は isAllDay を true
- タイトルは短くわかりやすく
- 子どもの氏名や個人情報はタイトルに入れない
- 同じ予定が重複している場合は1つにまとめる
- 自信が低い場合は confidence を低くする`;
}

async function callGemini(prompt: string, imageBase64: string, mimeType: string): Promise<{ text: string; model: string }> {
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY未設定');
  const payload = {
    contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
  };

  const failures: string[] = [];
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.status === 200) {
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[];
      };
      const parts = json.candidates?.[0]?.content?.parts || [];
      const text = parts
        .filter((p) => p.text && !p.thought)
        .map((p) => p.text)
        .join('\n')
        .trim();
      return { text, model };
    }

    const body = await res.text().catch(() => '');
    const reason = body.match(/"message"\s*:\s*"([^"]+)"/)?.[1] || body.slice(0, 120);
    failures.push(`${model}:${res.status} ${reason}`);
    if ([403, 429, 404, 503].includes(res.status)) continue;
    throw new Error(`Gemini API HTTP ${res.status} ${reason}`);
  }
  throw new Error(`Gemini全モデル失敗: ${failures.join(' / ')}`);
}

function clampStr(v: unknown, max = 60): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'null') return null;
  return s.slice(0, max);
}

export async function analyzeImage(imageBase64: string, mimeType: string): Promise<AnalyzeResult> {
  const { text, model } = await callGemini(buildPrompt(), imageBase64, mimeType);
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || [null, text];
  const braceMatch = (jsonMatch[1] || text).match(/\{[\s\S]*\}/);
  if (!braceMatch) throw new Error('予定情報を読み取れませんでした');

  const data = JSON.parse(braceMatch[0]) as {
    events?: Record<string, unknown>[];
    warnings?: unknown[];
  };

  const events: AnalyzedEvent[] = (data.events || [])
    .map((e) => {
      const date = clampStr(e.date, 10) || '';
      const isAllDay = Boolean(e.isAllDay) || (!e.startTime && !e.endTime);
      const conf = Number(e.confidence);
      return {
        title: clampStr(e.title, 80) || '（無題）',
        date,
        startTime: isAllDay ? null : clampStr(e.startTime, 5),
        endTime: isAllDay ? null : clampStr(e.endTime, 5),
        isAllDay,
        location: clampStr(e.location, 120),
        memo: clampStr(e.memo, 500),
        confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0.5,
      };
    })
    .filter((e) => e.date); // 日付不明は除外

  const warnings = (data.warnings || []).map((w) => String(w)).filter(Boolean);
  return { events, warnings, modelName: model };
}
