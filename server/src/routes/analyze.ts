import { Hono } from 'hono';
import { db, APP_ID } from '../db.js';
import { pid } from '../lib/ids.js';
import { currentUsageMonth, nowIso } from '../lib/time.js';
import { validateForUse, incrementUsage } from '../lib/license.js';
import { analyzeImage } from '../lib/gemini.js';

export const analyzeRoute = new Hono();

const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 約8MB

function parseDataUrl(input: string): { base64: string; mimeType: string } | null {
  const m = input.match(/^data:([^;]+);base64,(.+)$/s);
  if (m) return { mimeType: m[1], base64: m[2] };
  // data URLでなく素のbase64も許容（mime既定jpeg）
  if (/^[A-Za-z0-9+/=\s]+$/.test(input)) return { mimeType: 'image/jpeg', base64: input.replace(/\s+/g, '') };
  return null;
}

function logUsage(
  license: { id: string; user_id: string },
  status: 'success' | 'failed' | 'blocked',
  modelName?: string,
  errorMessage?: string,
): void {
  db.prepare(
    `INSERT INTO usage_logs
      (id, user_id, license_id, app_id, used_at, usage_month, status, error_message, model_name, estimated_cost, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    pid('usage'),
    license.user_id,
    license.id,
    APP_ID,
    nowIso(),
    currentUsageMonth(),
    status,
    errorMessage ?? null,
    modelName ?? null,
    null,
    nowIso(),
  );
}

// POST /api/analyze
analyzeRoute.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const licenseKey = String(body.licenseKey || '').trim();
  const imageBase64 = String(body.imageBase64 || '');

  // 1-3. ライセンス検証 + 期限 + 月間回数
  const v = validateForUse(licenseKey);
  if (!v.ok || !v.license) {
    return c.json({ ok: false, reason: v.reason || 'invalid_license' }, 403);
  }
  const license = v.license;

  // 4. 画像チェック
  const parsed = parseDataUrl(imageBase64);
  if (!parsed) return c.json({ ok: false, reason: 'invalid_image' }, 400);
  const approxBytes = Math.floor((parsed.base64.length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    return c.json({ ok: false, reason: 'image_too_large' }, 413);
  }

  // 5. Gemini解析
  try {
    const result = await analyzeImage(parsed.base64, parsed.mimeType);
    // 7. 成功時のみ +1、8. usage_logs記録
    incrementUsage(license.id);
    logUsage(license, 'success', result.modelName);
    const used = license.monthly_used + 1;
    const limit = license.monthly_limit;
    return c.json({
      ok: true,
      events: result.events,
      warnings: result.warnings,
      usage: {
        monthlyLimit: limit,
        monthlyUsed: used,
        remaining: limit == null ? null : Math.max(0, limit - used),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logUsage(license, 'failed', undefined, msg);
    console.error('[analyze]', msg);
    return c.json({ ok: false, reason: 'server_error', message: '画像の読み取りに失敗しました' }, 502);
  }
});
