-- print-to-calendar D1/SQLite スキーマ
-- 複数アプリ共通ライセンス基盤。運用は print-to-calendar のみから開始。

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY',
  duration_months INTEGER NOT NULL,
  monthly_limit INTEGER,
  support_free_months INTEGER NOT NULL DEFAULT 3,
  stripe_price_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (app_id) REFERENCES apps(id)
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  display_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  license_key_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  monthly_limit INTEGER,
  monthly_used INTEGER NOT NULL DEFAULT 0,
  usage_month TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (app_id) REFERENCES apps(id),
  FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  license_id TEXT,
  stripe_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT,
  amount_total INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'JPY',
  status TEXT NOT NULL,
  purchased_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (app_id) REFERENCES apps(id),
  FOREIGN KEY (plan_id) REFERENCES plans(id),
  FOREIGN KEY (license_id) REFERENCES licenses(id)
);

CREATE TABLE IF NOT EXISTS support_contracts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  license_id TEXT NOT NULL,
  status TEXT NOT NULL,
  free_support_starts_at TEXT NOT NULL,
  free_support_ends_at TEXT NOT NULL,
  paid_support_starts_at TEXT,
  paid_support_ends_at TEXT,
  stripe_session_id TEXT,
  amount_total INTEGER,
  currency TEXT DEFAULT 'JPY',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (app_id) REFERENCES apps(id),
  FOREIGN KEY (license_id) REFERENCES licenses(id)
);

CREATE TABLE IF NOT EXISTS google_connections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  license_id TEXT NOT NULL,
  google_sub TEXT,
  google_email TEXT,
  status TEXT NOT NULL,
  scope TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  default_calendar_id TEXT,
  default_calendar_name TEXT,
  connected_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (license_id) REFERENCES licenses(id)
);

CREATE TABLE IF NOT EXISTS saved_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  license_id TEXT NOT NULL,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  is_all_day INTEGER NOT NULL DEFAULT 0,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  memo TEXT,
  location TEXT,
  calendar_sync_status TEXT NOT NULL DEFAULT 'not_synced',
  google_calendar_id TEXT,
  google_event_id TEXT,
  google_html_link TEXT,
  last_synced_at TEXT,
  sync_error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (license_id) REFERENCES licenses(id)
);

CREATE TABLE IF NOT EXISTS calendar_sync_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  license_id TEXT NOT NULL,
  saved_event_id TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL,
  google_calendar_id TEXT,
  google_event_id TEXT,
  error_type TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (license_id) REFERENCES licenses(id),
  FOREIGN KEY (saved_event_id) REFERENCES saved_events(id)
);

CREATE TABLE IF NOT EXISTS usage_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  license_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  used_at TEXT NOT NULL,
  usage_month TEXT NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  model_name TEXT,
  estimated_cost TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (license_id) REFERENCES licenses(id),
  FOREIGN KEY (app_id) REFERENCES apps(id)
);

-- OAuth state（CSRF対策・短命）。Google連携開始〜コールバックの突き合わせ用。
CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  license_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 購入直後のsuccessページで1回だけライセンスキーを表示するための短命テーブル。
-- 読み取り後に削除する（平文の長期保存はしない）。
CREATE TABLE IF NOT EXISTS license_reveals (
  stripe_session_id TEXT PRIMARY KEY,
  license_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_licenses_hash ON licenses(license_key_hash);
CREATE INDEX IF NOT EXISTS idx_saved_events_license ON saved_events(license_id);
CREATE INDEX IF NOT EXISTS idx_google_conn_license ON google_connections(license_id);
CREATE INDEX IF NOT EXISTS idx_sync_logs_event ON calendar_sync_logs(saved_event_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_license ON usage_logs(license_id);
