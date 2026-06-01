import { Hono } from 'hono';
import { db } from '../db.js';
import { pid } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';
import { findLicenseByKey, ensureMonthlyReset, type LicenseRow } from '../lib/license.js';
import { syncUpsert, syncDelete, type SavedEventRow } from '../services/sync.js';
import { buildIcs, type IcsEvent } from '../lib/ics.js';

export const eventsRoute = new Hono();

// 保存系は回数を消費しない。active/期限内のライセンスのみ許可。
function authLicense(licenseKey: string): { ok: true; license: LicenseRow } | { ok: false; reason: string } {
  const lic = findLicenseByKey(licenseKey);
  if (!lic) return { ok: false, reason: 'invalid_license' };
  ensureMonthlyReset(lic);
  if (lic.status === 'revoked' || lic.status === 'paused') return { ok: false, reason: 'revoked' };
  if (new Date(lic.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };
  return { ok: true, license: lic };
}

interface InputEvent {
  title: string;
  date: string;
  startTime?: string | null;
  endTime?: string | null;
  isAllDay?: boolean;
  location?: string | null;
  memo?: string | null;
  googleCalendarId?: string | null;
}

function insertSavedEvent(license: LicenseRow, ev: InputEvent): SavedEventRow {
  const id = pid('event');
  const ts = nowIso();
  const isAllDay = ev.isAllDay || !ev.startTime ? 1 : 0;
  db.prepare(
    `INSERT INTO saved_events
      (id, user_id, license_id, title, date, start_time, end_time, is_all_day, timezone, memo, location,
       calendar_sync_status, google_calendar_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Asia/Tokyo', ?, ?, 'syncing', ?, ?, ?)`,
  ).run(
    id,
    license.user_id,
    license.id,
    ev.title,
    ev.date,
    isAllDay ? null : ev.startTime ?? null,
    isAllDay ? null : ev.endTime ?? null,
    isAllDay,
    ev.memo ?? null,
    ev.location ?? null,
    ev.googleCalendarId ?? null,
    ts,
    ts,
  );
  return db.prepare('SELECT * FROM saved_events WHERE id = ?').get(id) as SavedEventRow;
}

function getEvent(id: string, licenseId: string): SavedEventRow | null {
  return (
    (db
      .prepare("SELECT * FROM saved_events WHERE id = ? AND license_id = ? AND deleted_at IS NULL")
      .get(id, licenseId) as SavedEventRow | undefined) ?? null
  );
}

// POST /api/events/save-and-sync
eventsRoute.post('/save-and-sync', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const auth = authLicense(String(body.licenseKey || ''));
  if (!auth.ok) return c.json({ ok: false, reason: auth.reason }, 403);
  const events: InputEvent[] = Array.isArray(body.events) ? body.events : [];
  if (!events.length) return c.json({ ok: false, reason: 'no_events' }, 400);

  const results = [];
  for (const ev of events) {
    if (!ev.title || !ev.date) continue;
    const saved = insertSavedEvent(auth.license, ev);
    const outcome = await syncUpsert(saved);
    results.push({ id: saved.id, title: saved.title, ...outcome });
  }
  const failed = results.filter((r) => !r.ok).length;
  return c.json({ ok: failed === 0, saved: results.length, failed, results });
});

// POST /api/events/update-and-sync
eventsRoute.post('/update-and-sync', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const auth = authLicense(String(body.licenseKey || ''));
  if (!auth.ok) return c.json({ ok: false, reason: auth.reason }, 403);
  const id = String(body.id || '');
  const patch: InputEvent = body.event || {};
  const ev = getEvent(id, auth.license.id);
  if (!ev) return c.json({ ok: false, reason: 'not_found' }, 404);

  const ts = nowIso();
  const isAllDay = patch.isAllDay || !patch.startTime ? 1 : 0;
  db.prepare(
    `UPDATE saved_events SET title = ?, date = ?, start_time = ?, end_time = ?, is_all_day = ?,
       location = ?, memo = ?, google_calendar_id = COALESCE(?, google_calendar_id), updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.title ?? ev.title,
    patch.date ?? ev.date,
    isAllDay ? null : patch.startTime ?? ev.start_time,
    isAllDay ? null : patch.endTime ?? ev.end_time,
    isAllDay,
    patch.location ?? ev.location,
    patch.memo ?? ev.memo,
    patch.googleCalendarId ?? null,
    ts,
    id,
  );
  const updated = db.prepare('SELECT * FROM saved_events WHERE id = ?').get(id) as SavedEventRow;
  const outcome = await syncUpsert(updated);
  return c.json({ id, ...outcome });
});

// POST /api/events/delete  body: { licenseKey, id, deleteFromGoogle: boolean }
eventsRoute.post('/delete', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const auth = authLicense(String(body.licenseKey || ''));
  if (!auth.ok) return c.json({ ok: false, reason: auth.reason }, 403);
  const id = String(body.id || '');
  const deleteFromGoogle = Boolean(body.deleteFromGoogle);
  const ev = getEvent(id, auth.license.id);
  if (!ev) return c.json({ ok: false, reason: 'not_found' }, 404);

  let googleOutcome = { ok: true, status: 'deleted' as string, errorType: undefined as string | undefined };
  if (deleteFromGoogle && ev.google_event_id) {
    const r = await syncDelete(ev);
    googleOutcome = { ok: r.ok, status: r.status, errorType: r.errorType };
    if (!r.ok) {
      // Google削除失敗時はアプリ内削除も保留し、再同期に委ねる
      return c.json({ id, ...r });
    }
  }
  db.prepare("UPDATE saved_events SET calendar_sync_status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?").run(
    nowIso(),
    nowIso(),
    id,
  );
  return c.json({ ok: true, id, google: googleOutcome });
});

// POST /api/events/retry-sync  body: { licenseKey, id }
eventsRoute.post('/retry-sync', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const auth = authLicense(String(body.licenseKey || ''));
  if (!auth.ok) return c.json({ ok: false, reason: auth.reason }, 403);
  const id = String(body.id || '');
  const ev = getEvent(id, auth.license.id);
  if (!ev) return c.json({ ok: false, reason: 'not_found' }, 404);
  const outcome = await syncUpsert(ev);
  return c.json({ id, ...outcome });
});

// GET /api/events?licenseKey=...  保存済み一覧
eventsRoute.get('/', (c) => {
  const auth = authLicense(c.req.query('licenseKey') || '');
  if (!auth.ok) return c.json({ ok: false, reason: auth.reason }, 403);
  const rows = db
    .prepare(
      "SELECT * FROM saved_events WHERE license_id = ? AND deleted_at IS NULL ORDER BY date ASC, start_time ASC",
    )
    .all(auth.license.id);
  return c.json({ ok: true, events: rows });
});

// POST /api/events/ics  body: { licenseKey, ids?: string[] }  指定なければ未削除全件
eventsRoute.post('/ics', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const auth = authLicense(String(body.licenseKey || ''));
  if (!auth.ok) return c.json({ ok: false, reason: auth.reason }, 403);
  const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
  let rows: SavedEventRow[];
  if (ids.length) {
    const ph = ids.map(() => '?').join(',');
    rows = db
      .prepare(`SELECT * FROM saved_events WHERE license_id = ? AND deleted_at IS NULL AND id IN (${ph})`)
      .all(auth.license.id, ...ids) as SavedEventRow[];
  } else {
    rows = db
      .prepare('SELECT * FROM saved_events WHERE license_id = ? AND deleted_at IS NULL')
      .all(auth.license.id) as SavedEventRow[];
  }
  const icsEvents: IcsEvent[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    date: r.date,
    startTime: r.start_time,
    endTime: r.end_time,
    isAllDay: r.is_all_day === 1,
    location: r.location,
    memo: r.memo,
  }));
  const ics = buildIcs(icsEvents);
  return c.body(ics, 200, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'attachment; filename="print-to-calendar.ics"',
  });
});
