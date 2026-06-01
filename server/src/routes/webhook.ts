import { Hono } from 'hono';
import type Stripe from 'stripe';
import { db } from '../db.js';
import { nowIso } from '../lib/time.js';
import { verifyStripeEvent } from '../lib/stripe.js';
import { issueLicense } from '../services/issueLicense.js';

export const webhookRoute = new Hono();

// POST /webhook/stripe  （raw bodyで署名検証）
webhookRoute.post('/stripe', async (c) => {
  const sig = c.req.header('stripe-signature');
  if (!sig) return c.json({ ok: false, error: 'missing signature' }, 400);

  const raw = await c.req.text();
  let event: Stripe.Event;
  try {
    event = verifyStripeEvent(raw, sig);
  } catch (e) {
    console.error('[webhook] 署名検証失敗', e);
    return c.json({ ok: false, error: 'invalid signature' }, 400);
  }

  if (event.type !== 'checkout.session.completed') {
    return c.json({ ok: true, ignored: event.type });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const sessionId = session.id;

  // 冪等性: 同一 stripe_session_id が処理済みならスキップ
  const dup = db.prepare('SELECT id FROM purchases WHERE stripe_session_id = ?').get(sessionId);
  if (dup) return c.json({ ok: true, duplicate: true });

  const email = session.customer_details?.email || session.customer_email || null;
  const amount = session.amount_total ?? 500;
  const paymentIntentId =
    typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id ?? null;

  try {
    const result = issueLicense({
      email,
      displayName: session.customer_details?.name ?? null,
      stripeSessionId: sessionId,
      stripePaymentIntentId: paymentIntentId,
      amountTotal: amount,
    });
    // successページ用の一時表示レコード（読取後削除）
    db.prepare(
      'INSERT OR REPLACE INTO license_reveals (stripe_session_id, license_key, created_at) VALUES (?, ?, ?)',
    ).run(sessionId, result.licenseKey, nowIso());

    console.log(`[webhook] ライセンス発行 license=${result.licenseId} session=${sessionId}`);
    return c.json({ ok: true, licenseId: result.licenseId });
  } catch (e) {
    console.error('[webhook] ライセンス発行失敗', e);
    return c.json({ ok: false, error: 'issue_failed' }, 500);
  }
});

// GET /api/checkout/result?session_id=...  購入直後に1回だけキーを返す
webhookRoute.get('/result', (c) => {
  const sessionId = c.req.query('session_id') || '';
  const row = db.prepare('SELECT license_key FROM license_reveals WHERE stripe_session_id = ?').get(sessionId) as
    | { license_key: string }
    | undefined;
  if (!row) return c.json({ ok: false, reason: 'not_found_or_already_shown' }, 404);
  db.prepare('DELETE FROM license_reveals WHERE stripe_session_id = ?').run(sessionId);
  return c.json({ ok: true, licenseKey: row.license_key });
});
