import { randomBytes, randomUUID } from 'node:crypto';

export function uuid(): string {
  return randomUUID();
}

// prefix付きID（例: license_xxxx, user_xxxx）
export function pid(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}
