import type { Service } from './types';

/** «1 500 ₽»; empty for missing/zero/invalid price. */
export function rub(price: unknown): string {
  const n = Number(price);
  return Number.isFinite(n) && n > 0 ? `${Math.round(n).toLocaleString('ru-RU')} ₽` : '';
}

/** Resolve a stored service reference (id, or an old record that kept the name). */
export function findService(services: Service[], ref: string): Service | undefined {
  const byId = services.find((s) => s.id === ref);
  if (byId) return byId;
  const k = String(ref || '').trim().toLowerCase();
  return k ? services.find((s) => String(s.name || '').trim().toLowerCase() === k) : undefined;
}

/** Per-service prices + total for a visit (services without a price count as 0 and show no amount). */
export function visitPrice(services: Service[], serviceIds: string[] | undefined) {
  const items = (serviceIds || [])
    .map((ref) => findService(services, ref))
    .filter((s): s is Service => !!s)
    .map((s) => ({ id: s.id, name: s.name, price: rub(s.price) ? Math.round(Number(s.price)) : 0 }));
  return { items, total: items.reduce((sum, x) => sum + x.price, 0) };
}
