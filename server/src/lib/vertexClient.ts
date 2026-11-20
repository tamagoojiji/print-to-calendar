// Vertex AI 経由で Gemini を呼ぶ共通クライアント（要件③ / TS-ESM版）。
// 認証は2系統を自動切替（呼び出し側は同じ）:
//   A) 直接ADC（既定）: vertexai:true で Vertex を直接叩く。APIキーは渡さない。
//   B) proxy経由（VPS等 ADC不可環境）: VERTEX_PROXY_URL と PROXY_SECRET が両方あれば
//      HTTPで vertex-proxy 経由（共有シークレットヘッダ認証）に切り替える＝鍵ファイル不要。
// 依存: @google/genai（直接ADC時のみ）。proxy経由は標準の fetch のみ（Node18+）。
import { GoogleGenAI, type Part, type GenerateContentConfig } from '@google/genai';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
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
  images?: { imageBase64: string; mimeType: string }[];
  models?: string[];
  generationConfig?: Record<string, unknown>;
  provider?: 'claude';
}

function buildParts(
  prompt: string,
  imageBase64?: string,
  mimeType?: string,
  images?: { imageBase64: string; mimeType: string }[],
): Part[] {
  const parts: Part[] = [{ text: prompt }];
  if (imageBase64) parts.push({ inlineData: { mimeType: mimeType || 'image/jpeg', data: imageBase64 } });
  for (const img of images ?? []) {
    parts.push({ inlineData: { mimeType: img.mimeType || 'image/jpeg', data: img.imageBase64 } });
  }
  return parts;
}

// 思考の設定: gemini-3 以降は thinkingLevel LOW（thinkingBudget は非推奨で併用すると 400）。
// 2.5 flash/flash-lite は thinkingBudget 0（2.5 は thinkingLevel 非対応で 400）。
function thinkingFor(m: string): Record<string, unknown> | null {
  if (/^gemini-([3-9]|\d{2,})/.test(m)) return { thinkingLevel: 'LOW' };
  if (m.startsWith('gemini-2.5') && !m.includes('pro')) return { thinkingBudget: 0 };
  return null;
}

// proxy経由でフォールバックチェーンを回す（per-model で thinking-off を組む）。
async function viaProxy(opts: GenerateOpts): Promise<{ text: string; model: string }> {
  const { prompt, imageBase64, mimeType, images, models, generationConfig = {} } = opts;
  const chain = models && models.length ? models : [DEFAULT_MODEL];
  const parts = buildParts(prompt, imageBase64, mimeType, images);

  if (opts.provider === 'claude') {
    if (!USE_PROXY) throw new Error('provider claude には VERTEX_PROXY_URL と PROXY_SECRET が必要です');
    const gc = { responseMimeType: 'application/json', ...generationConfig } as Record<string, unknown>;
    const requestBody = { contents: [{ role: 'user', parts }], generationConfig: gc };
    const res = await fetch(PROXY_URL as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Proxy-Secret': PROXY_SECRET as string },
      body: JSON.stringify({ provider: 'claude', models: chain, request: requestBody }),
    });
    if (!res.ok) throw new Error(`proxy ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { text?: string; model?: string };
    return { text: (data.text ?? '').trim(), model: data.model ?? 'claude' };
  }

  let lastErr: unknown;
  for (const m of chain) {
    const gc = { responseMimeType: 'application/json', ...generationConfig } as Record<string, unknown>;
    const tc = thinkingFor(m);
    if (tc) gc.thinkingConfig = tc;
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
  if (USE_PROXY || opts.provider === 'claude') return viaProxy(opts);

  // 直接ADCモード（ローカル/SA環境）
  const { prompt, imageBase64, mimeType, images, models, generationConfig = {} } = opts;
  const chain = models && models.length ? models : [DEFAULT_MODEL];
  const parts = buildParts(prompt, imageBase64, mimeType, images);

  let lastErr: unknown;
  for (const m of chain) {
    const config = { responseMimeType: 'application/json', ...generationConfig } as Record<string, unknown>;
    const tc = thinkingFor(m);
    if (tc) config.thinkingConfig = tc;
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
