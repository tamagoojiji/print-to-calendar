import { Hono } from 'hono';
import { env } from '../env.js';
import { db } from '../db.js';
import { issueLicense } from '../services/issueLicense.js';

// 外部ストア（例: たまごのアプリ保管庫）からの S2S ライセンス発行専用ルート。
// adminトークンは過剰権限のため使わず、発行専用の PROVISION_TOKEN で認可する。
export const provisionRoute = new Hono();

// POST /provision  { idempotencyKey, displayName?, email? }
//  - 認可: x-provision-token ヘッダ
//  - 冪等性: 同一 idempotencyKey(=外部の決済セッションID) は purchases.stripe_session_id で重複検知
//    （DBは平文キーを保持しないため再返却はできない＝呼び出し側が平文キーを保持する責務）
provisionRoute.post('/', async (c) => {
  const token = c.req.header('x-provision-token') || '';
  if (!env.PROVISION_TOKEN || token !== env.PROVISION_TOKEN) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  const body = await c.req.json().catch(() => ({}));
  const idempotencyKey = String(body.idempotencyKey || '').trim();
  if (!idempotencyKey) {
    return c.json({ ok: false, error: 'idempotencyKey_required' }, 400);
  }

  const dup = db.prepare('SELECT id FROM purchases WHERE stripe_session_id = ?').get(idempotencyKey);
  if (dup) {
    return c.json({ ok: false, error: 'already_provisioned', duplicate: true }, 409);
  }

  try {
    const result = issueLicense({
      email: body.email ?? null,
      displayName: body.displayName ?? null,
      stripeSessionId: idempotencyKey,
      amountTotal: 500,
    });
    console.log(`[provision] ライセンス発行 license=${result.licenseId} idem=${idempotencyKey}`);
    return c.json({
      ok: true,
      licenseKey: result.licenseKey,
      licenseId: result.licenseId,
      expiresAt: result.expiresAt,
    });
  } catch (e) {
    console.error('[provision] 発行失敗', e);
    return c.json({ ok: false, error: 'issue_failed' }, 500);
  }
});
