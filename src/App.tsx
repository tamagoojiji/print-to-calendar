import { useState } from 'react';
import EventImport from './components/EventImport';
import EventList from './components/EventList';
import Settings from './components/Settings';

type Tab = 'import' | 'list' | 'settings';

export default function App() {
  const [tab, setTab] = useState<Tab>('import');
  const [refresh, setRefresh] = useState(0);

  return (
    <div className="app">
      <header className="header">
        <h1>print-to-calendar</h1>
      </header>

      <nav className="tabs">
        <button className={tab === 'import' ? 'tab active' : 'tab'} onClick={() => setTab('import')}>
          読み込み
        </button>
        <button
          className={tab === 'list' ? 'tab active' : 'tab'}
          onClick={() => {
            setRefresh(r => r + 1);
            setTab('list');
          }}
        >
          一覧
        </button>
        <button className={tab === 'settings' ? 'tab active' : 'tab'} onClick={() => setTab('settings')}>
          設定
        </button>
      </nav>

      <main className="main">
        {tab === 'import' && (
          <EventImport
            onSaved={() => setRefresh(r => r + 1)}
            onNeedApiKey={() => {
              alert('先にGemini APIキーを設定してください');
              setTab('settings');
            }}
          />
        )}
        {tab === 'list' && <EventList refreshSignal={refresh} />}
        {tab === 'settings' && <Settings />}
      </main>
    </div>
  );
}
