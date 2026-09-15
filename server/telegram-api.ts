const API = 'https://api.telegram.org';

export async function tg(token: string, method: string, body?: Record<string, unknown>) {
  const r = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

export async function getMe(token: string) {
  return tg(token, 'getMe');
}

export async function deleteWebhook(token: string) {
  return tg(token, 'deleteWebhook', { drop_pending_updates: false });
}

export async function setWebhook(token: string, url: string) {
  return tg(token, 'setWebhook', {
    url,
    drop_pending_updates: false,
    allowed_updates: ['message', 'callback_query'],
  });
}

export async function getWebhookInfo(token: string) {
  return tg(token, 'getWebhookInfo');
}

/** Never reset offset to 0 on bot check — caller passes stored offset */
export async function getUpdates(token: string, offset: number, timeout = 2) {
  return tg(token, 'getUpdates', {
    offset: offset || undefined,
    timeout,
    allowed_updates: ['message', 'callback_query'],
  });
}

export async function sendMessage(
  token: string,
  chatId: string | number,
  text: string,
  reply_markup?: unknown,
) {
  const res = await tg(token, 'sendMessage', {
    chat_id: chatId,
    text,
    reply_markup,
  });
  if (res && res.ok === false) {
    console.error('tg sendMessage fail', res.error_code, res.description);
  }
  return res;
}

export async function answerCallback(token: string, id: string, text?: string) {
  return tg(token, 'answerCallbackQuery', { callback_query_id: id, text });
}
