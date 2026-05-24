# Календарь мероприятий (VK Mini App)

Карточки мероприятий хранятся в [JsonBox.ru](https://jsonbox.ru) в формате JSON. Создавать и редактировать карточки могут пользователи с ролью в сообществе VK: **создатель (владелец)**, **администратор**, **редактор**, **модератор**.

## Быстрый старт

### 1. Регистрация на JsonBox

**Самый простой способ:** откройте в браузере файл `jsonbox-register.html` из этого проекта, введите почту и нажмите «Зарегистрироваться». Внизу появится готовый блок для `config.js`.

Локально:

```bash
npx serve .
```

Затем откройте `http://localhost:3000/jsonbox-register.html`

**Или через PowerShell** (замените почту на свою):

```powershell
$body = '{"email":"ваш@email.ru"}'
Invoke-RestMethod -Uri "https://jsonbox.ru/api.php?action=register" -Method POST -ContentType "application/json" -Body $body
```

В ответе будут:

- `api_key` — полный ключ (для сохранения)
- `api_key_read_only` — ключ `ro_...` (для чтения списка)

### 2. Первичная загрузка данных (опционально)

Сохраните стартовый `events.json` в JsonBox:

```bash
curl -X POST "https://jsonbox.ru/api.php?action=store" \
  -H "Content-Type: application/json" \
  -d "{\"api_key\":\"ВАШ_ПОЛНЫЙ_КЛЮЧ\",\"data\":{\"events\":[]}}"
```

Либо откройте приложение под руководителем — при пустом хранилище подтянется `events.json` из репозитория.

### 3. Настройка `config.js`

```bash
copy config.example.js config.js
```

Заполните в `config.js`:

| Поле | Описание |
|------|----------|
| `JSONBOX_API_KEY` | Полный ключ |
| `JSONBOX_API_KEY_READONLY` | Ключ `ro_...` |
| `VK_APP_ID` | ID mini app |
| `VK_GROUP_ID` | ID сообщества |
| `DEV_ADMIN_PASSWORD` | Пароль для теста в браузере вне VK (необязательно) |

### 4. Локальный запуск

```bash
npx serve .
```

Откройте `http://localhost:3000` (или порт, который покажет `serve`).

### 5. VK Mini App

В настройках приложения VK укажите URL деплоя (например, Vercel).

Открывайте mini app **из сообщества**, чтобы определялся `vk_group_id` и права на редактирование (владелец, администратор, редактор или модератор).

## Структура карточки в JsonBox

```json
{
  "events": [
    {
      "id": "ev-1",
      "title": "Название",
      "date": "2026-05-24",
      "time": "18:00",
      "timeEnd": "20:00",
      "location": "ЮРГПУ(НПИ)",
      "level": "региональный",
      "enrollment": "open",
      "functionality": "Текст функционала",
      "conditions": "Условия участия",
      "description": "Краткое описание",
      "buttonLabel": "В чат",
      "buttonUrl": "https://vk.me/..."
    }
  ]
}
```

Уровень: `вузовский` | `городской` | `региональный` | `межрегиональный` | `всероссийский` | `международный`.

## Файлы

| Файл | Назначение |
|------|------------|
| `js/jsonbox.js` | Загрузка и сохранение в JsonBox |
| `js/vk-auth.js` | VK Bridge и проверка роли руководства (creator / administrator / editor / moderator) |
| `script.js` | UI и логика карточек |
| `config.js` | Секреты (не коммитить) |
| `events.json` | Пример / резерв для первого запуска |

## Безопасность

Полный `api_key` попадает в сборку фронтенда — любой может найти его в коде. Для небольшого сообщества это обычно приемлемо; UI редактирования виден только руководителю VK. Не публикуйте `config.js` с ключами в открытом репозитории.
