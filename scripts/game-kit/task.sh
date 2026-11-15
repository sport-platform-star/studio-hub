#!/usr/bin/env bash
# task.sh — the one way Claude Code, Codex and people move tasks (GitHub Issues) between statuses.
# The studio hub (studio-hub) reads these labels, comments and closes and draws the board, the
# per-day progress and the action log. Uses only `gh api` (REST), so it works locally and in cloud sessions.
#
#   scripts/task.sh list [todo|in-progress|review|blocked|backlog|all]
#   scripts/task.sh show  N
#   scripts/task.sh new   "Title" [--body TEXT | --body-file FILE] [--status todo] [--label area:x ...]
#   scripts/task.sh start N                       # -> in-progress + agent label + comment
#   scripts/task.sh note  N "what happened"       # progress comment, status unchanged
#   scripts/task.sh review N "what is being checked"
#   scripts/task.sh block N "why, what is needed"
#   scripts/task.sh status N <backlog|todo|in-progress|review|blocked> ["note"]
#   scripts/task.sh done  N "report" | --file FILE   # report comment + close as completed
#   scripts/task.sh drop  N "reason"              # close as not planned
#   scripts/task.sh reopen N "reason"
#
# Who is acting: TASK_AGENT=claude|codex|owner (auto: Claude Code sets CLAUDECODE=1, Codex sets CODEX_* vars).
# Which repo: TASK_REPO=owner/repo, otherwise taken from `git remote get-url origin`.
set -euo pipefail

STATUSES="backlog todo in-progress review blocked"

die() { echo "task.sh: $*" >&2; exit 1; }

detect_agent() {
  if [[ -n "${TASK_AGENT:-}" ]]; then echo "$TASK_AGENT"; return; fi
  if [[ -n "${CLAUDECODE:-}" || -n "${CLAUDE_CODE_ENTRYPOINT:-}" ]]; then echo claude; return; fi
  if env | grep -q '^CODEX_'; then echo codex; return; fi
  echo owner
}

detect_repo() {
  if [[ -n "${TASK_REPO:-}" ]]; then echo "$TASK_REPO"; return; fi
  local url
  url=$(git remote get-url origin 2>/dev/null) || die "no TASK_REPO and no git origin"
  url=${url%.git}
  url=${url#*github.com[:/]}
  echo "$url"
}

AGENT=$(detect_agent)
case "$AGENT" in claude|codex|owner) ;; *) die "TASK_AGENT must be claude, codex or owner (got '$AGENT')";; esac
REPO=$(detect_repo)
STAMP() { date -u +%Y-%m-%dT%H:%M:%SZ; }

icon() {
  case "$1" in
    start) echo "▶️";; note) echo "📝";; review) echo "🔍";; block) echo "⛔";; done) echo "✅";;
    drop) echo "🗑️";; reopen) echo "↩️";; status) echo "🔀";; new) echo "🆕";; *) echo "•";;
  esac
}

# Every hub comment starts with one machine-readable line the hub parses:
#   <!-- hub:event=start agent=claude status=in-progress -->
comment() { # N event status text
  local n=$1 ev=$2 st=$3 text=$4 body
  body="<!-- hub:event=$ev agent=$AGENT status=$st -->
$(icon "$ev") **[$AGENT]** $text"
  gh api -X POST "repos/$REPO/issues/$n/comments" -f body="$body" --jq .html_url >/dev/null
}

set_status() { # N status
  local n=$1 st=$2 l
  [[ " $STATUSES " == *" $st "* ]] || die "unknown status '$st' (use: $STATUSES)"
  for l in $(gh api "repos/$REPO/issues/$n/labels" --jq '.[].name | select(startswith("status:"))'); do
    [[ "$l" == "status:$st" ]] && continue
    gh api -X DELETE "repos/$REPO/issues/$n/labels/$(printf %s "$l" | sed 's/:/%3A/')" >/dev/null || true
  done
  gh api -X POST "repos/$REPO/issues/$n/labels" -f "labels[]=status:$st" -f "labels[]=agent:$AGENT" >/dev/null
}

drop_status_labels() {
  local n=$1 l
  for l in $(gh api "repos/$REPO/issues/$n/labels" --jq '.[].name | select(startswith("status:"))'); do
    gh api -X DELETE "repos/$REPO/issues/$n/labels/$(printf %s "$l" | sed 's/:/%3A/')" >/dev/null || true
  done
}

text_arg() { # reads "text" or --file FILE from the remaining args
  if [[ "${1:-}" == "--file" ]]; then [[ -f "${2:-}" ]] || die "no file '${2:-}'"; cat "$2"; else echo "${1:-}"; fi
}

cmd=${1:-}; shift || true
case "$cmd" in
  list)
    st=${1:-all}
    if [[ "$st" == all ]]; then q="state=open"; else q="state=open&labels=status:$st"; fi
    gh api "repos/$REPO/issues?$q&per_page=100" --paginate \
      --jq '.[] | select(.pull_request == null) | "#\(.number)\t\([.labels[].name | select(startswith("status:") or startswith("agent:"))] | join(","))\t\(.title)"'
    ;;
  show)
    n=${1:?N}
    gh api "repos/$REPO/issues/$n" --jq '"#\(.number) [\(.state)] \(.title)\nlabels: \([.labels[].name]|join(", "))\n\n\(.body // "")"'
    ;;
  new)
    title=${1:?title}; shift
    body=""; st=todo; extra=()
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --body) body=$2; shift 2;;
        --body-file) body=$(cat "$2"); shift 2;;
        --status) st=$2; shift 2;;
        --label) extra+=(-f "labels[]=$2"); shift 2;;
        *) die "unknown option $1";;
      esac
    done
    [[ " $STATUSES " == *" $st "* ]] || die "unknown status '$st'"
    n=$(gh api -X POST "repos/$REPO/issues" -f title="$title" -f body="$body" \
          -f "labels[]=status:$st" -f "labels[]=agent:$AGENT" "${extra[@]}" --jq .number)
    comment "$n" new "$st" "Создал задачу / created ($st)"
    echo "$n"
    ;;
  start)
    n=${1:?N}; set_status "$n" in-progress
    comment "$n" start in-progress "Взял в работу / started — $(STAMP)"
    ;;
  note)
    n=${1:?N}; shift; t=$(text_arg "$@")
    st=$(gh api "repos/$REPO/issues/$n/labels" --jq '[.[].name | select(startswith("status:"))][0] // "status:none"')
    comment "$n" note "${st#status:}" "$t"
    ;;
  review)
    n=${1:?N}; shift; t=$(text_arg "$@"); set_status "$n" review
    comment "$n" review review "На проверке / in review. $t"
    ;;
  block)
    n=${1:?N}; shift; t=$(text_arg "$@"); [[ -n "$t" ]] || die "say why it is blocked"
    set_status "$n" blocked
    comment "$n" block blocked "Заблокировано / blocked: $t"
    ;;
  status)
    n=${1:?N}; st=${2:?status}; shift 2; t=$(text_arg "$@")
    set_status "$n" "$st"
    comment "$n" status "$st" "Статус → $st. $t"
    ;;
  done)
    n=${1:?N}; shift; t=$(text_arg "$@"); [[ -n "$t" ]] || die "a done needs a report"
    comment "$n" done done "Готово / done.

$t"
    drop_status_labels "$n"
    gh api -X POST "repos/$REPO/issues/$n/labels" -f "labels[]=agent:$AGENT" >/dev/null
    gh api -X PATCH "repos/$REPO/issues/$n" -f state=closed -f state_reason=completed --jq '"closed #\(.number)"'
    ;;
  drop)
    n=${1:?N}; shift; t=$(text_arg "$@"); [[ -n "$t" ]] || die "say why"
    comment "$n" drop dropped "Не делаем / not planned: $t"
    drop_status_labels "$n"
    gh api -X PATCH "repos/$REPO/issues/$n" -f state=closed -f state_reason=not_planned --jq '"closed #\(.number) (not planned)"'
    ;;
  reopen)
    n=${1:?N}; shift; t=$(text_arg "$@")
    gh api -X PATCH "repos/$REPO/issues/$n" -f state=open >/dev/null
    set_status "$n" todo
    comment "$n" reopen todo "Переоткрыто / reopened. $t"
    ;;
  ""|-h|--help|help)
    sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
    ;;
  *) die "unknown command '$cmd' (see: scripts/task.sh help)";;
esac
