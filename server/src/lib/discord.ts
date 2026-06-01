import { env } from '../env.js';
import { jstStamp } from './time.js';

export type SyncErrorType =
  | 'google_token_expired'
  | 'google_refresh_failed'
  | 'google_permission_denied'
  | 'google_calendar_not_found'
  | 'google_event_create_failed'
  | 'google_event_update_failed'
  | 'google_event_delete_failed'
  | 'network_error'
  | 'server_error'
  | 'unknown_error';

export interface SyncErrorInfo {
  appId: string;
  userId: string;
  licenseId: string;
  savedEventId: string;
  eventTitle: string;
  action: 'create' | 'update' | 'delete';
  calendarId?: string;
  errorType: SyncErrorType;
  errorMessage: string;
  occurredAt?: string;
}

// 同期エラーをDiscordへ通知。画像・子どもの氏名など過度な個人情報は送らない。
export async function notifyDiscordSyncError(info: SyncErrorInfo): Promise<void> {
  const webhookUrl = env.DISCORD_ERROR_WEBHOOK_URL;
  if (!webhookUrl) return;

  const content = [
    '🚨 Googleカレンダー同期エラー',
    '',
    `アプリ: ${info.appId}`,
    `ユーザーID: ${info.userId}`,
    `ライセンスID: ${info.licenseId}`,
    `予定ID: ${info.savedEventId}`,
    `予定名: ${info.eventTitle}`,
    `処理: ${info.action}`,
    `登録先: ${info.calendarId ?? '不明'}`,
    `エラー種別: ${info.errorType}`,
    `原因: ${info.errorMessage}`,
    `発生時刻: ${info.occurredAt ?? jstStamp()}`,
  ].join('\n');

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  } catch (e) {
    console.error('[discord] 通知失敗', e);
  }
}
