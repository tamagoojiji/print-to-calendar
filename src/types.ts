export interface EventItem {
  id: string;
  date: string;
  time: string;
  content: string;
  url?: string;
  googleEventId?: string;
  createdAt: number;
}

export interface ParsedEvent {
  date: string;
  time: string;
  content: string;
  url: string;
}
