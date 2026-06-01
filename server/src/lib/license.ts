import { db, APP_ID } from '../db.js';
import { hashLicenseKey } from './crypto.js';
import { currentUsageMonth, nowIso } from './time.js';

export interface LicenseRow {
  id: string;
  user_id: string;
  app_id: string;
  plan_id: string;
  status: string;
  starts_at: string;
  expires_at: string;
  monthly_limit: number | null;
  monthly_used: number;
  usage_month: string;
  revoked_at: string | null;
}

export interface SupportRow {
  status: string;
  free_support_ends_at: string;
  paid_support_ends_at: string | null;
}

export type ValidateReason =
  | 'invalid_license'
  | 'expired'
  | 'revoked'
  | 'over_monthly_limit'
  | 'server_error';

export interface ValidateResult {
  ok: boolean;
  reason?: ValidateReason;
  license?: LicenseRow;
  remaining?: number;
}

export function findLicenseByKey(licenseKey: string): LicenseRow | null {
  const hash = hashLicenseKey(licenseKey);
  const row = db
    .prepare('SELECT * FROM licenses WHERE license_key_hash = ? AND app_id = ?')
    .get(hash, APP_ID) as LicenseRow | undefined;
  return row ?? null;
}

// usage_month が当月と違えば monthly_used を0にリセット（遅延リセット）
export function ensureMonthlyReset(license: LicenseRow): LicenseRow {
  const month = currentUsageMonth();
  if (license.usage_month !== month) {
    const ts = nowIso();
    db.prepare(
      'UPDATE licenses SET monthly_used = 0, usage_month = ?, updated_at = ? WHERE id = ?',
    ).run(month, ts, license.id);
    license.monthly_used = 0;
    license.usage_month = month;
  }
  return license;
}

// 期限切れを反映（statusをexpiredへ遅延更新）
function applyExpiry(license: LicenseRow): LicenseRow {
  if (license.status === 'active' && new Date(license.expires_at).getTime() < Date.now()) {
    const ts = nowIso();
    db.prepare('UPDATE licenses SET status = ?, updated_at = ? WHERE id = ?').run('expired', ts, license.id);
    license.status = 'expired';
  }
  return license;
}

export function getSupport(licenseId: string): SupportRow | null {
  return (
    (db
      .prepare(
        'SELECT status, free_support_ends_at, paid_support_ends_at FROM support_contracts WHERE license_id = ? ORDER BY created_at DESC LIMIT 1',
      )
      .get(licenseId) as SupportRow | undefined) ?? null
  );
}

// 利用前チェック（remaining計算込み・副作用: リセット/期限反映）
export function validateForUse(licenseKey: string): ValidateResult {
  let license = findLicenseByKey(licenseKey);
  if (!license) return { ok: false, reason: 'invalid_license' };

  license = ensureMonthlyReset(license);
  license = applyExpiry(license);

  if (license.status === 'revoked') return { ok: false, reason: 'revoked', license };
  if (license.status === 'paused') return { ok: false, reason: 'revoked', license };
  if (license.status === 'expired') return { ok: false, reason: 'expired', license };

  const limit = license.monthly_limit;
  const remaining = limit == null ? Infinity : Math.max(0, limit - license.monthly_used);
  if (limit != null && license.monthly_used >= limit) {
    return { ok: false, reason: 'over_monthly_limit', license, remaining: 0 };
  }
  return { ok: true, license, remaining: remaining === Infinity ? -1 : remaining };
}

// 成功時のみ monthly_used を +1
export function incrementUsage(licenseId: string): void {
  db.prepare('UPDATE licenses SET monthly_used = monthly_used + 1, updated_at = ? WHERE id = ?').run(
    nowIso(),
    licenseId,
  );
}
