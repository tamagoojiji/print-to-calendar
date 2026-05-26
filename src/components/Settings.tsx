import { useState } from 'react';
import { clearStoredApiKey, getStoredApiKey, setStoredApiKey } from '../utils/gemini';

export default function Settings() {
  const [apiKey, setApiKey] = useState(getStoredApiKey() || '');
  const [show, setShow] = useState(false);

  const save = () => {
    if (!apiKey.trim()) {
      alert('APIキーを入力してください');
      return;
    }
    setStoredApiKey(apiKey);
    alert('保存しました');
  };

  const clear = () => {
    if (!confirm('APIキーを削除しますか？')) return;
    clearStoredApiKey();
    setApiKey('');
  };

  return (
    <div className="settings">
      <h2>Gemini APIキー</h2>
      <p className="desc">
        画像解析にGemini APIを使います。キーは端末内（localStorage）にのみ保存され、外部送信されません。
      </p>
      <p className="desc">
        取得先:{' '}
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
          Google AI Studio
        </a>
      </p>
      <div className="api-key-row">
        <input
          type={show ? 'text' : 'password'}
          value={apiKey}
          onChange={e => setApiKey(e.target.value)}
          placeholder="AIzaSy..."
          className="api-key-input"
        />
        <button className="secondary-btn" onClick={() => setShow(s => !s)}>
          {show ? '隠す' : '表示'}
        </button>
      </div>
      <div className="actions">
        <button className="primary-btn" onClick={save}>
          保存
        </button>
        <button className="secondary-btn" onClick={clear}>
          削除
        </button>
      </div>
    </div>
  );
}
