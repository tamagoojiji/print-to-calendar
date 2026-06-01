// ライセンスキーは端末内(localStorage)に保持。機密ではなく利用者本人の鍵。
const KEY = 'ptc_license_key';

export function getLicenseKey(): string {
  return localStorage.getItem(KEY) || '';
}

export function setLicenseKey(key: string): void {
  localStorage.setItem(KEY, key.trim());
}

export function clearLicenseKey(): void {
  localStorage.removeItem(KEY);
}
