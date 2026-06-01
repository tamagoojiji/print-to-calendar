import { db, APP_ID, PLAN_ID } from '../db.js';
import { pid } from '../lib/ids.js';
import { generateLicenseKey, hashLicenseKey } from '../lib/crypto.js';
import { addMonthsJstIso, currentUsageMonth, nowIso } from '../lib/time.js';

interface PlanRow {
  id: string;
  duration_months: number;
  monthly_limit: number | null;
  support_free_months: number;
  price: number;
  currency: string;
}

export interface IssueInput {
  email?: string | null;
  displayName?: string | null;
  appId?: string;
  planId?: string;
  stripeSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  amountTotal?: number;
}

export interface IssueResult {
  licenseKey: string;
  licenseId: string;
  userId: string;
  expiresAt: string;
}

// users取得or作成 → license発行 → purchase記録 → support_contract(free_active)作成。
// 同一トランザクションで実行。licenseKey平文は戻り値でのみ返す（DBはhashのみ）。
export function issueLicense(input: IssueInput): IssueResult {
  const appId = input.appId || APP_ID;
  const planId = input.planId || PLAN_ID;
  const plan = db.prepare('SELECT * FROM plans WHERE id = ?').get(planId) as PlanRow | undefined;
  if (!plan) throw new Error(`plan not found: ${planId}`);

  const ts = nowIso();
  const month = currentUsageMonth();
  const base = new Date();

  const tx = db.transaction((): IssueResult => {
    // user upsert by email
    let userId: string;
    const email = input.email?.trim().toLowerCase() || null;
    const existing = email
      ? (db.prepare('SELECT id FROM users WHERE email = ?').get(email) as { id: string } | undefined)
      : undefined;
    if (existing) {
      userId = existing.id;
      db.prepare('UPDATE users SET updated_at = ? WHERE id = ?').run(ts, userId);
    } else {
      userId = pid('user');
      db.prepare(
        'INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
      ).run(userId, email, input.displayName ?? null, ts, ts);
    }

    // license
    const licenseId = pid('license');
    const licenseKey = generateLicenseKey('PTC');
    const expiresAt = addMonthsJstIso(base, plan.duration_months);
    db.prepare(
      `INSERT INTO licenses
        (id, user_id, app_id, plan_id, license_key_hash, status, starts_at, expires_at,
         monthly_limit, monthly_used, usage_month, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, 0, ?, ?, ?)`,
    ).run(licenseId, userId, appId, planId, hashLicenseKey(licenseKey), ts, expiresAt, plan.monthly_limit, month, ts, ts);

    // purchase
    const purchaseId = pid('purchase');
    db.prepare(
      `INSERT INTO purchases
        (id, user_id, app_id, plan_id, license_id, stripe_session_id, stripe_payment_intent_id,
         amount_total, currency, status, purchased_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'paid', ?, ?)`,
    ).run(
      purchaseId,
      userId,
      appId,
      planId,
      licenseId,
      input.stripeSessionId ?? null,
      input.stripePaymentIntentId ?? null,
      input.amountTotal ?? plan.price,
      plan.currency,
      ts,
      ts,
    );

    // support_contract: free_active（購入後 support_free_months ヶ月）
    const supportId = pid('support');
    const freeEnds = addMonthsJstIso(base, plan.support_free_months);
    db.prepare(
      `INSERT INTO support_contracts
        (id, user_id, app_id, license_id, status, free_support_starts_at, free_support_ends_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'free_active', ?, ?, ?, ?)`,
    ).run(supportId, userId, appId, licenseId, ts, freeEnds, ts, ts);

    return { licenseKey, licenseId, userId, expiresAt };
  });

  return tx();
}
