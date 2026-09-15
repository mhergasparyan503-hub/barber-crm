import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Phone, CalendarPlus, Trash2, MessageSquare } from 'lucide-react';
import { useCrm } from '@/lib/store';
import { formatPhoneDisplay, telHref, smsHref, phoneLast10 } from '@/lib/phone';
import { useBooking } from '@/components/BookingContext';
import { toast } from 'sonner';

export function ClientsPage() {
  const clients = useCrm((s) => s.clients);
  const appointments = useCrm((s) => s.appointments);
  const settings = useCrm((s) => s.settings);
  const deleteClient = useCrm((s) => s.deleteClient);
  const [q, setQ] = useState('');
  const [broadcast, setBroadcast] = useState(false);
  const [queue, setQueue] = useState<string[]>([]);
  const { open } = useBooking();

  const list = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return clients
      .filter((c) => !qq || c.name.toLowerCase().includes(qq) || phoneLast10(c.phone).includes(qq.replace(/\D/g, '')))
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [clients, q]);

  function startBroadcast() {
    const phones = clients.map((c) => c.phone).filter((p) => phoneLast10(p).length >= 10);
    if (!phones.length) {
      toast.message('Нет клиентов с телефоном');
      return;
    }
    setQueue(phones);
    setBroadcast(true);
  }

  function sendNext() {
    if (!queue.length) {
      setBroadcast(false);
      toast.success('Очередь SMS завершена');
      return;
    }
    const [next, ...rest] = queue;
    const body = `Здравствуйте! Это ${settings.studioName}. Ждём вас на стрижку.`;
    window.location.href = smsHref(next, body);
    setQueue(rest);
  }

  return (
    <div className="flex-1 overflow-y-auto bg-journal">
      <div className="p-3 sticky top-0 bg-journal z-10 space-y-2">
        <input
          className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm"
          placeholder="Поиск имени или телефона"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="button"
          onClick={broadcast ? sendNext : startBroadcast}
          className="w-full touch-btn rounded-xl bg-white border border-gray-200 text-sm font-medium"
        >
          {broadcast
            ? queue.length
              ? `SMS следующее (${queue.length} осталось)`
              : 'Готово'
            : 'Рассылка SMS (по одному)'}
        </button>
        {broadcast && (
          <p className="text-[11px] text-gray-500">
            Браузер не отправляет SMS сам — откроется приложение сообщений. Нажмите кнопку для каждого клиента.
          </p>
        )}
      </div>
      <div className="px-3 pb-4 space-y-2">
        {!list.length && <p className="text-center text-sm text-gray-400 py-8">Клиентов пока нет</p>}
        {list.map((c) => {
          const visits = appointments.filter((a) => a.clientId === c.id && a.status !== 'cancelled').length;
          return (
            <div key={c.id} className="bg-white rounded-2xl p-3 shadow-sm border border-gray-100">
              <Link to="/clients/$id" params={{ id: c.id }} className="block">
                <div className="font-semibold text-gray-900">{c.name}</div>
                <div className="text-sm text-gray-500">{formatPhoneDisplay(c.phone)}</div>
                <div className="text-xs text-gray-400 mt-0.5">{visits} визит(ов)</div>
              </Link>
              <div className="flex gap-2 mt-2">
                <a href={telHref(c.phone)} className="flex-1 touch-btn rounded-xl bg-gray-50 flex items-center justify-center gap-1 text-xs font-medium">
                  <Phone className="h-3.5 w-3.5" /> Звонок
                </a>
                <button
                  type="button"
                  className="flex-1 touch-btn rounded-xl bg-gray-50 flex items-center justify-center gap-1 text-xs font-medium"
                  onClick={() => open({ kind: 'new', start: new Date() })}
                >
                  <CalendarPlus className="h-3.5 w-3.5" /> Записать
                </button>
                <button
                  type="button"
                  className="h-11 w-11 rounded-xl bg-red-50 text-red-600 flex items-center justify-center"
                  onClick={() => {
                    if (confirm(`Удалить ${c.name}?`)) deleteClient(c.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
