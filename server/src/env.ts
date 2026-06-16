import 'dotenv/config';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が未設定です`);
  return v;
}

function opt(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const env = {
  PORT: Number(opt('PORT', '8787')),
  DB_PATH: opt('DB_PATH', './data/ptc.db'),

  GEMINI_API_KEY: opt('GEMINI_API_KEY'),
  STRIPE_SECRET_KEY: opt('STRIPE_SECRET_KEY'),
  STRIPE_WEBHOOK_SECRET: opt('STRIPE_WEBHOOK_SECRET'),
  GOOGLE_CLIENT_ID: opt('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: opt('GOOGLE_CLIENT_SECRET'),
  GOOGLE_REDIRECT_URI: opt('GOOGLE_REDIRECT_URI'),
  LICENSE_SECRET: opt('LICENSE_SECRET', 'dev-license-secret-change-me'),
  TOKEN_ENCRYPTION_SECRET: opt('TOKEN_ENCRYPTION_SECRET', 'dev-token-secret-change-me'),
  DISCORD_ERROR_WEBHOOK_URL: opt('DISCORD_ERROR_WEBHOOK_URL'),
  APP_BASE_URL: opt('APP_BASE_URL', 'https://tamagoojiji.github.io/print-to-calendar/'),
  ADMIN_TOKEN: opt('ADMIN_TOKEN', 'dev-admin-token-change-me'),
  // 外部ストアからのライセンス発行専用トークン（最小権限。未設定なら /provision は常に401）
  PROVISION_TOKEN: opt('PROVISION_TOKEN'),
  // CORS許可オリジン（カンマ区切り）。本番はGitHub Pagesオリジン。
  CORS_ORIGINS: opt('CORS_ORIGINS', 'http://localhost:5173,https://tamagoojiji.github.io'),
};

// 起動時に致命的な未設定を警告（開発では落とさない）
export function warnMissingSecrets(): void {
  const checks: [string, string][] = [
    ['GEMINI_API_KEY', env.GEMINI_API_KEY],
    ['STRIPE_SECRET_KEY', env.STRIPE_SECRET_KEY],
    ['STRIPE_WEBHOOK_SECRET', env.STRIPE_WEBHOOK_SECRET],
    ['GOOGLE_CLIENT_ID', env.GOOGLE_CLIENT_ID],
    ['GOOGLE_CLIENT_SECRET', env.GOOGLE_CLIENT_SECRET],
    ['GOOGLE_REDIRECT_URI', env.GOOGLE_REDIRECT_URI],
    ['DISCORD_ERROR_WEBHOOK_URL', env.DISCORD_ERROR_WEBHOOK_URL],
  ];
  const missing = checks.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.warn(`[warn] 未設定の環境変数: ${missing.join(', ')} （該当機能は動作しません）`);
  }
  if (env.LICENSE_SECRET.startsWith('dev-') || env.TOKEN_ENCRYPTION_SECRET.startsWith('dev-')) {
    console.warn('[warn] LICENSE_SECRET / TOKEN_ENCRYPTION_SECRET が開発用のままです。本番では必ず変更してください。');
  }
}

export { req };
