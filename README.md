# Барбер CRM (mobile)

Личная CRM для одного барбера. Русский интерфейс. Телефонный UI.

## Стек

Vite + React + TypeScript + TanStack Router, Tailwind v4, Zustand (`barber-crm-v1`), date-fns (ru), PWA, Hono API (Telegram).

## Запуск

```bash
npm install
npm run dev
```

Превью: `http://0.0.0.0:8080`

Для публичного webhook задайте `PUBLIC_URL=https://your.domain` (и при необходимости `PUBLIC_PROTO=https`).  
Локальный long-poll (срывает webhook): `TELEGRAM_ALLOW_POLL=1`.

## Telegram

1. Создайте бота у @BotFather, скопируйте токен.
2. Настройки → Telegram → вставьте токен → **Проверить бота** (getMe + setWebhook в проде).
3. **Подключить мой Telegram** (`t.me/BOT?start=owner`) — только `start=owner` назначает владельца.
4. Новые записи с `/book` (и из журнала) присылают уведомление мастеру.

Клиент после /start (не owner): Записаться / Мои записи / Написать мастеру; при ближайшей записи — Перенести / Отменить / Напоминание / Новая запись. Запись: услуга → календарь → день → время → подтверждение → имя/телефон. Напоминания (пресеты + утро 09:00 MSK) через processDueReminders на сервере. Owner только ?start=owner. Webhook handleUpdate; getUpdates только при TELEGRAM_ALLOW_POLL=1.


## Приёмка

1. **PIN** — первый запуск: телефон + PIN 4–6 + подтверждение. Далее вход по телефону и PIN. Выход очищает сессию.
2. **Журнал** — неделя, слоты по графику, запись по тапу, long-press: звонок / SMS / перенос / открыть / отмена.
3. **Онлайн** — `/book` без PIN: услуга → день → слот → имя/телефон.
4. **Календарь** — месяц, точки занятых дней, тап → журнал.
5. **Call / SMS** — ссылки `tel:` и `sms:` (браузер сам SMS не шлёт).
6. **Telegram** — токен, проверка, owner connect, клиентская запись/перенос/отмена/напоминания, уведомления с кнопками.

## Данные

- Persist: `localStorage` ключ `barber-crm-v1`
- PIN: `barber-lock-v1`
- Сессия: `sessionStorage` `barber-session-v1`
- Серверный снимок (webhook): `data/crm-snapshot.json`
