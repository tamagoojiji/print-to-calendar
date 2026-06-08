import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { env, warnMissingSecrets } from './env.js';
import { migrate } from './db.js';
import { licenseRoute } from './routes/license.js';
import { analyzeRoute } from './routes/analyze.js';
import { eventsRoute } from './routes/events.js';
import { googleRoute } from './routes/google.js';
import { webhookRoute } from './routes/webhook.js';
import { adminRoute } from './routes/admin.js';
import { provisionRoute } from './routes/provision.js';

migrate();
warnMissingSecrets();

const app = new Hono();

const allowed = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
app.use('/api/*', cors({ origin: allowed, allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'] }));
app.use('/webhook/result', cors({ origin: allowed }));

app.get('/health', (c) => c.json({ ok: true, service: 'print-to-calendar', time: new Date().toISOString() }));

app.route('/api/license', licenseRoute);
app.route('/api/analyze', analyzeRoute);
app.route('/api/events', eventsRoute);
app.route('/api/google', googleRoute);
app.route('/webhook', webhookRoute);
app.route('/admin', adminRoute);
app.route('/provision', provisionRoute);

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`[print-to-calendar] listening on :${info.port}`);
});
