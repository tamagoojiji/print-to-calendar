import { useRef, useState } from 'react';
import { analyzeEventImage, fileToBase64, getStoredApiKey } from '../utils/gemini';
import { addEvents, makeId } from '../utils/storage';
import type { ParsedEvent } from '../types';

interface Props {
  onSaved: () => void;
  onNeedApiKey: () => void;
}

type RowEvent = ParsedEvent & { checked: boolean };

export default function EventImport({ onSaved, onNeedApiKey }: Props) {
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<RowEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const apiKey = getStoredApiKey();
    if (!apiKey) {
      onNeedApiKey();
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const base64 = await fileToBase64(file);
      const data = await analyzeEventImage(apiKey, base64, file.type);

      if (data.events.length > 0) {
        setEvents(prev => [...prev, ...data.events.map(e => ({ ...e, checked: true }))]);
      } else {
        setError('イベント情報を読み取れませんでした');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み取りに失敗しました');
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const updateRow = (index: number, field: keyof ParsedEvent, value: string) => {
    setEvents(prev => prev.map((ev, i) => (i === index ? { ...ev, [field]: value } : ev)));
  };

  const toggleCheck = (index: number, checked: boolean) => {
    setEvents(prev => prev.map((ev, i) => (i === index ? { ...ev, checked } : ev)));
  };

  const removeRow = (index: number) => {
    setEvents(prev => prev.filter((_, i) => i !== index));
  };

  const addBlankRow = () => {
    const today = new Date().toISOString().slice(0, 10);
    setEvents(prev => [...prev, { date: today, time: '', content: '', url: '', checked: true }]);
  };

  const save = () => {
    const valid = events.filter(e => e.checked && e.date && e.content);
    if (valid.length === 0) {
      alert('選択した行に日付と内容が入っていません');
      return;
    }
    const now = Date.now();
    addEvents(
      valid.map(e => ({
        id: makeId(),
        date: e.date,
        time: e.time,
        content: e.content,
        url: e.url || undefined,
        createdAt: now,
      })),
    );
    alert(`${valid.length}件を保存しました`);
    setEvents([]);
    onSaved();
  };

  return (
    <div className="event-import">
      <p className="desc">プリントの写真をアップロードすると、AIが日付・時間・内容を読み取ります。</p>

      <div className="upload-area" onClick={() => fileRef.current?.click()}>
        <div className="upload-icon">📷</div>
        <div>タップして画像を選択</div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFileSelect} hidden />
      </div>

      {loading && (
        <div className="loading">
          <div className="spinner" />
          <p>読み取り中...</p>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <div className="preview">
        <table className="ev-table">
          <thead>
            <tr>
              <th></th>
              <th>日付</th>
              <th>時間</th>
              <th>内容</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev, i) => (
              <tr key={i} className={ev.checked ? '' : 'unchecked'}>
                <td>
                  <input
                    type="checkbox"
                    checked={ev.checked}
                    onChange={e => toggleCheck(i, e.target.checked)}
                  />
                </td>
                <td>
                  <input type="date" value={ev.date} onChange={e => updateRow(i, 'date', e.target.value)} />
                </td>
                <td>
                  <input
                    type="time"
                    value={ev.time}
                    onChange={e => updateRow(i, 'time', e.target.value)}
                    style={{ width: '90px' }}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={ev.content}
                    onChange={e => updateRow(i, 'content', e.target.value)}
                    placeholder="予定内容"
                  />
                </td>
                <td>
                  <button className="remove-btn" onClick={() => removeRow(i)}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button className="add-btn" onClick={addBlankRow}>
          ＋ 行を追加
        </button>
      </div>

      {events.length > 0 && (
        <div className="actions">
          <button
            className="primary-btn"
            onClick={save}
            disabled={events.filter(e => e.checked).length === 0}
          >
            選択した{events.filter(e => e.checked).length}件を保存
          </button>
          <button className="secondary-btn" onClick={() => setEvents([])}>
            クリア
          </button>
        </div>
      )}
    </div>
  );
}
