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

/** Limits for one visit (client-side booking and server validation). */
export const MAX_QTY_PER_SERVICE = 5;
export const MAX_QTY_TOTAL = 10;

export type VisitLine = {
  id: string;
  name: string;
  /** unit price (0 = not set) */
  price: number;
  durationMin: number;
  qty: number;
  /** price × qty */
  sum: number;
};

/**
 * Services of a visit with quantities.
 * Quantity = `qty[id]` (optional field on the appointment, default 1);
 * old rows with the same id repeated in `serviceIds` count as that many.
 */
export function visitLines(
  services: Service[],
  serviceIds: string[] | undefined,
  qty?: Record<string, number> | null,
): VisitLine[] {
  const order: string[] = [];
  const count = new Map<string, number>();
  for (const ref of serviceIds || []) {
    const svc = findService(services, ref);
    if (!svc) continue;
    if (!count.has(svc.id)) order.push(svc.id);
    count.set(svc.id, (count.get(svc.id) || 0) + 1);
  }
  return order.map((id) => {
    const svc = services.find((x) => x.id === id) as Service;
    const q = Number(qty?.[id]);
    const n = Number.isFinite(q) && q >= 1 ? Math.min(Math.round(q), 99) : count.get(id) || 1;
    const price = rub(svc.price) ? Math.round(Number(svc.price)) : 0;
    const dur = Number(svc.durationMin);
    return { id, name: String(svc.name || '').trim(), price, durationMin: Number.isFinite(dur) && dur > 0 ? dur : 0, qty: n, sum: price * n };
  });
}

/** «Мужская стрижка ×2, Борода» */
export function linesLabel(lines: { name: string; qty: number }[]): string {
  return lines.map((l) => (l.qty > 1 ? `${l.name} ×${l.qty}` : l.name)).join(', ');
}

/** Per-service prices + total for a visit (services without a price count as 0 and show no amount). */
export function visitPrice(
  services: Service[],
  serviceIds: string[] | undefined,
  qty?: Record<string, number> | null,
) {
  const items = visitLines(services, serviceIds, qty);
  return {
    items,
    total: items.reduce((sum, x) => sum + x.sum, 0),
    durationMin: items.reduce((sum, x) => sum + x.durationMin * x.qty, 0),
    label: linesLabel(items),
  };
}

/** Server/client: turn a raw cart [{id, qty}] into valid lines (unknown ids dropped, qty clamped to limits). */
export function cartFromRaw(
  services: Service[],
  raw: unknown,
  allowed?: (s: Service) => boolean,
): { serviceIds: string[]; qty: Record<string, number> | undefined; totalQty: number; error?: string } {
  const serviceIds: string[] = [];
  const qty: Record<string, number> = {};
  let totalQty = 0;
  const list = Array.isArray(raw) ? raw : [];
  for (const it of list) {
    const id = String((it as any)?.id ?? (it as any)?.serviceId ?? '');
    const svc = services.find((s) => s.id === id && s.active !== false && (!allowed || allowed(s)));
    if (!svc) return { serviceIds: [], qty: undefined, totalQty: 0, error: 'Услуга не найдена' };
    const n = Math.round(Number((it as any)?.qty ?? 1));
    if (!Number.isFinite(n) || n < 1) return { serviceIds: [], qty: undefined, totalQty: 0, error: 'Неверное количество' };
    if (serviceIds.includes(svc.id)) return { serviceIds: [], qty: undefined, totalQty: 0, error: 'Услуга указана дважды' };
    if (n > MAX_QTY_PER_SERVICE) return { serviceIds: [], qty: undefined, totalQty: 0, error: `Не больше ${MAX_QTY_PER_SERVICE} штук одной услуги` };
    serviceIds.push(svc.id);
    if (n > 1) qty[svc.id] = n;
    totalQty += n;
  }
  if (!serviceIds.length) return { serviceIds: [], qty: undefined, totalQty: 0, error: 'Выберите услугу' };
  if (totalQty > MAX_QTY_TOTAL) return { serviceIds: [], qty: undefined, totalQty, error: `Не больше ${MAX_QTY_TOTAL} услуг в одной записи` };
  return { serviceIds, qty: Object.keys(qty).length ? qty : undefined, totalQty };
}
