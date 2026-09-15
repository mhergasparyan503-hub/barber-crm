import { sendMessage, answerCallback, getUpdates } from './telegram-api';

type Crm = {
  clients: any[];
  services: any[];
  staff: any[];
  appointments: any[];
  windows: any[];
  schedules: any[];
  exceptions: any[];
  settings: any;
};

const seen = new Set<number>();

export type InboxResult = {
  offset: number;
  patch: Partial<Crm>;
  replies: number;
};

function cloneCrm(crm: Crm): Crm {
  return {
    clients: [...(crm.clients || [])],
    appointments: [...(crm.appointments || [])],
    services: [...(crm.services || [])],
    staff: [...(crm.staff || [])],
    windows: [...(crm.windows || [])],
    schedules: [...(crm.schedules || [])],
    exceptions: [...(crm.exceptions || [])],
    settings: { ...(crm.settings || {}) },
  };
}

/** Process a single Telegram update (webhook). Mutates a CRM clone and returns it as patch. */
export async function handleUpdate(crm: Crm, update: any): Promise<InboxResult> {
  const token = crm.settings?.telegramToken;
  if (!token) return { offset: crm.settings?.telegramOffset || 0, patch: {}, replies: 0 };

  let offset = Math.max(crm.settings?.telegramOffset || 0, (update?.update_id || 0) + 1);
  const patch = cloneCrm(crm);
  let replies = 0;

  if (update?.update_id != null) {
    if (seen.has(update.update_id)) {
      (patch.settings as any).telegramOffset = offset;
      return { offset, patch, replies: 0 };
    }
    seen.add(update.update_id);
  }

  try {
    if (update?.message) {
      await handleMessage(token, update.message, patch);
      replies++;
    } else if (update?.callback_query) {
      await handleCallback(token, update.callback_query, patch);
      replies++;
    }
  } catch (e) {
    console.error('tg handle', e);
  }

  (patch.settings as any).telegramOffset = offset;
  return { offset, patch, replies };
}

export async function pollAndHandle(crm: Crm): Promise<InboxResult> {
  const token = crm.settings?.telegramToken;
  if (!token) return { offset: crm.settings?.telegramOffset || 0, patch: {}, replies: 0 };

  let offset = crm.settings?.telegramOffset || 0;
  // Calling getUpdates cancels an active Telegram webhook. Production uses /api/telegram.
  if (process.env.TELEGRAM_ALLOW_POLL !== '1') {
    return { offset, patch: {}, replies: 0 };
  }
  const res = await getUpdates(token, offset > 0 ? offset : 0, 2);
  if (!res.ok) {
    return { offset, patch: {}, replies: 0 };
  }

  const patch = cloneCrm(crm);
  let replies = 0;

  for (const u of res.result || []) {
    if (seen.has(u.update_id)) {
      offset = Math.max(offset, u.update_id + 1);
      continue;
    }
    seen.add(u.update_id);
    offset = Math.max(offset, u.update_id + 1);

    try {
      if (u.message) {
        await handleMessage(token, u.message, patch);
        replies++;
      } else if (u.callback_query) {
        await handleCallback(token, u.callback_query, patch);
        replies++;
      }
    } catch (e) {
      console.error('tg handle', e);
    }
  }

  (patch.settings as any).telegramOffset = offset;
  return { offset, patch, replies };
}

async function handleMessage(token: string, msg: any, crm: Crm) {
  const chatId = String(msg.chat.id);
  const text = (msg.text || '').trim();

  if (text.startsWith('/start')) {
    const rawPayload = text.split(/\s+/)[1] || '';
    const payload = rawPayload.trim().toLowerCase();
    const ownerId = String(crm.settings.telegramOwnerChatId || '');
    if (payload === 'owner') {
      crm.settings.telegramOwnerChatId = chatId;
      await sendMessage(
        token,
        chatId,
        'Рабочий чат мастера подключён.\nВы будете получать уведомления о новых записях.',
      );
      return;
    }
    if (ownerId && chatId === ownerId && !rawPayload.startsWith('c_') && !rawPayload.startsWith('v_')) {
      await sendMessage(token, chatId, 'Вы в рабочем чате мастера. Уведомления о записях приходят сюда.');
      return;
    }
    // plain /start or client deep-links — never steal owner; booking menus soon
    const studio = crm.settings.studioName || 'Барбершоп';
    await sendMessage(
      token,
      chatId,
      `Добро пожаловать в ${studio}!\n\nЗапись через бота — скоро. Пока запишитесь по ссылке на сайте.`,
    );
    return;
  }

  if (chatId === String(crm.settings.telegramOwnerChatId)) {
    await sendMessage(token, chatId, 'Рабочий чат мастера. Уведомления о новых записях приходят автоматически.');
    return;
  }

  await sendMessage(token, chatId, 'Запись через бота — скоро. Напишите мастеру или запишитесь по ссылке.');
}

async function handleCallback(token: string, cq: any, _crm: Crm) {
  await answerCallback(token, cq.id, 'Скоро');
  const chatId = String(cq.message?.chat?.id);
  if (chatId) {
    await sendMessage(token, chatId, 'Эта функция скоро будет доступна.');
  }
}
