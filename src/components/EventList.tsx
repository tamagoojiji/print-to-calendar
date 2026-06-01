import { useCallback, useEffect, useState } from 'react';
import { API_BASE, api, type SavedEvent } from '../utils/api';
import { getLicenseKey } from '../utils/license';

interface Props {
  refreshSignal: number;
}

const SYNC_LABEL: Record<string, string> = {
  not_synced: '未同期',
  syncing: '同期中',
  synced: '登録済み',
  sync_failed: '同期失敗',
  deleted: '削除済み',
};

export default function EventList({ refreshSignal }: Props) {
  const [events, setEvents] = useState<SavedEvent[]>([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    const lk = getLicenseKey();
    if (!lk) return;
    setLoading(true);
    try {
      const r = await api.listEvents(lk);
      if (r.ok && r.events) setEvents(r.events);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 一覧をバックエンドから取得（外部APIとの同期。setStateはawait後）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload, refreshSignal]);

  const retry = async (id: string) => {
    const r = await api.retrySync(getLicenseKey(), id);
    if (r.ok) alert('再同期しました');
    else alert('再同期に失敗しました。Google連携を確認してください。');
    reload();
  };

  const del = async (ev: SavedEvent) => {
    const choice = window.prompt(
      `「${ev.title}」を削除します。\n\n1: アプリからだけ削除\n2: Googleカレンダーからも削除\n（その他: キャンセル）`,
      '1',
    );
    if (choice !== '1' && choice !== '2') return;
    const r = await api.deleteEvent(getLicenseKey(), ev.id, choice === '2');
    if (!r.ok) {
      alert('Googleカレンダーからの削除に失敗しました。あとで再度お試しください。');
    }
    reload();
  };

  const downloadIcs = () => {
    const lk = getLicenseKey();
    // POSTでicsを取得しBlob保存
    fetch(`${API_BASE}/api/events/ics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: lk }),
    })
      .then((r) => r.blob())
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'print-to-calendar.ics';
        a.click();
        URL.revokeObjectURL(url);
      });
  };

  if (loading && !events.length) return <p className="desc">読み込み中...</p>;
  if (!events.length) return <p className="desc">保存された予定はありません。</p>;

  return (
    <div className="event-list">
      <div className="list-actions">
        <button className="secondary-btn" onClick={downloadIcs}>
          予定ファイル(.ics)を作成
        </button>
      </div>
      {events.map((ev) => (
        <div key={ev.id} className="event-card">
          <div className="event-date">
            {ev.date}
            {!ev.is_all_day && ev.start_time && <span className="event-time"> {ev.start_time}</span>}
            {ev.is_all_day ? <span className="event-time"> 終日</span> : null}
          </div>
          <div className="event-content">{ev.title}</div>
          {ev.location && <div className="event-sub">📍 {ev.location}</div>}
          <div className={`sync-badge sync-${ev.calendar_sync_status}`}>
            {SYNC_LABEL[ev.calendar_sync_status] || ev.calendar_sync_status}
          </div>
          {ev.calendar_sync_status === 'sync_failed' && (
            <>
              <div className="sync-error">{ev.sync_error_message}</div>
              <button className="secondary-btn sm" onClick={() => retry(ev.id)}>
                再同期する
              </button>
            </>
          )}
          {ev.google_html_link && (
            <a className="event-url" href={ev.google_html_link} target="_blank" rel="noreferrer">
              Googleカレンダーで開く
            </a>
          )}
          <button className="remove-btn" onClick={() => del(ev)}>
            削除
          </button>
        </div>
      ))}
    </div>
  );
}
