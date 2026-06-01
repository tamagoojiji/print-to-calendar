import { useRef, useState } from 'react';
import { api, type AnalyzedEvent } from '../utils/api';
import { getLicenseKey } from '../utils/license';
import { reasonText } from '../utils/messages';

interface Props {
  onSaved: () => void;
  onUsage: () => void;
}

type Row = AnalyzedEvent & { checked: boolean };

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string); // dataURLのまま送る
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function EventImport({ onSaved, onUsage }: Props) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const lk = getLicenseKey();
    if (!lk) {
      setError('先にライセンスキーを設定してください');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const dataUrl = await fileToBase64(file);
      const res = await api.analyze(lk, dataUrl);
      if (!res.ok) {
        setError(reasonText(res.reason) || res.message || '読み取りに失敗しました');
        return;
      }
      if (!res.events?.length) {
        setError('予定情報を読み取れませんでした');
      } else {
        setRows((prev) => [...prev, ...res.events!.map((ev) => ({ ...ev, checked: true }))]);
        setWarnings(res.warnings || []);
      }
      onUsage();
    } catch {
      setError('通信に失敗しました。電波の良い場所で再度お試しください。');
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const upd = (i: number, field: keyof Row, value: string | boolean) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));

  const remove = (i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    const lk = getLicenseKey();
    const valid = rows.filter((r) => r.checked && r.date && r.title);
    if (!valid.length) {
      alert('選択した予定に日付と予定名が入っていません');
      return;
    }
    setSaving(true);
    try {
      const res = await api.saveAndSync(
        lk,
        valid.map((r) => ({
          title: r.title,
          date: r.date,
          startTime: r.isAllDay ? null : r.startTime,
          endTime: r.isAllDay ? null : r.endTime,
          isAllDay: r.isAllDay,
          location: r.location,
          memo: r.memo,
        })),
      );
      if (res.ok) {
        alert(`予定を保存しました。\nGoogleカレンダーにも登録しました。（${res.saved}件）`);
      } else {
        alert(
          `予定は保存しましたが、${res.failed}件をGoogleカレンダーに登録できませんでした。\n「一覧」からあとで再同期できます。`,
        );
      }
      setRows([]);
      setWarnings([]);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  const checkedCount = rows.filter((r) => r.checked).length;

  return (
    <div className="event-import">
      <p className="desc">
        学校や塾の予定プリントを撮影してアップロードしてください。日付・時間・内容をAIが読み取ります。
      </p>
      <p className="privacy-note">
        写真内の文字をAIで読み取り、予定候補を作成します。画像は予定抽出のために送信されますが、長期保存はしません。
        読み取り結果は必ず確認してから保存してください。
      </p>

      <div className="upload-area" onClick={() => fileRef.current?.click()}>
        <div className="upload-icon">📷</div>
        <div>タップして画像を選択</div>
        <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} hidden />
      </div>

      {loading && (
        <div className="loading">
          <div className="spinner" />
          <p>読み取り中...</p>
        </div>
      )}
      {error && <div className="error">{error}</div>}

      {rows.length > 0 && (
        <div className="confirm">
          <h3>読み取り結果を確認してください</h3>
          <p className="desc">
            AIが読み取った予定候補です。日付・時間・内容に間違いがないか確認してから保存してください。
          </p>
          {warnings.length > 0 && (
            <ul className="warnings">
              {warnings.map((w, i) => (
                <li key={i}>⚠️ {w}</li>
              ))}
            </ul>
          )}

          {rows.map((r, i) => (
            <div key={i} className={r.checked ? 'ev-card' : 'ev-card unchecked'}>
              <div className="ev-head">
                <label className="ev-check">
                  <input type="checkbox" checked={r.checked} onChange={(e) => upd(i, 'checked', e.target.checked)} />
                  保存する
                </label>
                <button className="remove-btn" onClick={() => remove(i)}>
                  ×
                </button>
              </div>
              <input
                className="ev-title"
                value={r.title}
                placeholder="予定名"
                onChange={(e) => upd(i, 'title', e.target.value)}
              />
              <div className="ev-fields">
                <input type="date" value={r.date} onChange={(e) => upd(i, 'date', e.target.value)} />
                <label className="ev-allday">
                  <input type="checkbox" checked={r.isAllDay} onChange={(e) => upd(i, 'isAllDay', e.target.checked)} />
                  終日
                </label>
                {!r.isAllDay && (
                  <>
                    <input
                      type="time"
                      value={r.startTime || ''}
                      onChange={(e) => upd(i, 'startTime', e.target.value)}
                    />
                    <span>〜</span>
                    <input type="time" value={r.endTime || ''} onChange={(e) => upd(i, 'endTime', e.target.value)} />
                  </>
                )}
              </div>
              <input
                className="ev-sub"
                value={r.location || ''}
                placeholder="場所"
                onChange={(e) => upd(i, 'location', e.target.value)}
              />
              <input
                className="ev-sub"
                value={r.memo || ''}
                placeholder="メモ"
                onChange={(e) => upd(i, 'memo', e.target.value)}
              />
            </div>
          ))}

          <div className="actions sticky-actions">
            <button className="primary-btn" onClick={save} disabled={saving || checkedCount === 0}>
              {saving ? '保存中...' : `選択した${checkedCount}件を保存してカレンダーに登録`}
            </button>
            <button className="secondary-btn" onClick={() => setRows([])}>
              クリア
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
