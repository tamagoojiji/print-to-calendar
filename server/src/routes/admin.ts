import { Hono } from 'hono';
import { db } from '../db.js';
import { env } from '../env.js';
import { nowIso, addMonthsJstIso } from '../lib/time.js';
import { issueLicense } from '../services/issueLicense.js';
import { adminHtml } from './adminHtml.js';

export const adminRoute = new Hono();

// 認可: ?token= または x-admin-token ヘッダ
adminRoute.use('/api/*', async (c, next) => {
  const token = c.req.header('x-admin-token') || c.req.query('token') || '';
  if (token !== env.ADMIN_TOKEN) return c.json({ ok: false, error: 'unauthorized' }, 401);
  await next();
});

// ダッシュボードHTML
adminRoute.get('/', (c) => c.html(adminHtml));

adminRoute.get('/api/dashboard', (c) => {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return c.json({
    ok: true,
    stats: {
      users: count('SELECT COUNT(*) n FROM users'),
      licenses_active: count("SELECT COUNT(*) n FROM licenses WHERE status='active'"),
      licenses_total: count('SELECT COUNT(*) n FROM licenses'),
      purchases: count('SELECT COUNT(*) n FROM purchases'),
      sync_errors: count("SELECT COUNT(*) n FROM saved_events WHERE calendar_sync_status='sync_failed' AND deleted_at IS NULL"),
      google_connected: count("SELECT COUNT(*) n FROM google_connections WHERE status='active'"),
    },
  });
});

// ライセンス一覧（ユーザー・プラン・サポート・Google連携を結合）
adminRoute.get('/api/licenses', (c) => {
  const rows = db
    .prepare(
      `SELECT l.id, l.status, l.expires_at, l.monthly_limit, l.monthly_used, l.usage_month,
              u.email, p.name AS plan_name,
              (SELECT status FROM support_contracts s WHERE s.license_id = l.id ORDER BY created_at DESC LIMIT 1) AS support_status,
              (SELECT free_support_ends_at FROM support_contracts s WHERE s.license_id = l.id ORDER BY created_at DESC LIMIT 1) AS free_support_ends_at,
              (SELECT status FROM google_connections g WHERE g.license_id = l.id ORDER BY created_at DESC LIMIT 1) AS google_status,
              (SELECT default_calendar_name FROM google_connections g WHERE g.license_id = l.id ORDER BY created_at DESC LIMIT 1) AS default_calendar_name
       FROM licenses l
       JOIN users u ON u.id = l.user_id
       JOIN plans p ON p.id = l.plan_id
       ORDER BY l.created_at DESC LIMIT 500`,
    )
    .all();
  return c.json({ ok: true, licenses: rows });
});

adminRoute.get('/api/sync-errors', (c) => {
  const rows = db
    .prepare(
      `SELECT id, license_id, title, date, sync_error_message, updated_at
       FROM saved_events WHERE calendar_sync_status='sync_failed' AND deleted_at IS NULL
       ORDER BY updated_at DESC LIMIT 200`,
    )
    .all();
  return c.json({ ok: true, errors: rows });
});

adminRoute.get('/api/usage', (c) => {
  const rows = db
    .prepare('SELECT status, model_name, used_at, error_message FROM usage_logs ORDER BY created_at DESC LIMIT 200')
    .all();
  return c.json({ ok: true, usage: rows });
});

// 手動延長（Nヶ月、既定6）
adminRoute.post('/api/licenses/:id/extend', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const months = Number(body.months || 6);
  const lic = db.prepare('SELECT expires_at FROM licenses WHERE id = ?').get(id) as { expires_at: string } | undefined;
  if (!lic) return c.json({ ok: false, error: 'not_found' }, 404);
  const baseTime = Math.max(Date.now(), new Date(lic.expires_at).getTime());
  const newExpiry = addMonthsJstIso(new Date(baseTime), months);
  db.prepare("UPDATE licenses SET expires_at = ?, status = 'active', updated_at = ? WHERE id = ?").run(
    newExpiry,
    nowIso(),
    id,
  );
  return c.json({ ok: true, expiresAt: newExpiry });
});

// 手動停止
adminRoute.post('/api/licenses/:id/revoke', (c) => {
  const id = c.req.param('id');
  db.prepare("UPDATE licenses SET status = 'revoked', revoked_at = ?, updated_at = ? WHERE id = ?").run(
    nowIso(),
    nowIso(),
    id,
  );
  return c.json({ ok: true });
});

// 手動ライセンス発行（テスト・個別対応用）。キーは平文で1回だけ返す。
adminRoute.post('/api/licenses/issue', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const result = issueLicense({ email: body.email ?? null, displayName: body.displayName ?? null });
  return c.json({ ok: true, licenseKey: result.licenseKey, licenseId: result.licenseId, expiresAt: result.expiresAt });
});
