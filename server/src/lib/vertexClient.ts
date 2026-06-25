// Vertex AI 経由で Gemini を呼ぶ共通クライアント（要件③ / TS-ESM版）。
// 認証は2系統を自動切替（呼び出し側は同じ）:
//   A) 直接ADC（既定）: vertexai:true で Vertex を直接叩く。APIキーは渡さない。
//   B) proxy経由（VPS等 ADC不可環境）: VERTEX_PROXY_URL と PROXY_SECRET が両方あれば
//      HTTPで vertex-proxy 経由（共有シークレットヘッダ認証）に切り替える＝鍵ファイル不要。
// 依存: @google/genai（直接ADC時のみ）。proxy経由は標準の fetch のみ（Node18+）。
import { GoogleGenAI, type Part, type GenerateContentConfig } from '@google/genai';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const LOCATION = process.env.VERTEX_LOCATION || 'global';
const PROJECT = process.env.GOOGLE_CLOUD_PROJECT;

const PROXY_URL = process.env.VERTEX_PROXY_URL;
const PROXY_SECRET = process.env.PROXY_SECRET;
const USE_PROXY = Boolean(PROXY_URL && PROXY_SECRET);

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

function buildParts(prompt: string, imageBase64?: string, mimeType?: string): Part[] {
  const parts: Part[] = [{ text: prompt }];
  if (imageBase64) parts.push({ inlineData: { mimeType: mimeType || 'image/jpeg', data: imageBase64 } });
  return parts;
}

// proxy経由でフォールバックチェーンを回す（per-model で thinking-off を組む）。
async function viaProxy(opts: GenerateOpts): Promise<{ text: string; model: string }> {
  const { prompt, imageBase64, mimeType, models, generationConfig = {} } = opts;
  const chain = models && models.length ? models : [DEFAULT_MODEL];
  const parts = buildParts(prompt, imageBase64, mimeType);

  let lastErr: unknown;
  for (const m of chain) {
    const gc = { responseMimeType: 'application/json', ...generationConfig } as Record<string, unknown>;
    if (m.startsWith('gemini-2.5') && !m.includes('pro')) gc.thinkingConfig = { thinkingBudget: 0 };
    const requestBody = { contents: [{ role: 'user', parts }], generationConfig: gc };
    try {
      const res = await fetch(PROXY_URL as string, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Proxy-Secret': PROXY_SECRET as string },
        body: JSON.stringify({ models: [m], request: requestBody }),
      });
      if (!res.ok) {
        lastErr = new Error(`proxy ${res.status}: ${(await res.text()).slice(0, 200)}`);
        continue; // 429/503/404 等は次モデルへフォールバック
      }
      const data = (await res.json()) as { text?: string; model?: string };
      return { text: (data.text ?? '').trim(), model: data.model ?? m };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

// 画像入力＋モデルフォールバック＋thinking-off 対応。戻りは { text, model }。
export async function generateContent(opts: GenerateOpts): Promise<{ text: string; model: string }> {
  // proxy経由モード（VPS等）
  if (USE_PROXY) return viaProxy(opts);

  // 直接ADCモード（ローカル/SA環境）
  const { prompt, imageBase64, mimeType, models, generationConfig = {} } = opts;
  const chain = models && models.length ? models : [DEFAULT_MODEL];
  const parts = buildParts(prompt, imageBase64, mimeType);

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
