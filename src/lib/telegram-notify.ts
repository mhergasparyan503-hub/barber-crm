import type { CrmState } from './types';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

/** Notify master Telegram about a new visit (fire-and-forget). */
export function notifyOwnerNewVisit(
  state: CrmState,
  opts: {
    appointmentId: string;
    clientName: string;
    clientPhone: string;
    serviceNames: string;
    startISO: string;
    durationMin: number;
    source: 'online' | 'journal';
  },
) {
  const { telegramToken, telegramOwnerChatId } = state.settings;
  if (!telegramToken || !telegramOwnerChatId) return;

  let when = opts.startISO;
  try {
    when = format(parseISO(opts.startISO), "EEEE, d MMMM 'в' HH:mm", { locale: ru });
  } catch {
    /* keep raw */
  }

  const title = opts.source === 'online' ? 'Новая онлайн-запись' : 'Новая запись в журнале';
  const text = `${title}\n\n${opts.clientName}\n${opts.clientPhone}\n${opts.serviceNames}\n${when}\n${opts.durationMin} мин`;

  void fetch('/api/telegram/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: telegramToken,
      chatId: telegramOwnerChatId,
      text,
    }),
  }).catch(() => {});
}
