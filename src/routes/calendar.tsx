import { addDays, format, startOfWeek } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useMemo, useState } from 'react';
import { useCrm } from '@/lib/store';
import { Link } from '@tanstack/react-router';

export function CalendarPage() {
  const [anchor, setAnchor] = useState(new Date());
  const appointments = useCrm((s) => s.appointments);
  const clients = useCrm((s) => s.clients);
  const services = useCrm((s) => s.services);

  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-2">
        <h1 className="text-xl font-semibold">Неделя</h1>
        <button type="button" className="touch-btn rounded-md border px-3 text-sm" onClick={() => setAnchor(addDays(anchor, -7))}>←</button>
        <button type="button" className="touch-btn rounded-md border px-3 text-sm" onClick={() => setAnchor(new Date())}>Сегодня</button>
        <button type="button" className="touch-btn rounded-md border px-3 text-sm" onClick={() => setAnchor(addDays(anchor, 7))}>→</button>
      </div>
      <div className="grid gap-2 md:grid-cols-7">
        {days.map((d) => {
          const key = format(d, 'yyyy-MM-dd');
          const list = appointments.filter(
            (a) => a.status !== 'cancelled' && format(new Date(a.start), 'yyyy-MM-dd') === key,
          );
          return (
            <div key={key} className="min-h-40 rounded-xl border bg-white p-2">
              <Link to="/" className="mb-2 block text-sm font-semibold capitalize hover:text-[#ff7900]">
                {format(d, 'EEE d', { locale: ru })}
              </Link>
              <div className="space-y-1">
                {list.map((a) => {
                  const c = clients.find((x) => x.id === a.clientId);
                  const s = services.find((x) => a.serviceIds.includes(x.id));
                  return (
                    <div key={a.id} className="rounded bg-slate-100 px-2 py-1 text-xs">
                      {format(new Date(a.start), 'HH:mm')} {c?.name} · {s?.name}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
