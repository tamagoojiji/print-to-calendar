import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { env } from '../env.js';
import { pid } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';
import { encryptSecret, decryptSecret } from '../lib/crypto.js';
import { findLicenseByKey } from '../lib/license.js';
import {
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  listCalendars,
  GoogleSyncError,
  GOOGLE_SCOPE_STRING,
} from '../lib/google.js';

export const googleRoute = new Hono();

interface ConnRow {
  id: string;
  user_id: string;
  google_email: string | null;
  status: string;
  encrypted_refresh_token: string;
  default_calendar_id: string | null;
  default_calendar_name: string | null;
}

function getConn(licenseId: string): ConnRow | null {
  return (
    (db
      .prepare("SELECT * FROM google_connections WHERE license_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(licenseId) as ConnRow | undefined) ?? null
  );
}

// GET /api/google/oauth/start?licenseKey=...  → Googleへリダイレクト
googleRoute.get('/oauth/start', (c) => {
  const lic = findLicenseByKey(c.req.query('licenseKey') || '');
  if (!lic) return c.json({ ok: false, reason: 'invalid_license' }, 403);
  if (!env.GOOGLE_CLIENT_ID) return c.json({ ok: false, reason: 'google_not_configured' }, 503);

  const state = randomBytes(24).toString('hex');
  db.prepare('INSERT INTO oauth_states (state, license_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(
    state,
    lic.id,
    lic.user_id,
    nowIso(),
  );
  return c.redirect(buildAuthUrl(state));
});

// GET /api/google/oauth/callback?code=&state=
googleRoute.get('/oauth/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const errParam = c.req.query('error');
  const back = (status: string) => c.redirect(`${env.APP_BASE_URL}#google=${status}`);

  if (errParam || !code || !state) return back('error');
  const st = db.prepare('SELECT * FROM oauth_states WHERE state = ?').get(state) as
    | { license_id: string; user_id: string }
    | undefined;
  if (!st) return back('error');
  db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state);

  try {
    const tokens = await exchangeCode(code);
    const ts = nowIso();
    const existing = getConn(st.license_id);
    const enc = encryptSecret(tokens.refreshToken);
    if (existing) {
      db.prepare(
        `UPDATE google_connections SET google_sub = ?, google_email = ?, status = 'active', scope = ?,
           encrypted_refresh_token = ?, connected_at = ?, revoked_at = NULL, updated_at = ? WHERE id = ?`,
      ).run(tokens.sub ?? null, tokens.email ?? null, tokens.scope || GOOGLE_SCOPE_STRING, enc, ts, ts, existing.id);
    } else {
      db.prepare(
        `INSERT INTO google_connections
          (id, user_id, license_id, google_sub, google_email, status, scope, encrypted_refresh_token,
           default_calendar_id, default_calendar_name, connected_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'active', ?, ?, 'primary', 'メインカレンダー', ?, ?, ?)`,
      ).run(
        pid('gconn'),
        st.user_id,
        st.license_id,
        tokens.sub ?? null,
        tokens.email ?? null,
        tokens.scope || GOOGLE_SCOPE_STRING,
        enc,
        ts,
        ts,
        ts,
      );
    }
    return back('connected');
  } catch (e) {
    console.error('[google/callback]', e);
    return back('error');
  }
});

// GET /api/google/status?licenseKey=...
googleRoute.get('/status', (c) => {
  const lic = findLicenseByKey(c.req.query('licenseKey') || '');
  if (!lic) return c.json({ ok: false, reason: 'invalid_license' }, 403);
  const conn = getConn(lic.id);
  if (!conn || conn.status !== 'active') {
    return c.json({ ok: true, connected: false });
  }
  return c.json({
    ok: true,
    connected: true,
    email: conn.google_email,
    defaultCalendarId: conn.default_calendar_id,
    defaultCalendarName: conn.default_calendar_name,
  });
});

// GET /api/google/calendars?licenseKey=...
googleRoute.get('/calendars', async (c) => {
  const lic = findLicenseByKey(c.req.query('licenseKey') || '');
  if (!lic) return c.json({ ok: false, reason: 'invalid_license' }, 403);
  const conn = getConn(lic.id);
  if (!conn || conn.status !== 'active') return c.json({ ok: false, reason: 'not_connected' }, 400);
  try {
    const accessToken = await refreshAccessToken(decryptSecret(conn.encrypted_refresh_token));
    const calendars = await listCalendars(accessToken);
    return c.json({ ok: true, calendars });
  } catch (e) {
    const reason = e instanceof GoogleSyncError ? e.type : 'server_error';
    return c.json({ ok: false, reason }, 502);
  }
});

// POST /api/google/default-calendar  { licenseKey, calendarId, calendarName }
googleRoute.post('/default-calendar', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const lic = findLicenseByKey(String(body.licenseKey || ''));
  if (!lic) return c.json({ ok: false, reason: 'invalid_license' }, 403);
  const conn = getConn(lic.id);
  if (!conn || conn.status !== 'active') return c.json({ ok: false, reason: 'not_connected' }, 400);
  db.prepare(
    'UPDATE google_connections SET default_calendar_id = ?, default_calendar_name = ?, updated_at = ? WHERE id = ?',
  ).run(String(body.calendarId || 'primary'), String(body.calendarName || ''), nowIso(), conn.id);
  return c.json({ ok: true });
});

// POST /api/google/disconnect  { licenseKey }
googleRoute.post('/disconnect', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const lic = findLicenseByKey(String(body.licenseKey || ''));
  if (!lic) return c.json({ ok: false, reason: 'invalid_license' }, 403);
  const conn = getConn(lic.id);
  if (conn) {
    db.prepare("UPDATE google_connections SET status = 'revoked', revoked_at = ?, updated_at = ? WHERE id = ?").run(
      nowIso(),
      nowIso(),
      conn.id,
    );
  }
  return c.json({ ok: true });
});
