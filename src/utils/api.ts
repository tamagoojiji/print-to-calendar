// バックエンドAPIクライアント。GeminiキーやStripe等の機密はここに置かない。
// API_BASE はビルド時の VITE_API_BASE で差し替え（未設定時は同一オリジン /api を想定）。
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '';

export interface SupportInfo {
  status: string;
  freeSupportEndsAt: string;
  paidSupportEndsAt: string | null;
}

export interface LicenseInfo {
  ok: boolean;
  reason?: string;
  status?: string;
  expiresAt?: string;
  monthlyLimit?: number | null;
  monthlyUsed?: number;
  remaining?: number | null;
  support?: SupportInfo | null;
}

export interface AnalyzedEvent {
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  location: string | null;
  memo: string | null;
  confidence: number;
}

export interface AnalyzeResponse {
  ok: boolean;
  reason?: string;
  message?: string;
  events?: AnalyzedEvent[];
  warnings?: string[];
  usage?: { monthlyLimit: number | null; monthlyUsed: number; remaining: number | null };
}

export interface SavedEvent {
  id: string;
  title: string;
  date: string;
  start_time: string | null;
  end_time: string | null;
  is_all_day: number;
  location: string | null;
  memo: string | null;
  calendar_sync_status: string;
  google_html_link: string | null;
  sync_error_message: string | null;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as T;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  return (await res.json()) as T;
}

export const api = {
  validateLicense: (licenseKey: string) => postJson<LicenseInfo>('/api/license/validate', { licenseKey }),

  analyze: (licenseKey: string, imageBase64: string) =>
    postJson<AnalyzeResponse>('/api/analyze', { licenseKey, imageBase64 }),

  saveAndSync: (licenseKey: string, events: unknown[]) =>
    postJson<{ ok: boolean; saved: number; failed: number; results: { id: string; title: string; ok: boolean; status: string; errorType?: string }[] }>(
      '/api/events/save-and-sync',
      { licenseKey, events },
    ),

  updateAndSync: (licenseKey: string, id: string, event: unknown) =>
    postJson<{ ok: boolean; id: string; status: string; errorType?: string }>('/api/events/update-and-sync', {
      licenseKey,
      id,
      event,
    }),

  deleteEvent: (licenseKey: string, id: string, deleteFromGoogle: boolean) =>
    postJson<{ ok: boolean; reason?: string; errorType?: string }>('/api/events/delete', {
      licenseKey,
      id,
      deleteFromGoogle,
    }),

  retrySync: (licenseKey: string, id: string) =>
    postJson<{ ok: boolean; id: string; status: string; errorType?: string }>('/api/events/retry-sync', {
      licenseKey,
      id,
    }),

  listEvents: (licenseKey: string) =>
    getJson<{ ok: boolean; reason?: string; events?: SavedEvent[] }>(
      `/api/events?licenseKey=${encodeURIComponent(licenseKey)}`,
    ),

  googleStatus: (licenseKey: string) =>
    getJson<{ ok: boolean; connected: boolean; email?: string; defaultCalendarId?: string; defaultCalendarName?: string }>(
      `/api/google/status?licenseKey=${encodeURIComponent(licenseKey)}`,
    ),

  googleCalendars: (licenseKey: string) =>
    getJson<{ ok: boolean; reason?: string; calendars?: { id: string; summary: string; primary?: boolean }[] }>(
      `/api/google/calendars?licenseKey=${encodeURIComponent(licenseKey)}`,
    ),

  setDefaultCalendar: (licenseKey: string, calendarId: string, calendarName: string) =>
    postJson<{ ok: boolean }>('/api/google/default-calendar', { licenseKey, calendarId, calendarName }),

  disconnectGoogle: (licenseKey: string) => postJson<{ ok: boolean }>('/api/google/disconnect', { licenseKey }),

  // OAuth開始はページ遷移（ポップアップ不可のためフルリダイレクト）
  googleConnectUrl: (licenseKey: string) =>
    `${API_BASE}/api/google/oauth/start?licenseKey=${encodeURIComponent(licenseKey)}`,

  // 購入直後にライセンスキーを1回だけ取得
  checkoutResult: (sessionId: string) =>
    getJson<{ ok: boolean; licenseKey?: string }>(`/webhook/result?session_id=${encodeURIComponent(sessionId)}`),
};
