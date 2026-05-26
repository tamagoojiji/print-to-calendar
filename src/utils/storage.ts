import type { EventItem } from '../types';

const EVENTS_KEY = 'ptc_events';

export function loadEvents(): EventItem[] {
  const raw = localStorage.getItem(EVENTS_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as EventItem[];
  } catch {
    return [];
  }
}

export function saveEvents(events: EventItem[]): void {
  localStorage.setItem(EVENTS_KEY, JSON.stringify(events));
}

export function addEvents(newEvents: EventItem[]): void {
  saveEvents([...loadEvents(), ...newEvents]);
}

export function removeEvent(id: string): void {
  saveEvents(loadEvents().filter(e => e.id !== id));
}

export function updateEvent(id: string, patch: Partial<EventItem>): void {
  saveEvents(loadEvents().map(e => (e.id === id ? { ...e, ...patch } : e)));
}

export function makeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
