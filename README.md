# Барбер CRM

Личная CRM для одного барбера: журнал как YCLIENTS, клиенты, услуги, график, онлайн-запись `/book`, Telegram-бот.

## Стек

Vite + React 19 + TypeScript + TanStack Router + Tailwind v4 + Zustand + PGLite + Hono (серверные API для Telegram).

В ТЗ указан TanStack Start; здесь ближайший рабочий аналог: Vite + TanStack Router и серверные эндпоинты вместо createServerFn.

## Запуск

```bash
cd /workspace/barber-crm
bun install
bun run dev
```

Превью: http://0.0.0.0:8080

## Данные

- localStorage ключ `barber-crm-v1`
- PGLite: `data/pglite` — `crm_snapshot` JSONB + `telegram_links`
- Старт: 1 мастер «Барбер», соло, пн–сб 10:00–21:00, услуги барбершопа, 0 клиентов, dataVersion 5

## Telegram

1. Токен в Настройки → Проверить бота (offset не сбрасывается)
2. Подключить мой Telegram — `?start=owner`
3. Long-poll пока открыт журнал

## Страницы

`/`, `/calendar`, `/schedule`, `/clients`, `/clients/$clientId`, `/services`, `/settings`, `/book`, `/api/telegram`
