import type { ParsedEvent } from '../types';

const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro'];

const KEY_STORAGE = 'ptc_gemini_key';

export function getStoredApiKey(): string | null {
  return localStorage.getItem(KEY_STORAGE);
}

export function setStoredApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key.trim());
}

export function clearStoredApiKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}

async function callGemini(apiKey: string, prompt: string, imageBase64: string, mimeType: string): Promise<string> {
  const payload = {
    contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType, data: imageBase64 } }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
  };

  const failures: string[] = [];
  for (const model of GEMINI_MODELS) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (res.status === 200) {
      const json = await res.json();
      const parts = json.candidates?.[0]?.content?.parts || [];
      const textParts = parts.filter((p: { text?: string; thought?: boolean }) => p.text && !p.thought);
      return textParts.map((p: { text: string }) => p.text).join('\n').trim();
    }

    const body = await res.text().catch(() => '');
    const reason = body.match(/"message"\s*:\s*"([^"]+)"/)?.[1] || body.slice(0, 120);
    failures.push(`${model}:${res.status} ${reason}`);

    if ([403, 429, 404, 503].includes(res.status)) continue;
    throw new Error(`Gemini API HTTP ${res.status} ${reason}`);
  }

  throw new Error(`Gemini全モデル失敗: ${failures.join(' / ')}`);
}

export async function analyzeEventImage(
  apiKey: string,
  imageBase64: string,
  mimeType: string,
): Promise<{ events: ParsedEvent[] }> {
  const currentYear = new Date().getFullYear();
  const prompt = `この画像からイベント・予定情報を読み取ってください。

## 抽出する情報
- 日付（YYYY-MM-DD形式）
- 時間（HH:MM形式、不明なら空文字）
- 内容（30文字以内で簡潔に要約）
- URL（画像中にリンクやURLが含まれていれば抽出、なければ空文字）

## ルール
- 複数のイベントがあれば全て抽出
- 日付不明は空文字、年が書いてなければ${currentYear}年と仮定

## 出力（JSONのみ）
\`\`\`json
{"events":[{"date":"${currentYear}-04-15","time":"15:00","content":"イベント名","url":""}]}
\`\`\``;

  const text = await callGemini(apiKey, prompt, imageBase64, mimeType);
  const jsonMatch = text.match(/```json\s*([\s\S]*?)```/) || [null, text];
  const braceMatch = (jsonMatch[1] || text).match(/\{[\s\S]*\}/);
  if (!braceMatch) throw new Error('イベント情報を読み取れませんでした');

  const data = JSON.parse(braceMatch[0]);
  return {
    events: (data.events || []).map((e: { date?: string; time?: string; content?: string; url?: string }) => ({
      date: String(e.date || ''),
      time: String(e.time || ''),
      content: String(e.content || '').substring(0, 50),
      url: String(e.url || ''),
    })),
  };
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
