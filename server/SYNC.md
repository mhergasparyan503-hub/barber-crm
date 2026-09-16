# Server sync for barber.bars-ai.com

Mobile CRM server Telegram stack (this folder) is the source of truth for client bot flows.

Key files to deploy / keep in sync with `/workspace/barber-crm/server`:

- `msk.ts` — Europe/Moscow wall-clock helpers
- `telegram-api.ts` — Bot API wrappers (no getUpdates unless TELEGRAM_ALLOW_POLL=1 path)
- `telegram-inbox.ts` — handleUpdate, pollAndHandle, processDueReminders, full client/owner flows
- `dev.ts` — webhook `/api/telegram` + reminder ticker

Mobile model notes when porting:

- Appointment time field: `start` (not `startsAt`)
- Status booked → `waiting`; cancel → `cancelled`
- Source: `telegram` | `online` | `journal`
- Solo: no master picker; use first active staff

Production: set `PUBLIC_URL=https://barber.bars-ai.com` (or host header) so `/api/telegram/check` installs webhook.


Client menu uses Telegram **ReplyKeyboardMarkup** (persistent bottom keyboard, resize_keyboard). Inline keyboards remain for calendars/slots/services/confirm.

## Local preview poll (TELEGRAM_ALLOW_POLL=1)

Preview has no public URL, so Telegram cannot push webhooks here. For testing ReplyKeyboard /start before deploy:

1. Start with `TELEGRAM_ALLOW_POLL=1` (e.g. `TELEGRAM_ALLOW_POLL=1 npm run dev`).
2. On boot and on `/api/telegram/check`, server calls **deleteWebhook** so `getUpdates` works.
3. Server runs a **server-side** `pollAndHandle` interval (~3s) using `data/crm-snapshot.json` — CRM UI does not need to stay open.
4. Browser `TelegramBridge` also polls `/api/telegram/poll` as a backup while the app is open.

**Warning:** deleting the webhook silences production (`barber.bars-ai.com`) until the next deploy / webhook re-install. Do not leave ALLOW_POLL on in production.

## Owner ReplyKeyboard (telegramOwnerChatId)

When `chatId === settings.telegramOwnerChatId`, bot shows persistent owner menu (not client Записаться):

- **Записать** — same booking order as clients (service → date → time → confirm), then always asks client name + phone (walk-in / any client). Reuses CRM client by phone or creates new; does not require client Telegram. Reminder prompt after (delivery when client has chat).
- **Записи** — nearest upcoming appointments (MSK), page size 5; per row Написать / Отменить / Перенести (`ow:msg` / `ow:cl` / `ow:mv`); pagination `ow:apg:N` (◀️ Назад / ▶️ Следующие).
- Изменить график на день
- Перенести клиента
- Поиск по телефону
- Поделиться ссылкой
- Клиенты / Сегодня

Drafts live in `settings._draft[chatId]` (`ownerBook`, `ow_sched_*`, `ow_phone`, `ow_move_phone`). Schedule exceptions → `crm.exceptions` (`type: off|custom`). Client ReplyKeyboard unchanged.

