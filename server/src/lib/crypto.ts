import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';

// ---- refresh token 暗号化（AES-256-GCM）----
// 鍵は TOKEN_ENCRYPTION_SECRET から SHA-256 で導出（32byte）
function encKey(): Buffer {
  return createHash('sha256').update(env.TOKEN_ENCRYPTION_SECRET).digest();
}

// 返り値: base64(iv(12) | tag(16) | ciphertext)
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ct = buf.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

// ---- ライセンスキー生成・ハッシュ ----
// 形式: PTC-XXXX-XXXX-XXXX-XXXX （紛らわしい文字を除いたCrockford系32文字）
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // I,O,0,1 を除外

export function generateLicenseKey(prefix = 'PTC'): string {
  const groups: string[] = [];
  for (let g = 0; g < 4; g++) {
    let s = '';
    const bytes = randomBytes(4);
    for (let i = 0; i < 4; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
    groups.push(s);
  }
  return `${prefix}-${groups.join('-')}`;
}

// 入力ゆらぎを吸収（大文字化・空白/全角ハイフン除去）
export function normalizeLicenseKey(key: string): string {
  return key
    .trim()
    .toUpperCase()
    .replace(/[‐－—–ー]/g, '-')
    .replace(/\s+/g, '');
}

// DBには平文を保存せず、HMAC-SHA256(LICENSE_SECRET, normalizedKey) を保存
export function hashLicenseKey(key: string): string {
  return createHmac('sha256', env.LICENSE_SECRET).update(normalizeLicenseKey(key)).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
