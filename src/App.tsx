import { useCallback, useEffect, useState } from 'react';
import EventImport from './components/EventImport';
import EventList from './components/EventList';
import Settings from './components/Settings';
import { api, type LicenseInfo } from './utils/api';
import { getLicenseKey, setLicenseKey } from './utils/license';

type Tab = 'import' | 'list' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('import');
  const [refresh, setRefresh] = useState(0);
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [booted, setBooted] = useState(false);

  const revalidate = useCallback(async () => {
    const lk = getLicenseKey();
    if (!lk) {
      setLicenseInfo(null);
      return;
    }
    const info = await api.validateLicense(lk);
    setLicenseInfo(info);
  }, []);

  // 初回: Googleコールバック / Stripe購入完了 / ライセンス検証
  useEffect(() => {
    (async () => {
      // Googleコールバック後のハッシュ
      const hash = window.location.hash;
      if (hash.includes('google=connected')) {
        setToast('Googleカレンダーと連携しました');
        history.replaceState(null, '', window.location.pathname + window.location.search);
      } else if (hash.includes('google=error')) {
        setToast('Google連携に失敗しました。設定からやり直してください');
        history.replaceState(null, '', window.location.pathname + window.location.search);
      }

      // Stripe購入完了（success_urlに ?session_id=... が付与される想定）
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get('session_id');
      if (sessionId && !getLicenseKey()) {
        const r = await api.checkoutResult(sessionId);
        if (r.ok && r.licenseKey) {
          setLicenseKey(r.licenseKey);
          setToast('ご購入ありがとうございます。ライセンスを設定しました');
          history.replaceState(null, '', window.location.pathname);
        }
      }

      await revalidate();
      setBooted(true);
    })();
  }, [revalidate]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const hasLicense = !!licenseInfo?.ok;

  return (
    <div className="app">
      <header className="header">
        <h1>print-to-calendar</h1>
      </header>

      {toast && <div className="toast">{toast}</div>}

      {!booted ? (
        <main className="main">
          <p className="desc">読み込み中...</p>
        </main>
      ) : !hasLicense ? (
        // ライセンス未設定 → オンボーディング（ライセンス入力 + Google連携）
        <main className="main">
          <div className="onboarding">
            <p className="lead">学校プリントを撮るだけ。AIが予定を読み取って、予定管理をラクにします。</p>
            <p className="desc">はじめにライセンスキーを入力し、Googleカレンダーと連携してください。</p>
          </div>
          <Settings licenseInfo={licenseInfo} onLicenseChange={revalidate} />
        </main>
      ) : (
        <>
          <nav className="tabs">
            <button className={tab === 'import' ? 'tab active' : 'tab'} onClick={() => setTab('import')}>
              読み込み
            </button>
            <button
              className={tab === 'list' ? 'tab active' : 'tab'}
              onClick={() => {
                setRefresh((r) => r + 1);
                setTab('list');
              }}
            >
              一覧
            </button>
            <button className={tab === 'settings' ? 'tab active' : 'tab'} onClick={() => setTab('settings')}>
              設定
            </button>
          </nav>

          {licenseInfo && licenseInfo.monthlyLimit != null && (licenseInfo.remaining ?? 0) <= 5 && (
            <div className="usage-warning">
              今月の読み取り回数: {licenseInfo.monthlyUsed} / {licenseInfo.monthlyLimit} 回
              {(licenseInfo.remaining ?? 0) <= 0
                ? '（上限に達しました。翌月1日にリセットされます）'
                : '（残りわずかです。翌月1日にリセットされます）'}
            </div>
          )}

          <main className="main">
            {tab === 'import' && (
              <EventImport onSaved={() => setRefresh((r) => r + 1)} onUsage={revalidate} />
            )}
            {tab === 'list' && <EventList refreshSignal={refresh} />}
            {tab === 'settings' && <Settings licenseInfo={licenseInfo} onLicenseChange={revalidate} />}
          </main>
        </>
      )}
    </div>
  );
}
