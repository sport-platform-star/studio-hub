#!/usr/bin/env bash
# add-game.sh — connect a new game repo to the studio hub in one go.
#
#   scripts/add-game.sh OWNER/REPO slug "Game Name" "#accent" ["tagline"]
#
# What it does:
#   1. creates the status:* / agent:* labels in the game repo;
#   2. opens a PR in the game repo with scripts/task.sh, docs/HUB-PROTOCOL.md, docs/10-journal.md,
#      hub/README.md, hub/catalog/core.yaml, hub/scores.jsonl and a "Tasks & studio hub" block in CLAUDE.md / AGENTS.md;
#   3. adds the game to hub.config.json here (commit it and push — the next sync shows the game).
# Then: give the HUB_TOKEN fine-grained PAT read access to the new repo (README, step 2).
# Needs: gh (logged in), git, jq.
set -euo pipefail
repo=${1:?OWNER/REPO}; slug=${2:?slug}; name=${3:?"Game Name"}; accent=${4:-"#888888"}; tagline=${5:-""}
HERE=$(cd "$(dirname "$0")/.." && pwd); KIT="$HERE/scripts/game-kit"

echo "1/3 labels in $repo"
while IFS='|' read -r l color desc; do
  gh api -X POST "repos/$repo/labels" -f name="$l" -f color="$color" -f description="$desc" >/dev/null 2>&1 \
    && echo "  + $l" || echo "  = $l (exists)"
done <<'EOF'
status:backlog|cfd3dc|Идея / ещё не запланировано
status:todo|0e8a16|Запланировано, можно брать
status:in-progress|fbca04|Агент или человек работает сейчас
status:review|8a63d2|Сделано, идёт проверка
status:blocked|d93f0b|Заблокировано — причина в комментарии
agent:claude|d4a373|Исполнитель — Claude Code
agent:codex|1d76db|Исполнитель — Codex
agent:owner|5319e7|Исполнитель — владелец / человек
EOF

echo "2/3 PR in $repo"
tmp=$(mktemp -d)
git clone -q --depth 1 --filter=blob:none --sparse "https://github.com/$repo" "$tmp/r"
cd "$tmp/r"
git sparse-checkout set --no-cone /CLAUDE.md /AGENTS.md /scripts/task.sh /docs/HUB-PROTOCOL.md /docs/10-journal.md /hub >/dev/null
git checkout -q -b hub/connect
mkdir -p scripts docs hub/catalog
cp "$KIT/task.sh" scripts/task.sh && chmod +x scripts/task.sh
sed 's#8\. В конце сессии — запись в журнал сессий (путь ниже)\.#8. В конце сессии — одна запись в `docs/10-journal.md`.#' "$KIT/HUB-PROTOCOL.md" > docs/HUB-PROTOCOL.md
[[ -f docs/10-journal.md ]] || cp "$KIT/journal.md" docs/10-journal.md
cp "$KIT/hub-README.md" hub/README.md
[[ -f hub/scores.jsonl ]] || : > hub/scores.jsonl
[[ -f hub/catalog/core.yaml ]] || cat > hub/catalog/core.yaml <<EOF
# Каталог $name для студийного хаба (формат: hub/README.md). Агенты дополняют при каждом изменении.
- { id: game, kind: map, name: $name, status: idea, source: add-game.sh $(date +%F) }
EOF
block='
## Tasks & studio hub
Tasks are GitHub Issues of this repo. Whoever works on a task moves it — Claude and Codex do it themselves — only via `scripts/task.sh`: `start N`, `note N`, `review N`, `done N --file report.md` (the agent closes the issue itself after the review passes), `block N "reason"`, `new "Title"`. Reference `#N` in commits. Keep `hub/catalog/*.yaml` and `hub/scores.jsonl` up to date with every change and review; append a session entry to `docs/10-journal.md`. Full protocol: `docs/HUB-PROTOCOL.md`.'
for f in CLAUDE.md AGENTS.md; do
  [[ -f $f ]] || echo "# $name — rules for every agent" > $f
  grep -q "## Tasks & studio hub" $f || printf '%s\n' "$block" >> $f
done
git add -A
git commit -q -m "chore: connect to the studio hub (task statuses, catalog, scores, journal)"
git push -q -u origin hub/connect
gh api -X POST "repos/$repo/pulls" -f title="Connect to the studio hub" -f head=hub/connect -f base="$(gh api repos/$repo --jq .default_branch)" \
  -f body="Labels status:* / agent:*, scripts/task.sh, docs/HUB-PROTOCOL.md, docs/10-journal.md, hub/catalog, hub/scores.jsonl, CLAUDE.md / AGENTS.md block." --jq '"  PR: " + .html_url'
cd "$HERE"; rm -rf "$tmp"

echo "3/3 hub.config.json"
jq --arg repo "$repo" --arg slug "$slug" --arg name "$name" --arg accent "$accent" --arg tagline "$tagline" '
  if any(.games[]; .slug == $slug) then . else .games += [{
    slug: $slug, name: $name, tagline: $tagline, repo: $repo, accent: $accent,
    docs: { about: ["README.md"], brand: [], decisions: [], journal: "docs/10-journal.md" },
    images: [], links: [], docRefs: ["main"], catalog: "hub/catalog", scores: "hub/scores.jsonl", branches: "all" }] end' \
  hub.config.json > hub.config.json.tmp && mv hub.config.json.tmp hub.config.json
echo "  added $slug — edit docs paths in hub.config.json if the game keeps vision / GDD / art style elsewhere, then commit + push."
