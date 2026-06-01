import { Hono } from 'hono';
import { validateForUse, getSupport } from '../lib/license.js';

export const licenseRoute = new Hono();

// POST /api/license/validate
licenseRoute.post('/validate', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const licenseKey = String(body.licenseKey || '').trim();
  if (!licenseKey) return c.json({ ok: false, reason: 'invalid_license' }, 400);

  try {
    const result = validateForUse(licenseKey);
    if (!result.ok || !result.license) {
      return c.json({ ok: false, reason: result.reason });
    }
    const lic = result.license;
    const support = getSupport(lic.id);
    const remaining = lic.monthly_limit == null ? null : Math.max(0, lic.monthly_limit - lic.monthly_used);
    return c.json({
      ok: true,
      status: lic.status,
      expiresAt: lic.expires_at,
      monthlyLimit: lic.monthly_limit,
      monthlyUsed: lic.monthly_used,
      remaining,
      support: support
        ? {
            status: support.status,
            freeSupportEndsAt: support.free_support_ends_at,
            paidSupportEndsAt: support.paid_support_ends_at,
          }
        : null,
    });
  } catch (e) {
    console.error('[license/validate]', e);
    return c.json({ ok: false, reason: 'server_error' }, 500);
  }
});
