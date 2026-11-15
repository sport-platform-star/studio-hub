# hub/ — данные игры для студийного хаба

Хаб (репо `studio-hub`) читает эту папку и строит вкладки **«Каталог»** и **«Оценки»**. Пишут сюда Claude, Codex и люди
обычными коммитами — это и есть «база данных» игры: с историей в git, без сервера.

## hub/catalog/*.yaml — что есть в игре
Один файл на карту или область (`frost_1.yaml`, `heroes.yaml`, `hud.yaml`, `menu.yaml`, `audio.yaml` …). Каждый файл — список записей:

```yaml
- id: B1                 # уникальный код (как в доках: G1, B1, D9, jinglejaw …)
  kind: hazard           # map | hero | enemy | boss | hazard | model | env | mechanic | hud | menu | audio | vfx | weapon | pickup
  name: Башня-подарок
  status: locked         # idea | design | wip | in-game | locked | retired
  version: v3
  maps: [frost_1]        # где используется
  parts: [G3]            # из каких других записей состоит (необязательно)
  issue: 75              # задача
  decisions: [D-526]
  image: Docs/…/b1_v3.png   # путь в репо (необязательно)
  notes: Высота 4.05 м
  source: откуда факт (док §, решение, «Unity export 2026-11-15»)
```

Правила (D-530): изменил модель / механику / HUD — обнови запись в том же коммите (status, version, notes).
Не выдумывать: неизвестное поле просто не писать.

## hub/scores.jsonl — оценки по аспектам
Одна строка JSON на одну оценку; только дописывать в конец:

```json
{"date":"2026-11-15","target":"frost_1","aspect":"GRAPHICS","score":8.6,"by":"reviewer","issue":75,"note":"фон акта 3 шумит"}
```

- `target` — id из каталога (карта, модель, босс, `hud`, `menu`, `game` для игры в целом).
- `aspect` — GRAPHICS, STYLE, COMPOSITION (D-527), а также GAMEPLAY, READABILITY, HUD, MENU, AUDIO, PERF, FUN — или свой.
- `score` 1–10; гейт качества в хабе — 9.0.
- `by` — кто ставил: reviewer, claude, codex, owner, gpt.
Каждое ревью с оценками (D-527) дописывает сюда строки — хаб рисует графики, тренды и «что ниже 9».
