# Task protocol for Claude Code, Codex and people (studio hub)

## 🇷🇺 По-русски

Все задачи игры — это GitHub Issues этого репозитория. Студийный хаб (`studio-hub`, GitHub Pages) каждые
~15 минут читает их и показывает доску, прогресс по дням и журнал действий. **Статус задачи меняет тот, кто
над ней работает — агент сам**, только через `scripts/task.sh`, чтобы каждое действие попало в журнал.

| Статус | Метка | Когда |
|---|---|---|
| Бэклог | `status:backlog` | идея, ещё не запланирована |
| К работе | `status:todo` | можно брать |
| В работе | `status:in-progress` | агент или человек работает сейчас |
| Проверка | `status:review` | работа сделана, идёт независимое ревью |
| Блок | `status:blocked` | нужен ответ владельца или другая задача; причина в комментарии |
| Готово | issue закрыт (completed) | ревью пройдено, отчёт в комментарии |

Порядок работы агента:
1. `scripts/task.sh start N` — сразу, как взял задачу (метки `status:in-progress` + `agent:claude|codex`).
2. `scripts/task.sh note N "..."` — заметные шаги (не чаще раза в ~30 мин, без шума).
3. `scripts/task.sh review N "..."` — когда начинается независимая проверка (reviewer / adversarial-review).
4. `scripts/task.sh done N --file report.md` — **агент закрывает задачу сам** после PASS ревью. Отчёт: что сделано,
   файлы/коммиты, доказательства (видео/скриншоты/тесты), известные проблемы.
5. `scripts/task.sh block N "что нужно"` — если упёрся в решение владельца. Не выдумывать решение.
6. Нашёл новую работу — `scripts/task.sh new "Заголовок" --body-file f.md` (статус `todo`), не делать её молча.
7. В коммитах указывать номер задачи: `#N`. Закрывающие слова (`Closes #N`) не используем — закрывает `task.sh done`.
8. В конце сессии — одна запись в `docs/10-journal.md` (шаблон в файле).

9. Изменил модель / механику / HUD / меню — обнови запись в `hub/catalog/*.yaml` в том же коммите. Ревью с оценками (D-527 и любые 1–10) — допиши строки в `hub/scores.jsonl`. Формат: `hub/README.md`.

Владелец видит всё в хабе и может переоткрыть задачу: `scripts/task.sh reopen N "почему"`.

## 🇬🇧 English

Every task is a GitHub Issue of this repo; the studio hub reads them every ~15 minutes. **Whoever works on a task
moves it — agents do it themselves — always via `scripts/task.sh`**, so every move lands in the action log.
Flow: `start N` → `note N` (milestones only) → `review N` → `done N --file report.md` (the agent closes the issue
itself after the independent review passes) · `block N "reason"` when an owner decision is needed ·
`new "Title"` for discovered work · reference `#N` in commits (no `Closes #N`) · one entry in `docs/10-journal.md` at session end.
Agent identity: `TASK_AGENT=claude|codex|owner` (auto-detected for Claude Code and Codex).
