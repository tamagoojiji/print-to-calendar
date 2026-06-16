import Database from 'better-sqlite3';
import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { env } from './env.js';
import { SCHEMA_SQL } from './schema.js';
import { nowIso } from './lib/time.js';

const dbPath = resolve(process.cwd(), env.DB_PATH);
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 複数ステートメントSQLの一括実行（better-sqlite3のexecメソッド経由）
function runSqlScript(sql: string): void {
  const runner = db['exec'].bind(db);
  runner(sql);
}

export function migrate(): void {
  runSqlScript(SCHEMA_SQL);
  seedApps();
}

// apps / plans の初期データ（print-to-calendar のみ）。冪等。
function seedApps(): void {
  const ts = nowIso();
  db.prepare(
    `INSERT INTO apps (id, slug, name, description, status, created_at, updated_at)
     VALUES (@id, @slug, @name, @description, 'active', @ts, @ts)
     ON CONFLICT(id) DO NOTHING`,
  ).run({
    id: 'app_print_to_calendar',
    slug: 'print_to_calendar',
    name: 'print-to-calendar',
    description: 'プリント画像から予定を抽出しGoogleカレンダーに登録するPWA',
    ts,
  });

  db.prepare(
    `INSERT INTO plans (id, app_id, name, price, currency, duration_months, monthly_limit, support_free_months, created_at, updated_at)
     VALUES (@id, @app_id, @name, @price, 'JPY', @duration_months, @monthly_limit, @support_free_months, @ts, @ts)
     ON CONFLICT(id) DO NOTHING`,
  ).run({
    id: 'plan_ptc_6months_500',
    app_id: 'app_print_to_calendar',
    name: '6ヶ月プラン',
    price: 500,
    duration_months: 6,
    monthly_limit: 30,
    support_free_months: 3,
    ts,
  });
}

export const APP_ID = 'app_print_to_calendar';
export const PLAN_ID = 'plan_ptc_6months_500';
