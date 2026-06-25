// Vertex AI 経由で Gemini を呼ぶ共通クライアント（要件③ / TS-ESM版）。
// 認証は ADC 固定。APIキーは渡さない。vertexai:true で特典クレジット対象になる。
// 依存: npm install @google/genai。要 `gcloud auth application-default login` または サービスアカウント。
import { GoogleGenAI, type Part, type GenerateContentConfig } from '@google/genai';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const LOCATION = process.env.VERTEX_LOCATION || 'global';
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT;

let client: GoogleGenAI | undefined;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ vertexai: true, project: PROJECT, location: LOCATION });
  return client;
}

export interface GenerateOpts {
  prompt: string;
  imageBase64?: string;
  mimeType?: string;
  models?: string[];
  generationConfig?: Record<string, unknown>;
}

// 画像入力＋モデルフォールバック＋thinking-off 対応。戻りは { text, model }。
export async function generateContent(opts: GenerateOpts): Promise<{ text: string; model: string }> {
  const { prompt, imageBase64, mimeType, models, generationConfig = {} } = opts;
  const chain = models && models.length ? models : [DEFAULT_MODEL];
  const parts: Part[] = [{ text: prompt }];
  if (imageBase64) parts.push({ inlineData: { mimeType: mimeType || 'image/jpeg', data: imageBase64 } });

  let lastErr: unknown;
  for (const m of chain) {
    const config = { responseMimeType: 'application/json', ...generationConfig } as Record<string, unknown>;
    // thinking 無効化は 2.5 flash/flash-lite のみ（2.5-pro は budget=0 非対応）
    if (m.startsWith('gemini-2.5') && !m.includes('pro')) config.thinkingConfig = { thinkingBudget: 0 };
    try {
      const resp = await getClient().models.generateContent({
        model: m,
        contents: [{ role: 'user', parts }],
        config: config as GenerateContentConfig,
      });
      return { text: (resp.text ?? '').trim(), model: m };
    } catch (e) {
      lastErr = e; // 429/503/404 等は次モデルへフォールバック
    }
  }
  throw lastErr;
}
