# BitneX Backend (Bot + API)

## Что внутри

- Telegram-бот (telegraf)
- REST API (Express)
- Supabase (PostgreSQL)

## Быстрый старт на Railway

1. Создай новый проект на Railway
2. Выбери **Empty Project** → **Add Service** → **GitHub Repo** (или Deploy from local)
3. Добавь Environment Variables:

```
BOT_TOKEN=8848340098:AAGTJIcIXOmFwYmnMeXAYI1IlfMFPVB21nY
SUPABASE_URL=https://vhwentymwfjejthiawal.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
PORT=3000
MINI_APP_URL=   # пока можно оставить пустым
```

4. Railway сам определит Node.js и запустит `npm start`

## Локальный запуск

```bash
cp .env.example .env
# заполни .env
npm install
npm start
```

## Основные эндпоинты

- `GET  /` — проверка
- `GET  /api/user/:id` — данные пользователя + рефералы
- `POST /api/register` — регистрация/обновление
- `POST /api/claim` — собрать награды (с начислением 5% рефереру)
