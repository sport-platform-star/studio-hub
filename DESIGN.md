# Design brief — Studio Hub (for Codex)

The hub works; it needs a look. Codex owns the visual design; Claude owns the data and the JS.

## Rules
- Change **only `site/style.css`** (and add fonts / icons under `site/assets/` if needed). Do not edit `app.js` markup or
  class names — if a design needs new markup, write the request into an issue for Claude.
- Keep everything in CSS variables at the top of `style.css` (colours, radius, fonts, spacing). Dark theme first;
  a light theme = a second `:root[data-theme=light]` block.
- Each game passes its own `--accent` (Run Rix Run `#dd5b1f`, ROLO `#66F5DD`); headers, active tabs, progress and
  charts use it, so the hub reads as "studio" and each game page reads as "that game".
- Status colours must stay distinct and colour-blind safe: backlog, todo, in-progress, review, blocked, done.
- Readability first: the board is used daily with 50+ cards; dense but calm. Works on a phone (board scrolls sideways).

## Class map (what app.js renders)
| Area | Classes |
|---|---|
| Header | `.top .brand #game-nav a(.active) #updated` |
| Lock screen | `.lock form #pass .check button .err` |
| Overview | `.grid2 .card.game-card .progress .kpis .kpi(.s-<status>) ul.plain .dot.s-<status> .tabs.small` |
| Game page | `.game-head .tabs a(.active) .view.view-<tab>` |
| Board | `.toolbar .board .col.s-<status> .count .task .task-head .num .task-title .task-meta` |
| Chips | `.chip .chip.agent.agent-<claude/codex/owner> .chip.s-<status> .chip.c-<catalog status> .chip.warn .chip.game` |
| Progress | `.kpis.wide .chart svg rect.b-done/.b-move/.b-commit .axis .grid .legends .legend details.day ul.commits` |
| Scores | `table.matrix td.score.ok/.low svg.line .trend .gate circle.ok/.low .grid3 figure figcaption` |
| Catalog | `table.catalog .score.ok/.low .kpi.c-<status>` (idea, design, wip, in-game, locked, retired) |
| Log | `.feed li time .feed-text` |
| Docs / brand | `.card.md-doc .md .swatches .swatch .images` |
