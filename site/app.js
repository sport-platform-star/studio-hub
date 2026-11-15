/* Studio Hub — static viewer for site/data/hub(.enc).json. No dependencies.
   Styling lives in style.css (CSS variables only) so the look can be redesigned without touching this file. */
'use strict';

const COLS = [
  ['backlog', 'Бэклог'], ['todo', 'К работе'], ['in-progress', 'В работе'],
  ['review', 'Проверка'], ['blocked', 'Блок'], ['done', 'Готово'],
];
const STATUS_RU = Object.fromEntries([...COLS, ['none', 'Без статуса'], ['dropped', 'Не делаем']]);
const TABS = [
  ['board', 'Доска'], ['progress', 'Прогресс'], ['scores', 'Оценки'], ['catalog', 'Каталог'],
  ['log', 'Журнал действий'], ['journal', 'Журнал сессий'], ['about', 'Об игре'], ['brand', 'Фирстиль'], ['decisions', 'Решения'],
];
const KIND_RU = {
  map: 'Карта', hero: 'Герой', enemy: 'Враг', boss: 'Босс', hazard: 'Препятствие', model: 'Модель', env: 'Окружение',
  mechanic: 'Механика', hud: 'HUD', menu: 'Меню', audio: 'Звук', vfx: 'VFX', weapon: 'Оружие', pickup: 'Подбор',
};
const CAT_STATUS = ['idea', 'design', 'wip', 'in-game', 'locked', 'retired'];
const CAT_STATUS_RU = { idea: 'идея', design: 'дизайн', wip: 'в работе', 'in-game': 'в игре', locked: 'залочено', retired: 'убрано' };
const EVENT_RU = {
  new: '🆕 создал', start: '▶️ взял в работу', note: '📝', review: '🔍 на проверку', block: '⛔ блок', done: '✅ закрыл',
  drop: '🗑️ не делаем', reopen: '↩️ переоткрыл', status: '🔀 статус', moved: '🔀 статус', closed: '✅ закрыто',
  reopened: '↩️ переоткрыто', comment: '💬 комментарий',
};

let HUB = null;
const state = { filters: {} };

// ---------- utils ----------
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDay = (d) => new Date(d + 'T00:00:00').toLocaleDateString('ru-RU', { weekday: 'short', day: '2-digit', month: 'short' });
const ago = (iso) => {
  const m = (Date.now() - Date.parse(iso)) / 60000;
  if (m < 60) return `${Math.max(1, Math.round(m))} мин`;
  if (m < 1440) return `${Math.round(m / 60)} ч`;
  return `${Math.round(m / 1440)} дн`;
};
const agentChip = (a) => a ? `<span class="chip agent agent-${esc(a)}">${esc(a)}</span>` : '';
const game = (slug) => HUB.games.find((g) => g.slug === slug);
const issueLink = (g, n) => `https://github.com/${g.repo}/issues/${n}`;

// ---------- data loading (plain or encrypted) ----------
async function load() {
  if (window.HUB_DATA) return window.HUB_DATA; // single-file preview
  let r = await fetch('data/hub.json', { cache: 'no-store' });
  if (r.ok) return r.json();
  r = await fetch('data/hub.enc.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('Нет данных: запустите синхронизацию (GitHub Action «Sync hub»).');
  const enc = await r.json();
  const saved = localStorage.getItem('hub-pass');
  if (saved) { try { return await decrypt(enc, saved); } catch { localStorage.removeItem('hub-pass'); } }
  return askPassword(enc);
}
async function decrypt(enc, pass) {
  const b = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b(enc.salt), iterations: enc.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b(enc.iv) }, key, b(enc.data));
  return JSON.parse(new TextDecoder().decode(plain));
}
function askPassword(enc) {
  $('#lock').hidden = false; $('#app').hidden = true;
  return new Promise((resolve) => {
    $('#lock-form').onsubmit = async (e) => {
      e.preventDefault();
      const pass = $('#pass').value;
      try {
        const data = await decrypt(enc, pass);
        if ($('#remember').checked) localStorage.setItem('hub-pass', pass);
        $('#lock').hidden = true; $('#app').hidden = false;
        resolve(data);
      } catch { $('#lock-err').hidden = false; }
    };
  });
}

// ---------- charts (plain SVG) ----------
function barChart(days, series, h = 160) {
  const w = Math.max(days.length * 18, 300), pad = 22;
  const max = Math.max(1, ...days.map((d) => series.reduce((s, k) => s + d[k.key], 0)));
  const bw = (w - pad) / days.length;
  let bars = '';
  days.forEach((d, i) => {
    let y = h - pad;
    for (const s of series) {
      const v = d[s.key]; if (!v) continue;
      const bh = (v / max) * (h - pad - 8);
      y -= bh;
      bars += `<rect x="${pad + i * bw + 2}" y="${y}" width="${bw - 4}" height="${bh}" class="${s.cls}"><title>${fmtDay(d.date)} · ${s.label}: ${v}</title></rect>`;
    }
    if (i % 7 === days.length % 7) bars += `<text x="${pad + i * bw}" y="${h - 6}" class="axis">${d.date.slice(8)}.${d.date.slice(5, 7)}</text>`;
  });
  const grid = [0.5, 1].map((f) => `<line x1="${pad}" x2="${w}" y1="${h - pad - f * (h - pad - 8)}" y2="${h - pad - f * (h - pad - 8)}" class="grid"/><text x="0" y="${h - pad - f * (h - pad - 8) + 4}" class="axis">${Math.round(max * f)}</text>`).join('');
  const legend = series.map((s) => `<span class="legend"><i class="${s.cls}"></i>${s.label}</span>`).join('');
  return `<div class="chart"><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img">${grid}${bars}</svg><div class="legends">${legend}</div></div>`;
}
function lineChart(points, gate, h = 140) {
  // points: [{date, score}] sorted
  if (!points.length) return '';
  const w = 360, pad = 24, min = 1, max = 10;
  const t0 = Date.parse(points[0].date), t1 = Math.max(Date.parse(points.at(-1).date), t0 + 864e5);
  const X = (d) => pad + ((Date.parse(d) - t0) / (t1 - t0)) * (w - pad - 8);
  const Y = (v) => 8 + (1 - (v - min) / (max - min)) * (h - pad - 8);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${X(p.date).toFixed(1)},${Y(p.score).toFixed(1)}`).join(' ');
  const dots = points.map((p) => `<circle cx="${X(p.date)}" cy="${Y(p.score)}" r="3" class="${p.score >= gate ? 'ok' : 'low'}"><title>${p.date}: ${p.score}${p.note ? ' — ' + esc(p.note) : ''}</title></circle>`).join('');
  return `<svg class="line" viewBox="0 0 ${w} ${h}" role="img">
    <line x1="${pad}" x2="${w}" y1="${Y(gate)}" y2="${Y(gate)}" class="gate"/><text x="0" y="${Y(gate) + 4}" class="axis">${gate}</text>
    <text x="0" y="${Y(10) + 8}" class="axis">10</text><text x="0" y="${Y(1)}" class="axis">1</text>
    <path d="${path}" class="trend"/>${dots}</svg>`;
}

// ---------- views ----------
function overview() {
  const cards = HUB.games.map((g) => {
    if (g.error) return `<article class="card game-card"><h2>${esc(g.name)}</h2><p class="err">Ошибка синхронизации: ${esc(g.error)}</p></article>`;
    const c = Object.fromEntries(COLS.map(([k]) => [k, g.issues.filter((i) => i.status === k).length]));
    const open = g.issues.filter((i) => i.state === 'open').length;
    const done = g.issues.filter((i) => i.state === 'closed').length;
    const dropped = g.issues.filter((i) => i.stateReason === 'not_planned').length;
    const pct = Math.round((done / Math.max(1, done + open)) * 100);
    const wk = g.days.slice(-7);
    const active = g.issues.filter((i) => i.status === 'in-progress' || i.status === 'review' || i.status === 'blocked');
    const lastJ = g.journal[0];
    const gate = HUB.qualityGate;
    const latest = latestScores(g);
    const below = latest.filter((s) => s.score < gate).length;
    return `<article class="card game-card" style="--accent:${esc(g.accent)}">
      <header><h2><a href="#/g/${g.slug}/board">${esc(g.name)}</a></h2><p class="muted">${esc(g.tagline)}</p></header>
      <div class="progress"><div style="width:${pct}%"></div></div>
      <p class="muted small">${done} закрыто${dropped ? ` (из них «не делаем» ${dropped})` : ''} · ${open} открыто · ${pct}%</p>
      <div class="kpis">
        ${COLS.slice(1, 5).map(([k, l]) => `<div class="kpi s-${k}"><b>${c[k]}</b><span>${l}</span></div>`).join('')}
        <div class="kpi"><b>${wk.reduce((s, d) => s + d.closed, 0)}</b><span>закрыто за 7 дн</span></div>
        <div class="kpi"><b>${wk.reduce((s, d) => s + d.commits, 0)}</b><span>коммитов за 7 дн</span></div>
        <div class="kpi"><b>${g.catalog.length}</b><span>в каталоге</span></div>
        <div class="kpi ${below ? 's-blocked' : ''}"><b>${latest.length ? below : '—'}</b><span>оценок ниже ${gate}</span></div>
      </div>
      <h3>Сейчас</h3>
      ${active.length ? `<ul class="plain">${active.map((i) => `<li><span class="dot s-${i.status}"></span><a href="${i.url}" target="_blank">#${i.number}</a> ${esc(i.title)} ${i.agents.map(agentChip).join('')}</li>`).join('')}</ul>` : '<p class="muted">Нет задач в работе</p>'}
      ${lastJ ? `<h3>Последняя сессия</h3><p><b>${esc(lastJ.date)}</b> ${esc(lastJ.title)}</p>` : ''}
      <nav class="tabs small">${TABS.map(([t, l]) => `<a href="#/g/${g.slug}/${t}">${l}</a>`).join('')}</nav>
    </article>`;
  }).join('');
  const feed = HUB.games.filter((g) => !g.error).flatMap((g) => g.events.slice(0, 30).map((e) => ({ ...e, g })))
    .sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 25);
  return `<div class="grid2">${cards}</div>
    <section class="card"><h2>Последние действия</h2>${feedList(feed, true)}</section>`;
}

function feedList(items, withGame = false) {
  if (!items.length) return '<p class="muted">Пока пусто</p>';
  return `<ul class="feed">${items.map((e) => `<li>
      <time title="${esc(e.ts)}">${fmtDate(e.ts)}</time>
      ${withGame ? `<span class="chip game" style="--accent:${esc(e.g.accent)}">${esc(e.g.name)}</span>` : ''}
      ${agentChip(e.agent)} <b>${EVENT_RU[e.kind] || esc(e.kind)}</b>
      ${e.status && e.kind !== 'comment' ? `<span class="chip s-${esc(e.status)}">${esc(STATUS_RU[e.status] || e.status)}</span>` : ''}
      <a href="${esc(e.url)}" target="_blank">#${e.issue}</a> ${esc(e.title)}
      ${e.text ? `<div class="feed-text">${esc(e.text)}</div>` : ''}</li>`).join('')}</ul>`;
}

function board(g) {
  const f = state.filters[g.slug] ||= { agent: '', q: '' };
  const doneDays = HUB.doneVisibleDays;
  const show = (i) => (!f.agent || i.agents.includes(f.agent)) &&
    (!f.q || (`#${i.number} ${i.title} ${i.labels.join(' ')}`).toLowerCase().includes(f.q.toLowerCase()));
  const cols = COLS.map(([k, l]) => {
    let list = g.issues.filter((i) => (k === 'todo' ? i.status === 'todo' || i.status === 'none' : i.status === k) && show(i));
    if (k === 'done') list = list.filter((i) => Date.now() - Date.parse(i.closedAt) < doneDays * 864e5);
    list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return `<section class="col s-${k}"><h3>${l} <span class="count">${list.length}</span></h3>
      ${list.map((i) => `<a class="task" href="${i.url}" target="_blank">
        <div class="task-head"><span class="num">#${i.number}</span>${i.agents.map(agentChip).join('')}${i.status === 'none' ? '<span class="chip warn">без статуса</span>' : ''}${i.stateReason === 'not_planned' ? '<span class="chip">не делаем</span>' : ''}</div>
        <div class="task-title">${esc(i.title)}</div>
        <div class="task-meta">${i.labels.slice(0, 3).map((l) => `<span class="chip">${esc(l)}</span>`).join('')}
          <span class="muted small">${k === 'done' ? 'закрыто ' + ago(i.closedAt) : 'обновлено ' + ago(i.updatedAt)} · 💬 ${i.comments}</span></div>
      </a>`).join('')}
      ${k === 'done' ? `<p class="muted small">за ${doneDays} дн</p>` : ''}</section>`;
  }).join('');
  const agents = [...new Set(g.issues.flatMap((i) => i.agents))];
  return `<div class="toolbar">
      <input type="search" placeholder="Поиск по задачам" value="${esc(f.q)}" data-filter="q">
      <select data-filter="agent"><option value="">Все исполнители</option>${agents.map((a) => `<option ${f.agent === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
      <a class="btn" href="https://github.com/${g.repo}/issues/new" target="_blank">+ задача</a>
    </div><div class="board">${cols}</div>`;
}

function progress(g) {
  const days = g.days;
  const last7 = days.slice(-7), prev7 = days.slice(-14, -7);
  const sum = (a, k) => a.reduce((s, d) => s + d[k], 0);
  const delta = (k) => { const d = sum(last7, k) - sum(prev7, k); return d ? `<small class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}</small>` : ''; };
  const byNum = Object.fromEntries(g.issues.map((i) => [i.number, i]));
  const daysWithWork = [...days].reverse().filter((d) => d.commits || d.closed || d.moves).slice(0, 21);
  return `<div class="kpis wide">
      <div class="kpi"><b>${sum(last7, 'closed')} ${delta('closed')}</b><span>задач закрыто за 7 дн</span></div>
      <div class="kpi"><b>${sum(last7, 'commits')} ${delta('commits')}</b><span>коммитов за 7 дн</span></div>
      <div class="kpi"><b>${sum(last7, 'moves')}</b><span>смен статуса за 7 дн</span></div>
      <div class="kpi"><b>${sum(last7, 'opened')}</b><span>новых задач за 7 дн</span></div>
    </div>
    <section class="card"><h2>По дням (${days.length} дн)</h2>
      ${barChart(days, [{ key: 'closed', label: 'закрыто задач', cls: 'b-done' }, { key: 'moves', label: 'смены статуса', cls: 'b-move' }])}
      ${barChart(days, [{ key: 'commits', label: 'коммиты (все ветки)', cls: 'b-commit' }], 110)}
    </section>
    <section class="card"><h2>Дневник</h2>
      ${daysWithWork.length ? daysWithWork.map((d) => {
        const cs = g.commits.filter((c) => c.ts.slice(0, 10) === d.date);
        return `<details class="day" ${d === daysWithWork[0] ? 'open' : ''}><summary><b>${fmtDay(d.date)}</b>
          <span class="muted">✅ ${d.closed} · 🔀 ${d.moves} · ⎇ ${d.commits}</span></summary>
          ${d.done.length ? `<ul class="plain">${d.done.map((n) => `<li>✅ <a href="${issueLink(g, n)}" target="_blank">#${n}</a> ${esc(byNum[n]?.title)}</li>`).join('')}</ul>` : ''}
          ${cs.length ? `<ul class="commits">${cs.slice(0, 40).map((c) => `<li><a href="${c.url}" target="_blank"><code>${c.sha}</code></a> ${agentChip(c.agent)} ${esc(c.msg)} <span class="muted small">${esc(c.branches.join(', '))}</span></li>`).join('')}${cs.length > 40 ? `<li class="muted">… ещё ${cs.length - 40}</li>` : ''}</ul>` : ''}
        </details>`;
      }).join('') : '<p class="muted">Нет активности за период</p>'}
    </section>`;
}

function latestScores(g) {
  const map = new Map();
  for (const s of [...g.scores].sort((a, b) => a.date.localeCompare(b.date))) map.set(`${s.target}|${s.aspect}`, s);
  return [...map.values()];
}

function scores(g) {
  const gate = HUB.qualityGate;
  if (!g.scores.length) {
    return `<section class="card empty"><h2>Оценок пока нет</h2>
      <p>Оценки по аспектам (GRAPHICS, STYLE, COMPOSITION, HUD, меню, звук, FUN …) хаб берёт из файла
      <code>hub/scores.jsonl</code> в репозитории игры. После каждого ревью агент дописывает строки:</p>
      <pre>{"date":"2026-11-15","target":"frost_1","aspect":"GRAPHICS","score":8.6,"by":"reviewer","issue":75,"note":"фон акта 3 шумит"}</pre>
      <p class="muted">Здесь появятся графики по датам, линия гейта ${gate}, тренды и список «что держит ниже ${gate}».</p></section>`;
  }
  const latest = latestScores(g);
  const aspects = [...new Set(g.scores.map((s) => s.aspect))].sort();
  const targets = [...new Set(g.scores.map((s) => s.target))].sort();
  const cat = Object.fromEntries(g.catalog.map((c) => [c.id, c]));
  // matrix target × aspect
  const cell = (t, a) => {
    const s = latest.find((x) => x.target === t && x.aspect === a);
    if (!s) return '<td class="muted">—</td>';
    const hist = g.scores.filter((x) => x.target === t && x.aspect === a).sort((x, y) => x.date.localeCompare(y.date));
    const prev = hist.at(-2);
    const tr = prev ? (s.score > prev.score ? '▲' : s.score < prev.score ? '▼' : '') : '';
    return `<td class="score ${s.score >= gate ? 'ok' : 'low'}" title="${esc(s.date)} · ${esc(s.by || '')}${s.note ? ' — ' + esc(s.note) : ''}">${s.score}<small>${tr}</small></td>`;
  };
  const low = latest.filter((s) => s.score < gate).sort((a, b) => a.score - b.score);
  const avgByAspect = aspects.map((a) => {
    const xs = latest.filter((s) => s.aspect === a);
    return { a, avg: xs.reduce((s, x) => s + x.score, 0) / xs.length };
  });
  return `<div class="kpis wide">${avgByAspect.map(({ a, avg }) => `<div class="kpi ${avg >= gate ? 's-done' : 's-blocked'}"><b>${avg.toFixed(1)}</b><span>${esc(a)}</span></div>`).join('')}</div>
    <section class="card"><h2>Матрица: объект × аспект (последняя оценка)</h2>
      <div class="scroll"><table class="matrix"><thead><tr><th></th>${aspects.map((a) => `<th>${esc(a)}</th>`).join('')}</tr></thead>
      <tbody>${targets.map((t) => `<tr><th>${esc(cat[t]?.name || t)}</th>${aspects.map((a) => cell(t, a)).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="muted small">Зелёный — ≥ ${gate}, красный — ниже гейта. Наведите на ячейку — дата, кто ставил, комментарий.</p></section>
    <section class="card"><h2>Ниже ${gate} — что держит</h2>
      ${low.length ? `<ul class="plain">${low.map((s) => `<li><span class="chip s-blocked">${s.score}</span> <b>${esc(cat[s.target]?.name || s.target)}</b> · ${esc(s.aspect)} — ${esc(s.note || '')} ${s.issue ? `<a href="${issueLink(g, s.issue)}" target="_blank">#${s.issue}</a>` : ''} <span class="muted small">${esc(s.date)}</span></li>`).join('')}</ul>` : '<p>Всё на гейте или выше 🎉</p>'}</section>
    <section class="card"><h2>Динамика по аспектам</h2><div class="grid3">
      ${targets.flatMap((t) => aspects.map((a) => {
        const pts = g.scores.filter((s) => s.target === t && s.aspect === a).sort((x, y) => x.date.localeCompare(y.date));
        return pts.length > 1 ? `<figure><figcaption>${esc(cat[t]?.name || t)} · ${esc(a)}</figcaption>${lineChart(pts, gate)}</figure>` : '';
      })).join('') || '<p class="muted">Графики появятся, когда у аспекта будет 2+ оценки.</p>'}
    </div></section>`;
}

function catalog(g) {
  const f = state.filters[g.slug + ':cat'] ||= { map: '', kind: '', status: '', q: '', low: false };
  const gate = HUB.qualityGate;
  const latest = latestScores(g);
  const scoreOf = (id) => { const xs = latest.filter((s) => s.target === id); return xs.length ? Math.min(...xs.map((s) => s.score)) : null; };
  const maps = [...new Set(g.catalog.flatMap((c) => c.maps || []).concat(g.catalog.filter((c) => c.kind === 'map').map((c) => c.id)))].sort();
  const kinds = [...new Set(g.catalog.map((c) => c.kind))].sort();
  const list = g.catalog.filter((c) =>
    (!f.map || c.id === f.map || (c.maps || []).includes(f.map)) && (!f.kind || c.kind === f.kind) && (!f.status || c.status === f.status) &&
    (!f.q || `${c.id} ${c.name} ${c.notes || ''}`.toLowerCase().includes(f.q.toLowerCase())) &&
    (!f.low || ((s) => s !== null && s < gate)(scoreOf(c.id))));
  if (!g.catalog.length) {
    return `<section class="card empty"><h2>Каталог пуст</h2><p>Хаб читает <code>hub/catalog/*.yaml</code> в репозитории игры — карты, модели, герои, враги, механики, HUD, меню, звук. Формат описан в <code>hub/README.md</code>.</p></section>`;
  }
  const counts = CAT_STATUS.map((s) => [s, g.catalog.filter((c) => c.status === s).length]).filter(([, n]) => n);
  return `<div class="kpis wide">${counts.map(([s, n]) => `<div class="kpi c-${s}"><b>${n}</b><span>${CAT_STATUS_RU[s]}</span></div>`).join('')}<div class="kpi"><b>${g.catalog.length}</b><span>всего</span></div></div>
    <div class="toolbar">
      <input type="search" placeholder="Поиск: код, имя, заметки" value="${esc(f.q)}" data-cat="q">
      <select data-cat="map"><option value="">Все карты</option>${maps.map((m) => `<option ${f.map === m ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
      <select data-cat="kind"><option value="">Все типы</option>${kinds.map((k) => `<option value="${esc(k)}" ${f.kind === k ? 'selected' : ''}>${esc(KIND_RU[k] || k)}</option>`).join('')}</select>
      <select data-cat="status"><option value="">Любой статус</option>${CAT_STATUS.map((s) => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${CAT_STATUS_RU[s]}</option>`).join('')}</select>
      <label class="check"><input type="checkbox" data-cat="low" ${f.low ? 'checked' : ''}> ниже ${gate}</label>
      <span class="muted small">${list.length} из ${g.catalog.length}</span>
    </div>
    <div class="scroll"><table class="catalog"><thead><tr><th>Код</th><th>Название</th><th>Тип</th><th>Статус</th><th>Версия</th><th>Где</th><th>Оценка</th><th>Ссылки</th><th>Заметки</th></tr></thead><tbody>
    ${list.map((c) => { const s = scoreOf(c.id); return `<tr>
      <td><code>${esc(c.id)}</code></td><td><b>${esc(c.name || '')}</b></td><td>${esc(KIND_RU[c.kind] || c.kind || '')}</td>
      <td><span class="chip c-${esc(c.status)}">${esc(CAT_STATUS_RU[c.status] || c.status || '')}</span></td>
      <td>${esc(c.version || '')}</td><td>${(c.maps || []).map((m) => `<span class="chip">${esc(m)}</span>`).join('')}</td>
      <td>${s === null ? '<span class="muted">—</span>' : `<span class="score ${s >= gate ? 'ok' : 'low'}">${s}</span>`}</td>
      <td>${c.issue ? `<a href="${issueLink(g, c.issue)}" target="_blank">#${c.issue}</a> ` : ''}${(c.decisions || []).map((d) => `<span class="chip">${esc(d)}</span>`).join('')}
        ${c.image ? `<a href="https://github.com/${g.repo}/blob/${esc(c.ref)}/${esc(c.image)}" target="_blank">🖼</a>` : ''}</td>
      <td class="small">${esc(c.notes || '')}<div class="muted">${esc(c.source || '')}</div></td></tr>`; }).join('')}
    </tbody></table></div>`;
}

function log(g) {
  const f = state.filters[g.slug + ':log'] ||= { what: 'all', agent: '' };
  let items = [];
  if (f.what !== 'commits') items = items.concat(g.events.map((e) => ({ ...e, type: 'task' })));
  if (f.what !== 'tasks') items = items.concat(g.commits.map((c) => ({ ...c, type: 'commit' })));
  if (f.agent) items = items.filter((x) => x.agent === f.agent);
  items.sort((a, b) => b.ts.localeCompare(a.ts));
  items = items.slice(0, 300);
  const groups = {};
  items.forEach((x) => (groups[x.ts.slice(0, 10)] ||= []).push(x));
  const agents = [...new Set(g.events.map((e) => e.agent).concat(g.commits.map((c) => c.agent)).filter(Boolean))];
  return `<div class="toolbar">
      <select data-log="what"><option value="all">Всё</option><option value="tasks" ${f.what === 'tasks' ? 'selected' : ''}>Только задачи</option><option value="commits" ${f.what === 'commits' ? 'selected' : ''}>Только коммиты</option></select>
      <select data-log="agent"><option value="">Все</option>${agents.map((a) => `<option ${f.agent === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
    </div>
    ${Object.entries(groups).map(([d, xs]) => `<section class="card"><h3>${fmtDay(d)}</h3>
      ${feedList(xs.filter((x) => x.type === 'task'))}
      ${xs.some((x) => x.type === 'commit') ? `<ul class="commits">${xs.filter((x) => x.type === 'commit').map((c) => `<li><time>${fmtDate(c.ts).split(', ').pop()}</time> <a href="${c.url}" target="_blank"><code>${c.sha}</code></a> ${agentChip(c.agent)} ${esc(c.msg)} <span class="muted small">${esc(c.author)} · ${esc(c.branches.join(', '))}</span></li>`).join('')}</ul>` : ''}
    </section>`).join('') || '<p class="muted">Пусто</p>'}`;
}

function journal(g) {
  if (!g.journal.length) return `<section class="card empty"><p>Журнал сессий пуст. Агенты дописывают запись в конце каждой сессии (файл указан в <code>HUB-PROTOCOL.md</code>).</p></section>`;
  return g.journal.map((e, i) => `<details class="card" ${i < 3 ? 'open' : ''}><summary><b>${esc(e.date)} ${esc(e.time)}</b> — ${esc(e.title)}</summary><div class="md">${e.html}</div></details>`).join('');
}

function docs(g, key, extra = '') {
  const list = g.docs?.[key] || [];
  return extra + (list.length ? list.map((d) => `<article class="card md-doc">
      <p class="muted small"><a href="${esc(d.url)}" target="_blank">${esc(d.path)}</a> · ветка ${esc(d.ref)} · обновлён ${fmtDate(d.updated)}</p>
      <div class="md">${d.html}</div></article>`).join('') : '<p class="muted">Документ не найден</p>');
}

function brand(g) {
  const sw = g.tokens.length ? `<section class="card"><h2>Цвета</h2><div class="swatches">${g.tokens.map((t) => `
      <figure class="swatch"><div style="background:${esc(t.value)}"></div><figcaption><b>${esc(t.name)}</b><code>${esc(t.value)}</code><span class="muted small">${esc(t.usage || '')}</span></figcaption></figure>`).join('')}</div></section>` : '';
  const imgs = g.images.length ? `<section class="card"><h2>Логотип и персонажи</h2><div class="images">${g.images.map((im) => `<figure><img src="${im.src}" alt="${esc(im.caption)}"><figcaption>${esc(im.caption)}</figcaption></figure>`).join('')}</div></section>` : '';
  const links = g.links.length ? `<p>${g.links.map((l) => `<a class="btn" href="${esc(l.url)}" target="_blank">${esc(l.label)}</a>`).join(' ')}</p>` : '';
  return docs(g, 'brand', sw + imgs + links);
}

// ---------- router ----------
function render() {
  const [, kind, slug, tab = 'board'] = location.hash.split('/');
  $('#game-nav').innerHTML = HUB.games.map((g) => `<a href="#/g/${g.slug}/${kind === 'g' && slug === g.slug ? tab : 'board'}" class="${slug === g.slug ? 'active' : ''}" style="--accent:${esc(g.accent)}">${esc(g.name)}</a>`).join('');
  const app = $('#app');
  if (kind !== 'g' || !game(slug)) { app.innerHTML = overview(); return; }
  const g = game(slug);
  if (g.error) { app.innerHTML = `<p class="err pad">${esc(g.error)}</p>`; return; }
  const views = { board, progress, scores, catalog, log, journal, about: (x) => docs(x, 'about'), brand, decisions: (x) => docs(x, 'decisions') };
  app.innerHTML = `<div class="game-head" style="--accent:${esc(g.accent)}"><h1>${esc(g.name)}</h1>
      <a class="muted" href="${esc(g.url)}" target="_blank">${esc(g.repo)}</a></div>
    <nav class="tabs">${TABS.map(([t, l]) => `<a href="#/g/${g.slug}/${t}" class="${t === tab ? 'active' : ''}">${l}</a>`).join('')}</nav>
    <div class="view view-${tab}">${(views[tab] || board)(g)}</div>`;
}

document.addEventListener('input', (e) => {
  const [, , slug] = location.hash.split('/');
  const t = e.target, v = t.type === 'checkbox' ? t.checked : t.value;
  if (t.dataset.filter) state.filters[slug][t.dataset.filter] = v;
  else if (t.dataset.cat) state.filters[slug + ':cat'][t.dataset.cat] = v;
  else if (t.dataset.log) state.filters[slug + ':log'][t.dataset.log] = v;
  else return;
  const pos = t.selectionStart;
  render();
  const again = document.querySelector(`[data-${Object.keys(t.dataset)[0]}="${Object.values(t.dataset)[0]}"]`);
  if (again && t.type === 'search') { again.focus(); again.setSelectionRange(pos, pos); }
});
window.addEventListener('hashchange', render);

load().then((data) => {
  HUB = data;
  document.title = HUB.title || 'Studio Hub';
  $('#updated').textContent = `синхронизация: ${fmtDate(HUB.generatedAt)} (${ago(HUB.generatedAt)} назад)`;
  render();
}).catch((e) => { $('#app').innerHTML = `<p class="err pad">${esc(e.message)}</p>`; });
