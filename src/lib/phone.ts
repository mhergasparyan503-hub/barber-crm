/** Normalize RU phone: 10 digits / 8… / 7… → +7XXXXXXXXXX */
export function digitsOnly(v: string): string {
  return (v || '').replace(/\D/g, '');
}

export function normalizePhone(raw: string): string {
  let d = digitsOnly(raw);
  if (d.length === 11 && (d.startsWith('8') || d.startsWith('7'))) d = d.slice(1);
  if (d.length === 10) return '+7' + d;
  if (d.length === 11 && d.startsWith('7')) return '+' + d;
  if (raw.trim().startsWith('+') && d.length >= 10) return '+' + d;
  return d ? '+7' + d.slice(-10) : '';
}

export function phoneLast10(raw: string): string {
  return digitsOnly(normalizePhone(raw) || raw).slice(-10);
}

export function formatPhoneDisplay(raw: string): string {
  const n = normalizePhone(raw);
  const d = digitsOnly(n);
  if (d.length === 11 && d.startsWith('7')) {
    return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
  }
  return raw || '';
}

export function telHref(raw: string): string {
  const n = normalizePhone(raw);
  return n ? `tel:${n}` : '#';
}

export function smsHref(raw: string, body?: string): string {
  const n = normalizePhone(raw);
  if (!n) return '#';
  const q = body ? `?body=${encodeURIComponent(body)}` : '';
  return `sms:${n}${q}`;
}
