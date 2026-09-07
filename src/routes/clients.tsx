import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useCrm } from '@/lib/store';
import { uid } from '@/lib/seed';
import { toast } from 'sonner';

export function ClientsPage() {
  const clients = useCrm((s) => s.clients);
  const appointments = useCrm((s) => s.appointments);
  const addClient = useCrm((s) => s.addClient);
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(qq) || c.phone.includes(qq) || (c.tags || []).some((t) => t.includes(qq)));
  }, [clients, q]);

  return (
    <div className="p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Клиенты</h1>
        <input className="rounded-md border px-3 py-2 text-sm" placeholder="Поиск" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="mb-4 flex flex-wrap gap-2 rounded-xl border bg-white p-3">
        <input className="rounded-md border px-3 py-2 text-sm" placeholder="Имя" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="rounded-md border px-3 py-2 text-sm" placeholder="Телефон" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <button
          type="button"
          className="touch-btn rounded-md bg-[#ff7900] px-3 font-semibold text-white"
          onClick={() => {
            if (!name.trim()) return toast.error('Укажите имя');
            addClient({ name: name.trim(), phone: phone.trim() });
            setName('');
            setPhone('');
            toast.success('Клиент добавлен');
          }}
        >
          Добавить
        </button>
      </div>
      {list.length === 0 ? (
        <div className="rounded-xl border bg-white p-8 text-center text-slate-500">Пока нет клиентов</div>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-white">
          {list.map((c) => {
            const visits = appointments.filter((a) => a.clientId === c.id && a.status !== 'cancelled');
            return (
              <Link key={c.id} to="/clients/$clientId" params={{ clientId: c.id }} className="flex items-center justify-between border-b px-4 py-3 hover:bg-slate-50">
                <div>
                  <div className="font-medium">{c.name}</div>
                  <div className="text-sm text-slate-500">{c.phone || 'без телефона'}</div>
                </div>
                <div className="text-xs text-slate-400">{visits.length} виз.</div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
