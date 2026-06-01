import { jstStamp } from './time.js';

export interface IcsEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string | null; // HH:mm
  endTime: string | null;
  isAllDay: boolean;
  location?: string | null;
  memo?: string | null;
}

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function dtLocal(date: string, time: string): string {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

function addOneDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// 単一/複数予定を .ics（VCALENDAR）文字列に。Asia/Tokyo前提のフローティング時刻。
export function buildIcs(events: IcsEvent[]): string {
  const stamp = jstStamp().replace(/[-: ]/g, '').padEnd(15, '0').slice(0, 8) + 'T000000';
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//print-to-calendar//JP',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const ev of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.id}@print-to-calendar`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`SUMMARY:${esc(ev.title)}`);
    if (ev.location) lines.push(`LOCATION:${esc(ev.location)}`);
    const desc = ev.memo ? `print-to-calendar から出力\\n\\n${esc(ev.memo)}` : 'print-to-calendar から出力';
    lines.push(`DESCRIPTION:${desc}`);
    if (ev.isAllDay || !ev.startTime) {
      lines.push(`DTSTART;VALUE=DATE:${ev.date.replace(/-/g, '')}`);
      lines.push(`DTEND;VALUE=DATE:${addOneDay(ev.date).replace(/-/g, '')}`);
    } else {
      lines.push(`DTSTART;TZID=Asia/Tokyo:${dtLocal(ev.date, ev.startTime)}`);
      const end = ev.endTime || ev.startTime;
      lines.push(`DTEND;TZID=Asia/Tokyo:${dtLocal(ev.date, end)}`);
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
