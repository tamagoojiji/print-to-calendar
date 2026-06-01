import { db, APP_ID } from '../db.js';
import { pid } from '../lib/ids.js';
import { nowIso } from '../lib/time.js';
import { decryptSecret } from '../lib/crypto.js';
import {
  GoogleSyncError,
  createCalendarEvent,
  deleteCalendarEvent,
  refreshAccessToken,
  updateCalendarEvent,
  type GoogleEventInput,
} from '../lib/google.js';
import { notifyDiscordSyncError, type SyncErrorType } from '../lib/discord.js';

export interface SavedEventRow {
  id: string;
  user_id: string;
  license_id: string;
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  is_all_day: number;
  memo: string | null;
  location: string | null;
  calendar_sync_status: string;
  google_calendar_id: string | null;
  google_event_id: string | null;
}

interface GoogleConnRow {
  id: string;
  status: string;
  encrypted_refresh_token: string;
  default_calendar_id: string | null;
}

export interface SyncOutcome {
  ok: boolean;
  status: string; // synced / sync_failed
  errorType?: SyncErrorType;
  errorMessage?: string;
}

function getConnection(licenseId: string): GoogleConnRow | null {
  return (
    (db
      .prepare(
        "SELECT id, status, encrypted_refresh_token, default_calendar_id FROM google_connections WHERE license_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
      )
      .get(licenseId) as GoogleConnRow | undefined) ?? null
  );
}

function toGoogleInput(ev: SavedEventRow): GoogleEventInput {
  return {
    title: ev.title,
    date: ev.date,
    startTime: ev.start_time,
    endTime: ev.end_time,
    isAllDay: ev.is_all_day === 1,
    location: ev.location,
    memo: ev.memo,
    savedEventId: ev.id,
  };
}

function logSync(
  ev: SavedEventRow,
  action: 'create' | 'update' | 'delete' | 'retry',
  status: 'success' | 'failed',
  calendarId: string | null,
  googleEventId: string | null,
  errorType?: string,
  errorMessage?: string,
): void {
  db.prepare(
    `INSERT INTO calendar_sync_logs
      (id, user_id, license_id, saved_event_id, action, status, google_calendar_id, google_event_id, error_type, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    pid('synclog'),
    ev.user_id,
    ev.license_id,
    ev.id,
    action,
    status,
    calendarId,
    googleEventId,
    errorType ?? null,
    errorMessage ?? null,
    nowIso(),
  );
}

async function failAndNotify(
  ev: SavedEventRow,
  action: 'create' | 'update' | 'delete',
  calendarId: string | null,
  errorType: SyncErrorType,
  errorMessage: string,
): Promise<SyncOutcome> {
  const ts = nowIso();
  db.prepare(
    'UPDATE saved_events SET calendar_sync_status = ?, sync_error_message = ?, updated_at = ? WHERE id = ?',
  ).run('sync_failed', errorMessage, ts, ev.id);
  logSync(ev, action, 'failed', calendarId, ev.google_event_id, errorType, errorMessage);
  await notifyDiscordSyncError({
    appId: APP_ID,
    userId: ev.user_id,
    licenseId: ev.license_id,
    savedEventId: ev.id,
    eventTitle: ev.title,
    action,
    calendarId: calendarId ?? undefined,
    errorType,
    errorMessage,
  });
  return { ok: false, status: 'sync_failed', errorType, errorMessage };
}

// create または update（google_event_idの有無で自動分岐）
export async function syncUpsert(ev: SavedEventRow): Promise<SyncOutcome> {
  const conn = getConnection(ev.license_id);
  const isUpdate = !!ev.google_event_id;
  const action: 'create' | 'update' = isUpdate ? 'update' : 'create';
  const calendarId = ev.google_calendar_id || conn?.default_calendar_id || 'primary';

  if (!conn) {
    return failAndNotify(ev, action, calendarId, 'google_token_expired', 'Google連携が見つかりません（未連携または失効）');
  }

  try {
    const accessToken = await refreshAccessToken(decryptSecret(conn.encrypted_refresh_token));
    const input = toGoogleInput(ev);
    const result = isUpdate
      ? await updateCalendarEvent(accessToken, calendarId, ev.google_event_id!, input)
      : await createCalendarEvent(accessToken, calendarId, input);

    const ts = nowIso();
    db.prepare(
      `UPDATE saved_events
       SET calendar_sync_status = 'synced', google_calendar_id = ?, google_event_id = ?, google_html_link = ?,
           last_synced_at = ?, sync_error_message = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(calendarId, result.id, result.htmlLink, ts, ts, ev.id);
    logSync(ev, action, 'success', calendarId, result.id);
    return { ok: true, status: 'synced' };
  } catch (e) {
    const { type, message } = normalizeError(e);
    return failAndNotify(ev, action, calendarId, type, message);
  }
}

// Google側も削除
export async function syncDelete(ev: SavedEventRow): Promise<SyncOutcome> {
  const conn = getConnection(ev.license_id);
  const calendarId = ev.google_calendar_id || conn?.default_calendar_id || 'primary';

  if (!ev.google_event_id) {
    // Google未登録なら何もしない（呼び出し側でアプリ内削除を実施）
    return { ok: true, status: 'deleted' };
  }
  if (!conn) {
    return failAndNotify(ev, 'delete', calendarId, 'google_token_expired', 'Google連携が見つかりません');
  }
  try {
    const accessToken = await refreshAccessToken(decryptSecret(conn.encrypted_refresh_token));
    await deleteCalendarEvent(accessToken, calendarId, ev.google_event_id);
    logSync(ev, 'delete', 'success', calendarId, ev.google_event_id);
    return { ok: true, status: 'deleted' };
  } catch (e) {
    const { type, message } = normalizeError(e);
    return failAndNotify(ev, 'delete', calendarId, type, message);
  }
}

function normalizeError(e: unknown): { type: SyncErrorType; message: string } {
  if (e instanceof GoogleSyncError) return { type: e.type, message: e.message };
  if (e instanceof TypeError) return { type: 'network_error', message: e.message };
  return { type: 'unknown_error', message: e instanceof Error ? e.message : String(e) };
}
