import type { CrmState } from './types';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';

/** Notify master Telegram about a new visit (fire-and-forget) with owner action buttons. */
export function notifyOwnerNewVisit(
  state: CrmState,
  opts: {
    appointmentId: string;
    clientName: string;
    clientPhone: string;
    serviceNames: string;
    startISO: string;
    durationMin: number;
    source: 'online' | 'journal' | 'telegram';
  },
) {
  const { telegramToken, telegramOwnerChatId } = state.settings;
  // Token may be absent in this browser (it is never sent from the server) — the server uses its stored one.
  if (!telegramOwnerChatId) return;

  let when = opts.startISO;
  try {
    when = format(parseISO(opts.startISO), "EEEE, d MMMM 'в' HH:mm", { locale: ru });
  } catch {
    /* keep raw */
  }

  const title =
    opts.source === 'online'
      ? 'Новая онлайн-запись'
      : opts.source === 'telegram'
        ? 'Новая запись'
        : 'Новая запись в журнале';
  let text = `${title}\n\n${opts.clientName}\n${opts.clientPhone}\n${opts.serviceNames}\n${when}\n${opts.durationMin} мин`;
  const bot = (state.settings.telegramBotUsername || '').replace(/^@/, '');
  if (opts.source !== 'telegram' && bot && /^[A-Za-z0-9_-]{1,60}$/.test(String(opts.appointmentId))) {
    text +=
      `\n\nСсылка для клиента (откроет бота с его записью и напоминаниями):\n` +
      `https://t.me/${bot}?start=v_${opts.appointmentId}`;
  }
  const sid = String(opts.appointmentId).slice(-10);
  const reply_markup = {
    inline_keyboard: [
      [
        { text: '❌ Отменить', callback_data: `ow:cl:${sid}` },
        { text: '🔁 Перенести', callback_data: `ow:mv:${sid}` },
      ],
      [{ text: '✉️ Написать клиенту', callback_data: `ow:msg:${sid}` }],
    ],
  };

  void fetch('/api/telegram/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: telegramToken || '',
      chatId: telegramOwnerChatId,
      text,
      reply_markup,
    }),
  }).catch(() => {});
}
