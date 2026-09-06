#!/usr/bin/env node
/* Local sync server: serves the app and relays picks from the Yahoo userscript to the app via SSE.
   Usage: node server.js [port]   (default 3000) */
const http = require('http');
const fs = require('fs');
const path = require('path');

// Load .env (KEY=VALUE lines) without a dependency; real environment variables win.
try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) return;
    let v = m[2]; if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  });
} catch (e) { /* no .env */ }

const PORT = parseInt(process.argv[2] || process.env.PORT || '3000', 10);
const CHAT_MODEL = process.env.CHAT_MODEL || 'claude-opus-5';
const CHAT_EFFORT = process.env.CHAT_EFFORT || 'medium';
let Anthropic = null;
try { Anthropic = require('@anthropic-ai/sdk'); } catch (e) { Anthropic = null; }
const chatReady = () => !!(Anthropic && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN));
const chatReason = () => !Anthropic ? 'run npm install (missing @anthropic-ai/sdk)' : 'ANTHROPIC_API_KEY missing: add it to .env next to server.js and restart';
let anthropicClient = null;
function getClient() { if (!anthropicClient) anthropicClient = new Anthropic(); return anthropicClient; }
const APP_DIR = path.join(__dirname, 'app');
const LOG = path.join(__dirname, 'draft-log.json');

let names = []; // ordered list of drafted player names, as reported by the userscript / app
let details = {}; // name -> {pos, team} when known
let info = {};    // latest draft-room info from the userscript (current pick, whose turn)
try { names = JSON.parse(fs.readFileSync(LOG, 'utf8')).names || []; } catch (e) { names = []; }
const clients = new Set();

function persist() { try { fs.writeFileSync(LOG, JSON.stringify({ names, updated: new Date().toISOString() }, null, 2)); } catch (e) { /* ignore */ } }
function broadcast() {
  const msg = `event: picks\ndata: ${JSON.stringify({ names, details, info })}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch (e) { clients.delete(res); } }
}
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}
function json(res, code, obj) { cors(res); res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function body(req) { return new Promise((resolve) => { let b = ''; req.on('data', c => { b += c; if (b.length > 5e6) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } }); }); }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.md': 'text/plain; charset=utf-8' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  if (url.pathname === '/api/events') {
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write(`event: picks\ndata: ${JSON.stringify({ names, details, info })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { clearInterval(ping); } }, 15000);
    req.on('close', () => { clients.delete(res); clearInterval(ping); });
    return;
  }
  if (url.pathname === '/api/state') return json(res, 200, { names, details, info, count: names.length });
  if (url.pathname === '/api/chat/status') return json(res, 200, { ready: chatReady(), model: CHAT_MODEL, effort: CHAT_EFFORT, reason: chatReady() ? '' : chatReason() });
  if (url.pathname === '/api/chat' && req.method === 'POST') {
    if (!chatReady()) return json(res, 503, { error: chatReason() });
    const b = await body(req);
    const messages = (Array.isArray(b.messages) ? b.messages : []).filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map(m => ({ role: m.role, content: m.content }));
    if (!messages.length || messages[messages.length - 1].role !== 'user') return json(res, 400, { error: 'messages must end with a user turn' });
    const system = [
      { type: 'text', text: String(b.staticContext || 'You are a fantasy football draft advisor.'), cache_control: { type: 'ephemeral' } },
      { type: 'text', text: '=== DRAFT CONTEXT (live) ===\n' + String(b.context || '') + '\n=== END CONTEXT ===' },
    ];
    cors(res);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (ev, data) => { try { res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); } catch (e) { /* client gone */ } };
    const client = getClient();
    const base = { model: CHAT_MODEL, max_tokens: 2000, system, messages, output_config: { effort: CHAT_EFFORT } };
    async function run(withFallbacks) {
      // Server-side refusal fallbacks (recommended for claude-opus-5); retried without if the API rejects the beta.
      const stream = withFallbacks
        ? client.beta.messages.stream(Object.assign({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, base))
        : client.messages.stream(base);
      stream.on('text', (delta) => send('delta', { text: delta }));
      const final = await stream.finalMessage();
      send('done', { stop_reason: final.stop_reason, usage: final.usage, model: final.model });
    }
    try {
      try { await run(true); }
      catch (e) {
        if (e && e.status === 400 && /fallback|beta|betas/i.test(String(e.message))) await run(false); else throw e;
      }
    } catch (e) {
      const msg = e && e.status ? `API error ${e.status}: ${e.message}` : String(e && e.message || e);
      console.error('chat error:', msg);
      send('error', { message: msg });
    }
    return res.end();
  }
  if (url.pathname === '/api/players') {
    // Player names for the userscript matcher.
    try {
      const src = fs.readFileSync(path.join(APP_DIR, 'players.js'), 'utf8');
      const m = src.match(/window\.PLAYER_DATA\s*=\s*(\{[\s\S]*?\});\s*\n/);
      const data = m ? Function('"use strict"; return (' + m[1] + ')')() : { players: [] };
      return json(res, 200, { names: data.players.map(p => p.name) });
    } catch (e) { return json(res, 500, { error: String(e) }); }
  }
  if (url.pathname === '/api/pick' && req.method === 'POST') {
    const b = await body(req);
    const n = String(b.name || '').trim();
    if (!n) return json(res, 400, { error: 'name required' });
    if (!names.includes(n)) { names.push(n); persist(); broadcast(); }
    return json(res, 200, { ok: true, count: names.length });
  }
  if (url.pathname === '/api/sync' && req.method === 'POST') {
    // Full ordered list from the userscript. Append anything new, in order.
    const b = await body(req);
    const list = Array.isArray(b.picks) ? b.picks.map(x => ({ name: String(x.name || '').trim(), pos: x.pos || '', team: x.team || '' })).filter(x => x.name)
      : (Array.isArray(b.names) ? b.names.map(x => ({ name: String(x).trim() })).filter(x => x.name) : []);
    let added = 0;
    for (const p of list) if (!names.includes(p.name)) { names.push(p.name); details[p.name] = p; added++; }
    if (b.info && typeof b.info === 'object') info = Object.assign({ layer: b.layer, updated: Date.now() }, b.info);
    if (added || b.info) { if (added) persist(); broadcast(); }
    return json(res, 200, { ok: true, added, count: names.length });
  }
  if (url.pathname === '/api/picks' && req.method === 'DELETE') { names = []; details = {}; info = {}; persist(); broadcast(); return json(res, 200, { ok: true }); }

  // static files
  let file = url.pathname === '/' ? '/index.html' : url.pathname;
  file = path.normalize(file).replace(/^(\.\.[\/\\])+/, '');
  let full = path.join(APP_DIR, file);
  if (!fs.existsSync(full)) full = path.join(__dirname, file);
  if (!full.startsWith(__dirname) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(full).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Draft Command running at http://localhost:${PORT}`);
  console.log(`Picks so far: ${names.length}. POST /api/pick {name}, POST /api/sync {names:[...]}, DELETE /api/picks to reset.`);
  console.log(chatReady() ? `Chat ready: ${CHAT_MODEL} (effort ${CHAT_EFFORT})` : `Chat NOT ready: ${chatReason()}`);
});
