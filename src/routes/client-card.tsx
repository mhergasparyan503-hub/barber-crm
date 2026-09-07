import { Link, useParams } from '@tanstack/react-router';
import { useCrm } from '@/lib/store';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { toast } from 'sonner';

export function ClientCardPage() {
  const { clientId } = useParams({ strict: false }) as { clientId: string };
  const client = useCrm((s) => s.clients.find((c) => c.id === clientId));
  const appointments = useCrm((s) => s.appointments.filter((a) => a.clientId === clientId));
  const services = useCrm((s) => s.services);
  const settings = useCrm((s) => s.settings);
  const updateClient = useCrm((s) => s.updateClient);
  const deleteClient = useCrm((s) => s.deleteClient);

  if (!client) {
    return (
      <div className="p-4">
        <Link to="/clients">← Клиенты</Link>
        <p className="mt-4">Клиент не найден</p>
      </div>
    );
  }

  const done = appointments.filter((a) => a.status !== 'cancelled');
  const sum = done.reduce((acc, a) => {
    return acc + a.serviceIds.reduce((s, id) => s + (services.find((x) => x.id === id)?.price || 0), 0);
  }, 0);
  const last = [...done].sort((a, b) => +new Date(b.start) - +new Date(a.start))[0];
  const hours = done.map((a) => new Date(a.start).getHours());
  const favHour = hours.length
    ? hours.sort((a, b) => hours.filter((h) => h === b).length - hours.filter((h) => h === a).length)[0]
    : null;
  const daysSince = last ? Math.floor((Date.now() - +new Date(last.start)) / 86400000) : null;

  const botLink = settings.telegramBotUsername
    ? `https://t.me/${settings.telegramBotUsername}?start=c_${client.id}`
    : '';

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <Link to="/clients" className="text-sm text-[#ff7900]">← Клиенты</Link>
      <div className="rounded-xl border bg-white p-4">
        <input
          className="mb-2 w-full text-xl font-semibold outline-none"
          value={client.name}
          onChange={(e) => updateClient(client.id, { name: e.target.value })}
        />
        <input
          className="mb-2 w-full rounded-md border px-3 py-2 text-sm"
          value={client.phone}
          placeholder="Телефон"
          onChange={(e) => updateClient(client.id, { phone: e.target.value })}
        />
        <textarea
          className="w-full rounded-md border px-3 py-2 text-sm"
          rows={3}
          placeholder="Заметки"
          value={client.notes || ''}
          onChange={(e) => updateClient(client.id, { notes: e.target.value })}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {botLink && (
            <a href={botLink} target="_blank" rel="noreferrer" className="touch-btn rounded-md border px-3 text-sm">
              Telegram deep-link
            </a>
          )}
          <button
            type="button"
            className="touch-btn rounded-md border border-red-300 px-3 text-sm text-red-600"
            onClick={() => {
              deleteClient(client.id);
              toast.success('Клиент удалён');
              history.back();
            }}
          >
            Удалить клиента
          </button>
        </div>
      </div>

      <div className="rounded-xl border bg-white p-4 text-sm">
        <div className="mb-2 font-semibold">Подсказки</div>
        <ul className="list-disc space-y-1 pl-5 text-slate-600">
          <li>Визитов: {done.length}, сумма ≈ {sum.toLocaleString('ru-RU')} ₽</li>
          {favHour != null && <li>Любимый час: {String(favHour).padStart(2, '0')}:00</li>}
          {last && (
            <li>
              Последняя услуга:{' '}
              {services.find((s) => last.serviceIds.includes(s.id))?.name || '—'} (
              {format(new Date(last.start), 'd MMM yyyy', { locale: ru })})
            </li>
          )}
          {daysSince != null && daysSince > 40 && <li className="text-[#ff7900]">Пора пригласить — давно не был</li>}
        </ul>
      </div>

      <div className="rounded-xl border bg-white p-4">
        <div className="mb-2 font-semibold">История</div>
        {appointments.length === 0 ? (
          <div className="text-sm text-slate-500">Пока пусто</div>
        ) : (
          <div className="space-y-2">
            {[...appointments]
              .sort((a, b) => +new Date(b.start) - +new Date(a.start))
              .map((a) => (
                <div key={a.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm">
                  {format(new Date(a.start), 'd MMM yyyy HH:mm', { locale: ru })} ·{' '}
                  {a.serviceIds.map((id) => services.find((s) => s.id === id)?.name).filter(Boolean).join(', ')} ·{' '}
                  {a.status}
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
