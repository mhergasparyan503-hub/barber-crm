import { useMemo, useState, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useCrm } from '@/lib/store';
import { uid } from '@/lib/seed';
import { STATUS_LABEL } from '@/lib/format';
import type { Appointment, VisitStatus } from '@/lib/types';
import { toast } from 'sonner';

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Partial<Appointment> & { slotStart?: string; staffId?: string };
  mode?: 'create' | 'edit' | 'window';
  onRequestMove?: (id: string) => void;
};

export function BookingDialog({ open, onOpenChange, initial, mode = 'create', onRequestMove }: Props) {
  const clients = useCrm((s) => s.clients);
  const allServices = useCrm((s) => s.services);
  const allStaff = useCrm((s) => s.staff);
  const settings = useCrm((s) => s.settings);
  const appointments = useCrm((s) => s.appointments);
  const addClient = useCrm((s) => s.addClient);
  const upsertAppointment = useCrm((s) => s.upsertAppointment);
  const deleteAppointment = useCrm((s) => s.deleteAppointment);
  const addWindow = useCrm((s) => s.addWindow);

  const services = useMemo(() => allServices.filter((x) => x.active), [allServices]);
  const staff = useMemo(() => allStaff.filter((x) => x.active), [allStaff]);
  const existing = useMemo(
    () => appointments.find((a) => a.id === initial?.id),
    [appointments, initial?.id],
  );

  const [q, setQ] = useState('');
  const [clientId, setClientId] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [staffId, setStaffId] = useState('');
  const [startLocal, setStartLocal] = useState('');
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<VisitStatus>('waiting');
  const [confirmDel, setConfirmDel] = useState(false);
  const [winMinutes, setWinMinutes] = useState(30);

  useEffect(() => {
    if (!open) return;
    setConfirmDel(false);
    setQ('');
    setClientId(initial?.clientId || existing?.clientId || '');
    setNewName('');
    setNewPhone('');
    setServiceIds(
      initial?.serviceIds || existing?.serviceIds || (services[0] ? [services[0].id] : []),
    );
    setStaffId(initial?.staffId || existing?.staffId || staff[0]?.id || '');
    const iso = initial?.start || existing?.start || initial?.slotStart || new Date().toISOString();
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    setStartLocal(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
    setNote(initial?.note || existing?.note || '');
    setStatus(existing?.status || 'waiting');
  }, [open, initial, existing, services, staff]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    if (!qq) return clients.slice(0, 20);
    return clients
      .filter((c) => c.name.toLowerCase().includes(qq) || c.phone.includes(qq))
      .slice(0, 20);
  }, [clients, q]);

  const duration =
    serviceIds.reduce((sum, id) => {
      const s = services.find((x) => x.id === id);
      return sum + (s?.durationMin || 0);
    }, 0) || 30;

  const save = () => {
    if (mode === 'window') {
      addWindow({
        staffId,
        start: new Date(startLocal).toISOString(),
        durationMin: winMinutes,
        label: 'Пустое окно',
      });
      toast.success('Окно добавлено');
      onOpenChange(false);
      return;
    }
    let cid = clientId;
    if (!cid) {
      if (!newName.trim()) {
        toast.error('Укажите клиента');
        return;
      }
      cid = addClient({ name: newName.trim(), phone: newPhone.trim() });
    }
    const ap: Appointment = {
      id: existing?.id || uid('apt'),
      clientId: cid,
      staffId,
      serviceIds,
      start: new Date(startLocal).toISOString(),
      durationMin: duration,
      status,
      note: note || 'Форма, длина, борода, пожелания',
      source: existing?.source || 'journal',
      color: settings.visitColor,
      telegramChatId: existing?.telegramChatId,
      reminders: existing?.reminders,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };
    upsertAppointment(ap);
    toast.success('Сохранено');
    onOpenChange(false);
  };

  const client = clients.find((c) => c.id === (clientId || existing?.clientId));
  const bot = settings.telegramBotUsername;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 max-h-[92vh] overflow-auto rounded-t-2xl bg-white p-4 shadow-xl md:inset-auto md:left-1/2 md:top-1/2 md:w-[480px] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl">
          <Dialog.Title className="mb-3 text-lg font-semibold">
            {mode === 'window' ? 'Пустое окно' : existing ? 'Запись' : 'Записать клиента'}
          </Dialog.Title>

          {mode !== 'window' && (
            <>
              <label className="mb-1 block text-xs text-slate-500">Клиент</label>
              <input
                className="mb-2 w-full rounded-md border px-3 py-2 text-sm"
                placeholder="Поиск по имени или телефону"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <div className="mb-2 max-h-28 overflow-auto rounded-md border">
                {filtered.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-50 ${clientId === c.id ? 'bg-orange-50' : ''}`}
                    onClick={() => setClientId(c.id)}
                  >
                    {c.name} · {c.phone || 'без телефона'}
                  </button>
                ))}
              </div>
              {!clientId && (
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <input
                    className="rounded-md border px-3 py-2 text-sm"
                    placeholder="Новый клиент"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                  <input
                    className="rounded-md border px-3 py-2 text-sm"
                    placeholder="Телефон"
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                  />
                </div>
              )}

              <label className="mb-1 block text-xs text-slate-500">Услуги</label>
              <div className="mb-3 flex flex-wrap gap-2">
                {services.map((s) => {
                  const on = serviceIds.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      className={`rounded-full px-3 py-1 text-xs ${on ? 'bg-[#ff7900] text-white' : 'bg-slate-100'}`}
                      onClick={() =>
                        setServiceIds((prev) =>
                          on ? prev.filter((x) => x !== s.id) : [...prev, s.id],
                        )
                      }
                    >
                      {s.name} · {s.durationMin}м
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {!settings.soloMode && (
            <>
              <label className="mb-1 block text-xs text-slate-500">Мастер</label>
              <select
                className="mb-3 w-full rounded-md border px-3 py-2 text-sm"
                value={staffId}
                onChange={(e) => setStaffId(e.target.value)}
              >
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </>
          )}

          <label className="mb-1 block text-xs text-slate-500">Дата и время</label>
          <input
            type="datetime-local"
            className="mb-3 w-full rounded-md border px-3 py-2 text-sm"
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
          />

          {mode === 'window' ? (
            <>
              <label className="mb-1 block text-xs text-slate-500">Длительность (мин)</label>
              <input
                type="number"
                className="mb-3 w-full rounded-md border px-3 py-2 text-sm"
                value={winMinutes}
                onChange={(e) => setWinMinutes(Number(e.target.value) || 30)}
              />
            </>
          ) : (
            <>
              <label className="mb-1 block text-xs text-slate-500">Заметка</label>
              <textarea
                className="mb-3 w-full rounded-md border px-3 py-2 text-sm"
                rows={2}
                placeholder="Форма, длина, борода, пожелания"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <label className="mb-1 block text-xs text-slate-500">Статус</label>
              <select
                className="mb-3 w-full rounded-md border px-3 py-2 text-sm"
                value={status}
                onChange={(e) => setStatus(e.target.value as VisitStatus)}
              >
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="touch-btn flex-1 rounded-md bg-[#ff7900] px-3 font-semibold text-white"
              onClick={save}
            >
              Сохранить
            </button>
            {existing && (
              <button
                type="button"
                className="touch-btn rounded-md border px-3 text-sm"
                onClick={() => onRequestMove?.(existing.id)}
              >
                Перенести
              </button>
            )}
            {existing && client && (
              <a
                className="touch-btn rounded-md border px-3 text-sm"
                href={
                  client.telegramChatId
                    ? `https://t.me/${client.telegramUsername || ''}`
                    : bot
                      ? `https://t.me/${bot}?start=c_${client.id}`
                      : undefined
                }
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  if (!bot && !client.telegramChatId) {
                    e.preventDefault();
                    toast.error('Сначала подключите бота в настройках');
                  }
                }}
              >
                Написать в Telegram
              </a>
            )}
            {existing && !confirmDel && (
              <button
                type="button"
                className="touch-btn rounded-md border border-red-300 px-3 text-sm text-red-600"
                onClick={() => setConfirmDel(true)}
              >
                Удалить запись
              </button>
            )}
            {existing && confirmDel && (
              <button
                type="button"
                className="touch-btn rounded-md bg-red-600 px-3 text-sm text-white"
                onClick={() => {
                  deleteAppointment(existing.id);
                  toast.success('Удалено');
                  onOpenChange(false);
                }}
              >
                Подтвердить удаление
              </button>
            )}
            <Dialog.Close className="touch-btn rounded-md border px-3 text-sm">Закрыть</Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
