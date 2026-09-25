import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft, Phone, MessageSquare } from 'lucide-react';
import { useCrm } from '@/lib/store';
import { formatPhoneDisplay, telHref, smsHref } from '@/lib/phone';
import { formatVisitWhen } from '@/lib/format';
import { useBooking } from '@/components/BookingContext';

export function ClientDetailPage() {
  const params = useParams({ strict: false }) as { id?: string };
  const id = params.id || '';
  const client = useCrm((s) => s.clients.find((c) => c.id === id));
  const appointments = useCrm((s) => s.appointments.filter((a) => a.clientId === id));
  const services = useCrm((s) => s.services);
  const { open } = useBooking();

  if (!client) {
    return (
      <div className="p-6 text-center text-gray-500">
        Клиент не найден
        <Link to="/clients" className="block text-accent mt-2">
          Назад
        </Link>
      </div>
    );
  }

  const hist = [...appointments].sort((a, b) => +new Date(b.start) - +new Date(a.start));
  const done = hist.filter((a) => a.status !== 'cancelled');
  const total = done.reduce((sum, a) => {
    return (
      sum +
      a.serviceIds.reduce((s, sid) => s + (services.find((x) => x.id === sid)?.price || 0), 0)
    );
  }, 0);

  return (
    <div className="flex-1 overflow-y-auto bg-journal">
      <div className="bg-white border-b border-gray-100 px-3 py-2 flex items-center gap-2">
        <Link to="/clients" className="h-10 w-10 flex items-center justify-center rounded-full hover:bg-gray-50">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="font-semibold">Карточка клиента</div>
      </div>
      <div className="p-4 space-y-3">
        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <div className="text-xl font-bold">{client.name}</div>
          <div className="text-gray-500">{formatPhoneDisplay(client.phone)}</div>
          {client.notes && <p className="text-sm text-gray-600 mt-2">{client.notes}</p>}
          <div className="flex gap-2 mt-3 text-xs text-gray-500">
            <span>{done.length} визитов</span>
            <span>·</span>
            <span>{total.toLocaleString('ru-RU')} ₽</span>
          </div>
          <div className="flex gap-2 mt-3">
            <a href={telHref(client.phone)} className="flex-1 touch-btn rounded-xl bg-accent text-white flex items-center justify-center gap-2 text-sm font-medium">
              <Phone className="h-4 w-4" /> Звонок
            </a>
            <a href={smsHref(client.phone)} className="flex-1 touch-btn rounded-xl border border-gray-200 flex items-center justify-center gap-2 text-sm font-medium">
              <MessageSquare className="h-4 w-4" /> SMS
            </a>
          </div>
          <button
            type="button"
            className="w-full touch-btn mt-2 rounded-xl border border-gray-200 text-sm font-medium"
            onClick={() => open({ kind: 'new', start: new Date() })}
          >
            Записать
          </button>
        </div>

        <div className="bg-white rounded-2xl p-4 shadow-sm">
          <h3 className="font-semibold mb-2">История</h3>
          {!hist.length && <p className="text-sm text-gray-400">Пусто</p>}
          <ul className="space-y-2">
            {hist.map((a) => (
              <li key={a.id} className="text-sm border-b border-gray-50 pb-2">
                <div className="font-medium first-letter:uppercase">{formatVisitWhen(a.start).full}</div>
                <div className="text-gray-500">
                  {a.serviceIds.map((sid) => services.find((s) => s.id === sid)?.name).filter(Boolean).join(', ')}
                  {a.status === 'cancelled' ? ' · отмена' : ''}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
