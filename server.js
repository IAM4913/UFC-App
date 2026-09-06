#!/usr/bin/env node
/* Local sync server: serves the app and relays picks from the Yahoo userscript to the app via SSE.
   Usage: node server.js [port]   (default 3000) */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2] || process.env.PORT || '3000', 10);
const APP_DIR = path.join(__dirname, 'app');
const LOG = path.join(__dirname, 'draft-log.json');

let names = []; // ordered list of drafted player names, as reported by the userscript / app
try { names = JSON.parse(fs.readFileSync(LOG, 'utf8')).names || []; } catch (e) { names = []; }
const clients = new Set();

function persist() { try { fs.writeFileSync(LOG, JSON.stringify({ names, updated: new Date().toISOString() }, null, 2)); } catch (e) { /* ignore */ } }
function broadcast() {
  const msg = `event: picks\ndata: ${JSON.stringify({ names })}\n\n`;
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
    res.write(`event: picks\ndata: ${JSON.stringify({ names })}\n\n`);
    clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { clearInterval(ping); } }, 15000);
    req.on('close', () => { clients.delete(res); clearInterval(ping); });
    return;
  }
  if (url.pathname === '/api/state') return json(res, 200, { names, count: names.length });
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
    const list = Array.isArray(b.names) ? b.names.map(x => String(x).trim()).filter(Boolean) : [];
    let added = 0;
    for (const n of list) if (!names.includes(n)) { names.push(n); added++; }
    if (added) { persist(); broadcast(); }
    return json(res, 200, { ok: true, added, count: names.length });
  }
  if (url.pathname === '/api/picks' && req.method === 'DELETE') { names = []; persist(); broadcast(); return json(res, 200, { ok: true }); }

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
});
