import { env } from '../env.js';
import type { SyncErrorType } from './discord.js';

const OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
  'openid',
  'email',
].join(' ');

export const GOOGLE_SCOPE_STRING = OAUTH_SCOPES;

export class GoogleSyncError extends Error {
  type: SyncErrorType;
  constructor(type: SyncErrorType, message: string) {
    super(message);
    this.type = type;
  }
}

// 認可URL（offline access + consentで必ずrefresh_token取得）
export function buildAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: OAUTH_SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
  scope?: string;
}

function decodeIdToken(idToken?: string): { sub?: string; email?: string } {
  if (!idToken) return {};
  try {
    const payload = idToken.split('.')[1];
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const data = JSON.parse(json) as { sub?: string; email?: string };
    return { sub: data.sub, email: data.email };
  } catch {
    return {};
  }
}

export async function exchangeCode(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  sub?: string;
  email?: string;
  scope?: string;
}> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new GoogleSyncError('google_refresh_failed', `code交換失敗 HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as TokenResponse;
  if (!data.refresh_token) {
    throw new GoogleSyncError('google_refresh_failed', 'refresh_tokenが返りませんでした（既存連携の再同意が必要な可能性）');
  }
  const { sub, email } = decodeIdToken(data.id_token);
  return { accessToken: data.access_token, refreshToken: data.refresh_token, sub, email, scope: data.scope };
}

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // invalid_grant = 連携取り消し/失効
    const type: SyncErrorType = body.includes('invalid_grant') ? 'google_token_expired' : 'google_refresh_failed';
    throw new GoogleSyncError(type, `アクセストークン更新失敗 HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as TokenResponse;
  return data.access_token;
}

export interface CalendarListItem {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
}

export async function listCalendars(accessToken: string): Promise<CalendarListItem[]> {
  const res = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=writer', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    if (res.status === 401) throw new GoogleSyncError('google_token_expired', 'カレンダー一覧取得で認証エラー');
    throw new GoogleSyncError('google_permission_denied', `カレンダー一覧取得失敗 HTTP ${res.status}`);
  }
  const data = (await res.json()) as { items?: CalendarListItem[] };
  return (data.items || []).map((c) => ({
    id: c.id,
    summary: c.summary,
    primary: c.primary,
    accessRole: c.accessRole,
  }));
}

// ---- イベント本文（spec §17）----
export interface GoogleEventInput {
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  location?: string | null;
  memo?: string | null;
  savedEventId: string;
}

function addOneDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function toEventResource(ev: GoogleEventInput): Record<string, unknown> {
  const description = ev.memo
    ? `print-to-calendar から登録\n\n${ev.memo}`
    : 'print-to-calendar から登録';
  const base: Record<string, unknown> = {
    summary: ev.title,
    description,
    reminders: { useDefault: true },
    extendedProperties: { private: { source: 'print-to-calendar', savedEventId: ev.savedEventId } },
  };
  if (ev.location) base.location = ev.location;

  if (ev.isAllDay || !ev.startTime) {
    base.start = { date: ev.date };
    base.end = { date: addOneDay(ev.date) }; // 終日は終了日が排他的
  } else {
    const end = ev.endTime || ev.startTime;
    base.start = { dateTime: `${ev.date}T${ev.startTime}:00+09:00`, timeZone: 'Asia/Tokyo' };
    base.end = { dateTime: `${ev.date}T${end}:00+09:00`, timeZone: 'Asia/Tokyo' };
  }
  return base;
}

export interface GoogleEventResult {
  id: string;
  htmlLink: string;
}

export async function createCalendarEvent(
  accessToken: string,
  calendarId: string,
  ev: GoogleEventInput,
): Promise<GoogleEventResult> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(toEventResource(ev)),
    },
  );
  if (!res.ok) throw mapEventError('create', res.status, await res.text().catch(() => ''));
  const data = (await res.json()) as { id: string; htmlLink: string };
  return { id: data.id, htmlLink: data.htmlLink };
}

export async function updateCalendarEvent(
  accessToken: string,
  calendarId: string,
  googleEventId: string,
  ev: GoogleEventInput,
): Promise<GoogleEventResult> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(toEventResource(ev)),
    },
  );
  if (!res.ok) throw mapEventError('update', res.status, await res.text().catch(() => ''));
  const data = (await res.json()) as { id: string; htmlLink: string };
  return { id: data.id, htmlLink: data.htmlLink };
}

export async function deleteCalendarEvent(
  accessToken: string,
  calendarId: string,
  googleEventId: string,
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(googleEventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` } },
  );
  // 既に削除済み(410/404)は成功扱い
  if (res.ok || res.status === 410 || res.status === 404) return;
  throw mapEventError('delete', res.status, await res.text().catch(() => ''));
}

function mapEventError(action: 'create' | 'update' | 'delete', status: number, body: string): GoogleSyncError {
  const msg = body.match(/"message"\s*:\s*"([^"]+)"/)?.[1] || `HTTP ${status}`;
  if (status === 401) return new GoogleSyncError('google_token_expired', msg);
  if (status === 403) return new GoogleSyncError('google_permission_denied', msg);
  if (status === 404)
    return new GoogleSyncError('google_calendar_not_found', msg);
  const t: SyncErrorType =
    action === 'create'
      ? 'google_event_create_failed'
      : action === 'update'
        ? 'google_event_update_failed'
        : 'google_event_delete_failed';
  return new GoogleSyncError(t, msg);
}
