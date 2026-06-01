// JST(Asia/Tokyo, +09:00)固定のtime helper。サーバーのTZに依存させない。
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function nowIso(): string {
  // +09:00 付きISO文字列
  return toJstIso(new Date());
}

export function toJstIso(d: Date): string {
  const jst = new Date(d.getTime() + JST_OFFSET_MS);
  const s = jst.toISOString().replace('Z', '+09:00');
  return s;
}

// "YYYY-MM" （JST基準の利用月キー）
export function currentUsageMonth(d = new Date()): string {
  const jst = new Date(d.getTime() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, 7);
}

// JST基準で nヶ月後の +09:00 ISO（月末クランプ付き）
export function addMonthsJstIso(base: Date, months: number): string {
  const jst = new Date(base.getTime() + JST_OFFSET_MS);
  const y = jst.getUTCFullYear();
  const m = jst.getUTCMonth();
  const day = jst.getUTCDate();
  const target = new Date(Date.UTC(y, m + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  target.setUTCHours(jst.getUTCHours(), jst.getUTCMinutes(), jst.getUTCSeconds());
  // targetはJST壁時計をUTCに入れた値なので、-09:00してからISO化
  const real = new Date(target.getTime() - JST_OFFSET_MS);
  return toJstIso(real);
}

// 表示用 "YYYY-MM-DD HH:mm"（JST）
export function jstStamp(d = new Date()): string {
  const jst = new Date(d.getTime() + JST_OFFSET_MS);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())} ${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())}`;
}
