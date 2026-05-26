import { useEffect, useState } from 'react';
import type { EventItem } from '../types';
import { loadEvents, removeEvent } from '../utils/storage';

interface Props {
  refreshSignal: number;
}

export default function EventList({ refreshSignal }: Props) {
  const [events, setEvents] = useState<EventItem[]>([]);

  useEffect(() => {
    setEvents(loadEvents().sort((a, b) => a.date.localeCompare(b.date)));
  }, [refreshSignal]);

  const del = (id: string) => {
    if (!confirm('この予定を削除しますか？')) return;
    removeEvent(id);
    setEvents(loadEvents().sort((a, b) => a.date.localeCompare(b.date)));
  };

  if (events.length === 0) {
    return <p className="desc">保存された予定はありません。</p>;
  }

  return (
    <div className="event-list">
      {events.map(ev => (
        <div key={ev.id} className="event-card">
          <div className="event-date">
            {ev.date}
            {ev.time && <span className="event-time"> {ev.time}</span>}
          </div>
          <div className="event-content">{ev.content}</div>
          {ev.url && (
            <a className="event-url" href={ev.url} target="_blank" rel="noreferrer">
              {ev.url}
            </a>
          )}
          <button className="remove-btn" onClick={() => del(ev.id)}>
            削除
          </button>
        </div>
      ))}
    </div>
  );
}
