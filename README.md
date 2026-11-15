# Studio Hub

Один сайт для всех игр студии: **доска задач, прогресс по дням, оценки по аспектам, каталог игры (карты, модели,
герои, механики, HUD, меню), журнал действий, журнал сессий, описание игры, фирстиль, решения**.

Сейчас подключены: **Run Rix Run** (`sport-platform-star/My-project`) и **ROLO: Crate Rush** (`sport-platform-star/rush`).

## Как это работает

```
Claude Code / Codex / вы ──scripts/task.sh──▶ GitHub Issues (метки status:* agent:*, комментарии, close)
                         ──коммиты──────────▶ hub/catalog/*.yaml, hub/scores.jsonl, журнал, доки
                                                         │
GitHub Action «Sync hub» (каждые ~15 мин) ── читает оба репо ──▶ шифрует ──▶ GitHub Pages ──▶ сайт
```

- **Источник правды — сами репозитории игр.** Хаб ничего не хранит и ничего не пишет в игры: только читает и показывает.
- Агенты меняют статусы сами через `scripts/task.sh` в репо игры (протокол — `docs/HUB-PROTOCOL.md` там же).
- Данные на сайте **зашифрованы** (AES-GCM, ключ из пароля). Сайт Pages открыт в интернете — без пароля по ссылке видно
  только экран входа. Пароль вводится один раз на устройстве.

## Включение (один раз, ~10 минут)

1. **Репозиторий.** Создайте пустой `sport-platform-star/studio-hub` и залейте туда эту папку.
   Можно **публичный** (Pages бесплатно; в репо нет секретов — только код и `hub.config.json`) или приватный
   (Pages для приватного репо требует GitHub Pro; при этом сам сайт всё равно доступен по ссылке — поэтому шифрование).
2. **Токен чтения.** GitHub → Settings → Developer settings → *Fine-grained personal access tokens* → Generate:
   Resource owner `sport-platform-star`, Repository access — *Only select*: `My-project`, `rush` (и каждая новая игра),
   Permissions: **Contents: Read**, **Issues: Read**, **Metadata: Read**. Срок — до года.
   В `studio-hub` → Settings → Secrets and variables → Actions → *New repository secret*: `HUB_TOKEN` = токен.
3. **Пароль хаба.** Там же секрет `HUB_PASSPHRASE` = длинная фраза (её вводите на сайте).
4. **Pages.** `studio-hub` → Settings → Pages → Source: **GitHub Actions**.
5. **Первый запуск.** Actions → *Sync hub* → *Run workflow*. Через 1–3 минуты сайт по адресу
   `https://sport-platform-star.github.io/studio-hub/`.
6. **Смержить PR в играх** (rush #1, My-project #77): там `scripts/task.sh`, протокол, каталог, оценки и правила для агентов.

## Новая игра

```bash
scripts/add-game.sh sport-platform-star/<repo> <slug> "Название" "#цвет" "Короткое описание"
git commit -am "hub: add <slug>" && git push
```
Скрипт создаёт метки в репо игры, открывает там PR с `task.sh` / протоколом / каталогом / журналом и добавляет игру в
`hub.config.json`. Останется дать токену `HUB_TOKEN` доступ к новому репо (шаг 2) и поправить пути доков в конфиге.

## Что откуда берётся (hub.config.json)

| Вкладка | Источник в репо игры |
|---|---|
| Доска | Issues: метки `status:*`, `agent:*`; закрытые = «Готово» |
| Прогресс | закрытия, смены статусов, коммиты всех веток — по дням |
| Оценки | `hub/scores.jsonl` |
| Каталог | `hub/catalog/*.yaml` |
| Журнал действий | комментарии `task.sh` (`<!-- hub:event=… -->`), события issues, коммиты |
| Журнал сессий | `docs.journal` (Rix: `Docs/Design/Plan/journal.md`, ROLO: `docs/10-journal.md`) |
| Об игре / Фирстиль / Решения | `docs.about` / `docs.brand` (+ `tokens`, `paletteFrom`, `images`) / `docs.decisions` |

`docRefs` — ветки, из которых брать доки (берётся самая свежая версия файла): у Rix это `frost-fair` и `main`.

## Локальный просмотр

```bash
npm install
node scripts/sync.mjs --plain     # берёт ваш логин gh, без шифрования — только для себя
npx serve site                    # http://localhost:3000
```
`site/data/` в git не попадает.

## Мгновенное обновление (необязательно)

Чтобы сайт обновлялся сразу после действия агента, а не по расписанию, в репо игры можно добавить workflow, который на
`issues`, `issue_comment` и `push` шлёт `repository_dispatch` (`game-updated`) в `studio-hub`. Для этого нужен второй
токен с правом *Actions: write* на `studio-hub` — включим, когда понадобится.

## Дизайн

Весь внешний вид — `site/style.css` (только CSS-переменные и классы). Бриф для редизайна (Codex): `DESIGN.md`.
