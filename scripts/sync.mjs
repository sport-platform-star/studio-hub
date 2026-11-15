#!/usr/bin/env node
// Studio hub sync: reads every game repo in hub.config.json through the GitHub REST API and writes
// site/data/hub.json (or site/data/hub.enc.json when HUB_PASSPHRASE is set).
//
//   HUB_TOKEN=<PAT> HUB_PASSPHRASE=<pass> node scripts/sync.mjs      # in GitHub Actions
//   node scripts/sync.mjs --plain                                    # locally, uses your `gh` login, no encryption
//
// Sources per game: issues (status:* / agent:* labels), issue comments (task.sh writes <!-- hub:event=… -->),
// issue events (status label moves, closes), commits on all branches, docs (about / brand / decisions / journal),
// brand tokens + palette, hub/catalog/*.yaml, hub/scores.jsonl.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { webcrypto as crypto } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const YAML = require('yaml');
const { marked } = require('marked');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(readFileSync(join(ROOT, 'hub.config.json'), 'utf8'));
const TOKEN = process.env.HUB_TOKEN || '';
const PASS = process.env.HUB_PASSPHRASE || '';
const PLAIN = process.argv.includes('--plain');
const now = new Date();
const sinceISO = new Date(now - (cfg.historyDays || 45) * 864e5).toISOString();
const STATUSES = ['backlog', 'todo', 'in-progress', 'review', 'blocked'];
let calls = 0;

// ---------- GitHub access: PAT via fetch, or the local `gh` CLI ----------
async function api(path, { raw = false, allow404 = false } = {}) {
  calls++;
  if (TOKEN) {
    const r = await fetch(`https://api.github.com/${path}`, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (r.status === 404 && allow404) return null;
    if (!r.ok) throw new Error(`${r.status} ${path}: ${(await r.text()).slice(0, 200)}`);
    return raw ? r.text() : r.json();
  }
  try {
    const args = ['api', path];
    if (raw) args.push('-H', 'Accept: application/vnd.github.raw');
    const out = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
    return raw ? out : JSON.parse(out);
  } catch (e) {
    const msg = String(e.stderr || e.message);
    if (allow404 && /404|Not Found/.test(msg)) return null;
    throw new Error(`gh api ${path}: ${msg.slice(0, 200)}`);
  }
}

async function paged(path, max = 20) {
  const out = [];
  for (let page = 1; page <= max; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const batch = await api(`${path}${sep}per_page=100&page=${page}`);
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

const enc = (p) => p.split('/').map(encodeURIComponent).join('/');

// The newest version of a file across the configured refs (a doc may be ahead on a work branch).
async function newestFile(repo, refs, path, { binary = false } = {}) {
  let best = null;
  for (const ref of refs) {
    const commits = await api(`repos/${repo}/commits?sha=${encodeURIComponent(ref)}&path=${enc(path)}&per_page=1`, { allow404: true });
    if (!commits || !commits.length) continue;
    const date = commits[0].commit.committer.date;
    if (!best || date > best.date) best = { ref, date };
  }
  if (!best) return null;
  if (binary) {
    const j = await api(`repos/${repo}/contents/${enc(path)}?ref=${encodeURIComponent(best.ref)}`, { allow404: true });
    if (!j || !j.content) return null;
    return { ...best, path, base64: j.content.replace(/\n/g, ''), size: j.size };
  }
  const text = await api(`repos/${repo}/contents/${enc(path)}?ref=${encodeURIComponent(best.ref)}`, { raw: true, allow404: true });
  return text == null ? null : { ...best, path, text };
}

async function listDir(repo, refs, dir) {
  const names = new Set();
  for (const ref of refs) {
    const j = await api(`repos/${repo}/contents/${enc(dir)}?ref=${encodeURIComponent(ref)}`, { allow404: true });
    if (Array.isArray(j)) j.filter((f) => f.type === 'file').forEach((f) => names.add(f.name));
  }
  return [...names].sort();
}

// ---------- helpers ----------
const day = (iso) => iso.slice(0, 10);
const cleanHtml = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+="[^"]*"/gi, '');
function md(text, repo, ref) {
  marked.setOptions({ gfm: true, breaks: false });
  let html = marked.parse(text);
  // relative links → GitHub blob URLs (images of private repos cannot load anonymously, so they become links)
  html = html.replace(/<img [^>]*src="(?!https?:|data:)([^"]+)"[^>]*>/g, (_, src) =>
    `<a class="imglink" href="https://github.com/${repo}/blob/${ref}/${src}">🖼 ${src}</a>`);
  html = html.replace(/href="(?!https?:|#|mailto:)([^"]+)"/g, (_, href) => `href="https://github.com/${repo}/blob/${ref}/${href}"`);
  return cleanHtml(html);
}
const statusOf = (labels) => {
  const s = labels.map((l) => l.name).find((n) => n.startsWith('status:'));
  return s ? s.slice(7) : null;
};
const agentsOf = (labels) => labels.map((l) => l.name).filter((n) => n.startsWith('agent:')).map((n) => n.slice(6));
const HUB_RE = /<!--\s*hub:event=(\S+)\s+agent=(\S+)\s+status=(\S+)\s*-->/;
const stripFooter = (b) => b.replace(/\n---\n_Generated by \[Claude Code\][^\n]*_\s*$/, '').trim();

function parseJournal(text) {
  // entries start with "## YYYY-MM-DD HH:MM — title"
  const parts = text.split(/\n(?=## \d{4}-\d{2}-\d{2})/).slice(1);
  return parts.map((p) => {
    const head = p.split('\n')[0].replace(/^##\s*/, '');
    const m = head.match(/^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?\s*[—-]\s*(.*)$/);
    return { date: m ? m[1] : '', time: m?.[2] || '', title: m ? m[3] : head, body: p.split('\n').slice(1).join('\n').trim() };
  });
}

function paletteFromMarkdown(text) {
  // table rows like: | role | name | `#RRGGBB` | ... |
  const seen = new Map();
  for (const line of text.split('\n')) {
    if (!line.startsWith('|')) continue;
    const m = line.match(/`(#[0-9A-Fa-f]{6})`/);
    if (!m) continue;
    const cells = line.split('|').map((c) => c.trim()).filter(Boolean);
    const i = cells.findIndex((c) => c.includes(m[1]));
    const name = (cells[i - 1] || m[1]).replace(/[*`]/g, '');
    const usage = (cells[0] || '').replace(/[*`]/g, '');
    if (!seen.has(m[1].toUpperCase())) seen.set(m[1].toUpperCase(), { name, value: m[1], usage });
  }
  return [...seen.values()];
}

// ---------- one game ----------
async function syncGame(g) {
  const repo = g.repo;
  const refs = [...(g.docRefs || ['main']), ...(process.env.HUB_EXTRA_REFS || '').split(',').filter(Boolean)];
  const info = await api(`repos/${repo}`);
  const def = info.default_branch;
  console.log(`· ${g.name} (${repo})`);

  // issues
  const rawIssues = (await paged(`repos/${repo}/issues?state=all&sort=updated&direction=desc`, 10)).filter((i) => !i.pull_request);
  const issues = rawIssues.map((i) => ({
    number: i.number, title: i.title, state: i.state, stateReason: i.state_reason,
    status: i.state === 'closed' ? 'done' : statusOf(i.labels) || 'none',
    agents: agentsOf(i.labels),
    labels: i.labels.map((l) => l.name).filter((n) => !/^(status|agent):/.test(n)),
    milestone: i.milestone?.title || null, comments: i.comments,
    createdAt: i.created_at, updatedAt: i.updated_at, closedAt: i.closed_at, url: i.html_url, author: i.user?.login,
  }));
  const byNum = Object.fromEntries(issues.map((i) => [i.number, i]));

  // comments → action log
  const comments = await paged(`repos/${repo}/issues/comments?since=${sinceISO}&sort=created&direction=desc`, 10);
  const events = [];
  for (const c of comments) {
    const n = Number(c.issue_url.split('/').pop());
    if (!byNum[n]) continue; // a PR comment
    const m = (c.body || '').match(HUB_RE);
    const body = stripFooter((c.body || '').replace(HUB_RE, '')).replace(/^\S+\s+\*\*\[\w+\]\*\*\s*/, '');
    events.push({
      ts: c.created_at, issue: n, title: byNum[n].title, url: c.html_url,
      kind: m ? m[1] : 'comment', agent: m ? m[2] : (c.user?.login || ''), status: m ? m[3] : null,
      text: body.length > 600 ? body.slice(0, 600) + '…' : body,
    });
  }
  // issue events: closes / reopens / status label moves made without task.sh
  const ievents = await paged(`repos/${repo}/issues/events?`, 5);
  for (const e of ievents) {
    if (e.created_at < sinceISO || !e.issue || e.issue.pull_request) continue;
    const n = e.issue.number;
    let kind = null, status = null;
    if (e.event === 'closed') { kind = 'closed'; status = 'done'; }
    else if (e.event === 'reopened') { kind = 'reopened'; status = 'todo'; }
    else if (e.event === 'labeled' && e.label?.name?.startsWith('status:')) { kind = 'moved'; status = e.label.name.slice(7); }
    if (!kind) continue;
    // skip when task.sh already logged the same move (a hub comment within 3 min on the same issue)
    const t = Date.parse(e.created_at);
    if (events.some((x) => x.issue === n && x.kind !== 'comment' && Math.abs(Date.parse(x.ts) - t) < 180e3)) continue;
    events.push({ ts: e.created_at, issue: n, title: e.issue.title, url: e.issue.html_url, kind, agent: e.actor?.login || '', status, text: '' });
  }
  events.sort((a, b) => b.ts.localeCompare(a.ts));

  // commits on all (or listed) branches
  let branches = await paged(`repos/${repo}/branches?`, 3);
  branches = branches.map((b) => b.name);
  if (Array.isArray(g.branches)) branches = branches.filter((b) => g.branches.includes(b));
  branches = [def, ...branches.filter((b) => b !== def)].slice(0, cfg.maxBranches || 40);
  const commits = new Map();
  for (const b of branches) {
    const list = await paged(`repos/${repo}/commits?sha=${encodeURIComponent(b)}&since=${sinceISO}`, 3);
    for (const c of list) {
      if (commits.has(c.sha)) { commits.get(c.sha).branches.push(b); continue; }
      commits.set(c.sha, {
        sha: c.sha.slice(0, 7), ts: c.commit.author.date, author: c.commit.author.name,
        msg: c.commit.message.split('\n')[0].slice(0, 160), url: c.html_url, branches: [b],
        agent: /Co-Authored-By: Claude/i.test(c.commit.message) ? 'claude' : /codex/i.test(c.commit.message) ? 'codex' : '',
      });
    }
  }
  const commitList = [...commits.values()].sort((a, b) => b.ts.localeCompare(a.ts));

  // per-day progress
  const days = [];
  for (let d = (cfg.historyDays || 45) - 1; d >= 0; d--) {
    const key = day(new Date(now - d * 864e5).toISOString());
    days.push({ date: key, commits: 0, closed: 0, opened: 0, moves: 0, done: [] });
  }
  const dmap = Object.fromEntries(days.map((d) => [d.date, d]));
  commitList.forEach((c) => dmap[day(c.ts)] && dmap[day(c.ts)].commits++);
  issues.forEach((i) => {
    if (dmap[day(i.createdAt)]) dmap[day(i.createdAt)].opened++;
    if (i.closedAt && dmap[day(i.closedAt)]) {
      dmap[day(i.closedAt)].closed++; dmap[day(i.closedAt)].done.push(i.number);
    }
  });
  events.forEach((e) => { if (['start', 'review', 'block', 'status', 'moved', 'reopen'].includes(e.kind) && dmap[day(e.ts)]) dmap[day(e.ts)].moves++; });

  // docs
  const docs = {};
  for (const [key, paths] of Object.entries(g.docs || {})) {
    if (key === 'journal') continue;
    docs[key] = [];
    for (const p of [].concat(paths)) {
      const f = await newestFile(repo, refs, p);
      if (f) docs[key].push({ path: p, ref: f.ref, updated: f.date, html: md(f.text, repo, f.ref), url: `https://github.com/${repo}/blob/${f.ref}/${p}` });
    }
  }
  let journal = [];
  if (g.docs?.journal) {
    const f = await newestFile(repo, refs, g.docs.journal);
    if (f) journal = parseJournal(f.text).reverse().slice(0, 40).map((e) => ({ ...e, html: md(e.body, repo, f.ref) }));
  }

  // brand
  let tokens = [];
  if (g.tokens) {
    const f = await newestFile(repo, refs, g.tokens);
    if (f) { try { tokens = JSON.parse(f.text).color?.tokens || []; } catch {} }
  }
  if (g.paletteFrom) {
    const f = await newestFile(repo, refs, g.paletteFrom);
    if (f) tokens = tokens.concat(paletteFromMarkdown(f.text));
  }
  const images = [];
  for (const im of g.images || []) {
    const f = await newestFile(repo, refs, im.path, { binary: true });
    if (!f || f.size > 900_000) continue;
    const ext = im.path.split('.').pop().toLowerCase();
    const mime = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext] || 'application/octet-stream';
    images.push({ caption: im.caption || im.path, src: `data:${mime};base64,${f.base64}` });
  }

  // catalog + scores
  const catalog = [];
  if (g.catalog) {
    for (const name of await listDir(repo, refs, g.catalog)) {
      if (!/\.ya?ml$/.test(name)) continue;
      const f = await newestFile(repo, refs, `${g.catalog}/${name}`);
      if (!f) continue;
      try {
        const list = YAML.parse(f.text) || [];
        for (const e of [].concat(list)) if (e && e.id) catalog.push({ ...e, file: name, ref: f.ref });
      } catch (err) { console.warn(`  catalog ${name}: ${err.message}`); }
    }
  }
  const scores = [];
  if (g.scores) {
    const f = await newestFile(repo, refs, g.scores);
    if (f) for (const line of f.text.split('\n')) {
      if (!line.trim()) continue;
      try { const s = JSON.parse(line); if (s.target && s.aspect && typeof s.score === 'number') scores.push(s); } catch {}
    }
  }

  return {
    slug: g.slug, name: g.name, tagline: g.tagline || '', repo, url: info.html_url, accent: g.accent || '#888',
    defaultBranch: def, links: g.links || [], issues, events: events.slice(0, 600), commits: commitList.slice(0, 600),
    branches, days, docs, journal, tokens, images, catalog, scores,
  };
}

// ---------- encryption (AES-GCM, key = PBKDF2-SHA256(passphrase)) ----------
async function encrypt(json, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iter = 250000;
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(json)));
  const b64 = (u) => Buffer.from(u).toString('base64');
  return JSON.stringify({ v: 1, iter, salt: b64(salt), iv: b64(iv), data: b64(data) });
}

// ---------- main ----------
const games = [];
for (const g of cfg.games) {
  try { games.push(await syncGame(g)); }
  catch (e) { console.error(`  ! ${g.name}: ${e.message}`); games.push({ slug: g.slug, name: g.name, repo: g.repo, accent: g.accent, error: e.message }); }
}
const out = JSON.stringify({ title: cfg.title, generatedAt: now.toISOString(), qualityGate: cfg.qualityGate || 9, doneVisibleDays: cfg.doneVisibleDays || 14, games });
mkdirSync(join(ROOT, 'site/data'), { recursive: true });
if (PASS) {
  writeFileSync(join(ROOT, 'site/data/hub.enc.json'), await encrypt(out, PASS));
  console.log(`wrote site/data/hub.enc.json (${(out.length / 1024).toFixed(0)} KB plain, encrypted), ${calls} API calls`);
} else if (PLAIN) {
  writeFileSync(join(ROOT, 'site/data/hub.json'), out);
  console.log(`wrote site/data/hub.json (${(out.length / 1024).toFixed(0)} KB, NOT encrypted), ${calls} API calls`);
} else {
  console.error('HUB_PASSPHRASE is not set. Refusing to write unencrypted data (use --plain for a local preview only).');
  process.exit(1);
}
