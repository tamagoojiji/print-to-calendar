import { useEffect, useState } from 'react';
import { api, type LicenseInfo } from '../utils/api';
import { clearLicenseKey, getLicenseKey, setLicenseKey } from '../utils/license';
import { reasonText } from '../utils/messages';

interface Props {
  licenseInfo: LicenseInfo | null;
  onLicenseChange: () => void;
}

interface GoogleStatus {
  connected: boolean;
  email?: string;
  defaultCalendarId?: string;
  defaultCalendarName?: string;
}

export default function Settings({ licenseInfo, onLicenseChange }: Props) {
  const [key, setKey] = useState(getLicenseKey());
  const [busy, setBusy] = useState(false);
  const [gstatus, setGstatus] = useState<GoogleStatus | null>(null);
  const [calendars, setCalendars] = useState<{ id: string; summary: string }[]>([]);

  const refreshGoogle = async () => {
    const lk = getLicenseKey();
    if (!lk) return;
    const s = await api.googleStatus(lk);
    setGstatus(s.connected ? s : { connected: false });
  };

  useEffect(() => {
    // ライセンス確定後にGoogle連携状態を取得（外部APIとの同期。setStateはawait後）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (licenseInfo?.ok) refreshGoogle();
  }, [licenseInfo?.ok]);

  const saveLicense = async () => {
    if (!key.trim()) {
      alert('ライセンスキーを入力してください');
      return;
    }
    setBusy(true);
    try {
      const info = await api.validateLicense(key.trim());
      if (!info.ok) {
        alert(reasonText(info.reason));
        return;
      }
      setLicenseKey(key.trim());
      onLicenseChange();
      await refreshGoogle();
      alert('ライセンスを確認しました');
    } finally {
      setBusy(false);
    }
  };

  const removeLicense = () => {
    if (!confirm('この端末からライセンスキーを削除しますか？')) return;
    clearLicenseKey();
    setKey('');
    onLicenseChange();
  };

  const connectGoogle = () => {
    const lk = getLicenseKey();
    if (!lk) {
      alert('先にライセンスキーを設定してください');
      return;
    }
    window.location.href = api.googleConnectUrl(lk);
  };

  const loadCalendars = async () => {
    const lk = getLicenseKey();
    const r = await api.googleCalendars(lk);
    if (r.ok && r.calendars) setCalendars(r.calendars);
    else alert('カレンダー一覧を取得できませんでした。Google連携を確認してください。');
  };

  const chooseCalendar = async (id: string, name: string) => {
    const lk = getLicenseKey();
    await api.setDefaultCalendar(lk, id, name);
    await refreshGoogle();
    alert(`登録先カレンダーを「${name}」に設定しました`);
  };

  const disconnect = async () => {
    if (!confirm('Google連携を解除しますか？')) return;
    await api.disconnectGoogle(getLicenseKey());
    setGstatus({ connected: false });
    setCalendars([]);
  };

  return (
    <div className="settings">
      <section className="card">
        <h2>ライセンスキー</h2>
        <p className="desc">購入後に表示されたライセンスキーを入力すると、予定読み取り機能が使えます。</p>
        <div className="api-key-row">
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="PTC-XXXX-XXXX-XXXX-XXXX"
            className="api-key-input"
            autoCapitalize="characters"
          />
        </div>
        <div className="actions">
          <button className="primary-btn" onClick={saveLicense} disabled={busy}>
            {busy ? '確認中...' : '保存して確認'}
          </button>
          <button className="secondary-btn" onClick={removeLicense}>
            削除
          </button>
        </div>
        {licenseInfo?.ok && (
          <div className="status-box">
            <div>利用期限: {licenseInfo.expiresAt?.slice(0, 10)}</div>
            <div>
              今月の読み取り: {licenseInfo.monthlyUsed} / {licenseInfo.monthlyLimit ?? '∞'} 回
            </div>
            {licenseInfo.support && <div>無料サポート期限: {licenseInfo.support.freeSupportEndsAt.slice(0, 10)}</div>}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Googleカレンダー連携</h2>
        {gstatus?.connected ? (
          <>
            <p className="desc">連携中: {gstatus.email || '(アカウント不明)'}</p>
            <p className="desc">
              登録先カレンダー: {gstatus.defaultCalendarName || gstatus.defaultCalendarId || 'primary'}
            </p>
            <div className="actions">
              <button className="secondary-btn" onClick={loadCalendars}>
                登録先カレンダーを選ぶ
              </button>
              <button className="secondary-btn" onClick={connectGoogle}>
                再連携
              </button>
              <button className="secondary-btn" onClick={disconnect}>
                連携解除
              </button>
            </div>
            {calendars.length > 0 && (
              <ul className="calendar-list">
                {calendars.map((c) => (
                  <li key={c.id}>
                    <button className="calendar-pick" onClick={() => chooseCalendar(c.id, c.summary)}>
                      {c.summary}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            <p className="desc">
              読み取った予定を自動でカレンダーに登録するため、Googleカレンダーとの連携が必要です。
            </p>
            <button className="primary-btn" onClick={connectGoogle}>
              Googleカレンダーと連携する
            </button>
          </>
        )}
      </section>
    </div>
  );
}
