#!/usr/bin/env node
/* Local sync server: serves the app and relays picks from the Yahoo userscript to the app via SSE.
   Usage: node server.js [port]   (default 3000) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { YahooClient, DraftPoller } = require('./yahoo');

const PORT = parseInt(process.argv[2] || process.env.PORT || '3000', 10);
const APP_DIR = path.join(__dirname, 'app');
const LOG = path.join(__dirname, 'draft-log.json');

let names = []; // ordered list of drafted player names, as reported by the userscript / app
let yahooPicks = []; // when a Yahoo league is selected: picks in pick order with team slot, from the Yahoo API
let savedLeagueKey = null;
try { const saved = JSON.parse(fs.readFileSync(LOG, 'utf8')); names = saved.names || []; savedLeagueKey = saved.yahooLeagueKey || null; } catch (e) { names = []; }
const clients = new Set();

// ---------- Yahoo Fantasy API (OAuth + draft poller) ----------
const yahoo = new YahooClient(__dirname);
const poller = new DraftPoller(yahoo, {
  onLog: (m) => console.log(m),
  onUpdate: (u) => {
    if (u.picks) {
      // Yahoo is authoritative while a league is selected: the ordered pick list replaces whatever was reported before.
      yahooPicks = u.picks;
      names = u.picks.map(p => p.name);
      persist(); broadcast();
    }
    send('yahoo', Object.assign({}, poller.status(), { settingsUpdate: u.settings || null }));
  },
});
function yahooStatus() {
  return Object.assign({ configured: yahoo.configured(), authorized: yahoo.authorized(), redirectUri: yahoo.redirectUri() }, poller.status());
}

function persist() { try { fs.writeFileSync(LOG, JSON.stringify({ names, yahooLeagueKey: poller.league ? poller.league.key : null, updated: new Date().toISOString() }, null, 2)); } catch (e) { /* ignore */ } }
function send(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(msg); } catch (e) { clients.delete(res); } }
}
function picksPayload() { return poller.league ? { names, picks: yahooPicks, source: 'yahoo' } : { names }; }
function broadcast() { send('picks', picksPayload()); }
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
    res.write(`event: picks\ndata: ${JSON.stringify(picksPayload())}\n\n`);
    res.write(`event: yahoo\ndata: ${JSON.stringify(yahooStatus())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) { clearInterval(ping); } }, 15000);
    req.on('close', () => { clients.delete(res); clearInterval(ping); });
    return;
  }
  if (url.pathname === '/api/state') return json(res, 200, Object.assign(picksPayload(), { count: names.length }));
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
  if (url.pathname === '/api/picks' && req.method === 'DELETE') { names = []; yahooPicks = []; persist(); broadcast(); return json(res, 200, { ok: true }); }

  // ---- Yahoo Fantasy API ----
  if (url.pathname.startsWith('/api/yahoo/')) {
    try {
      const sub = url.pathname.slice('/api/yahoo/'.length);
      if (sub === 'status') return json(res, 200, yahooStatus());
      if (sub === 'config' && req.method === 'POST') { yahoo.saveConfig(await body(req)); return json(res, 200, yahooStatus()); }
      if (sub === 'auth-url') return json(res, 200, { url: yahoo.authUrl(), redirectUri: yahoo.redirectUri() });
      if (sub === 'code' && req.method === 'POST') {
        const b = await body(req);
        if (!b.code) return json(res, 400, { error: 'code required' });
        await yahoo.exchangeCode(b.code);
        send('yahoo', yahooStatus());
        return json(res, 200, yahooStatus());
      }
      if (sub === 'callback') {
        // Only reached when the Yahoo app's redirect URI points at this server (see README).
        const code = url.searchParams.get('code');
        if (!code) { res.writeHead(400, { 'Content-Type': 'text/html' }); return res.end('<p>Missing code. ' + (url.searchParams.get('error_description') || '') + '</p>'); }
        await yahoo.exchangeCode(code);
        send('yahoo', yahooStatus());
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<body style="font-family:system-ui;background:#0f1419;color:#e6edf3;padding:30px"><h2>Yahoo connected</h2><p>You can close this tab and go back to Draft Command.</p></body>');
      }
      if (sub === 'auth' && req.method === 'DELETE') { poller.clear(); yahoo.forgetTokens(); yahooPicks = []; persist(); send('yahoo', yahooStatus()); return json(res, 200, yahooStatus()); }
      if (sub === 'leagues') return json(res, 200, { leagues: await yahoo.leagues() });
      if (sub === 'league' && req.method === 'POST') {
        const b = await body(req);
        if (!b.leagueKey) return json(res, 400, { error: 'leagueKey required' });
        const league = await poller.select(String(b.leagueKey));
        persist(); send('yahoo', yahooStatus());
        return json(res, 200, Object.assign(yahooStatus(), { league, settings: poller.settings }));
      }
      if (sub === 'league' && req.method === 'GET') return json(res, 200, Object.assign(yahooStatus(), { league: poller.league, picksDetail: yahooPicks }));
      if (sub === 'league' && req.method === 'DELETE') { poller.clear(); yahooPicks = []; persist(); send('yahoo', yahooStatus()); return json(res, 200, yahooStatus()); }
      if (sub === 'poll' && req.method === 'POST') { if (!poller.league) return json(res, 400, { error: 'no league selected' }); await poller.poll(); if (!poller.polling) poller.start(); return json(res, 200, Object.assign(yahooStatus(), picksPayload())); }
      return json(res, 404, { error: 'unknown yahoo endpoint' });
    } catch (e) { return json(res, 500, { error: String(e.message || e) }); }
  }

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
  if (!yahoo.configured()) console.log('Yahoo API: not configured (Sync / Import → Yahoo account to add your client id/secret).');
  else if (!yahoo.authorized()) console.log('Yahoo API: configured, not connected (Sync / Import → Connect Yahoo).');
  else if (savedLeagueKey) {
    console.log('Yahoo API: resuming league ' + savedLeagueKey);
    poller.select(savedLeagueKey).catch(e => console.log('Yahoo: could not resume league: ' + e.message));
  } else console.log('Yahoo API: connected; pick a league from Sync / Import.');
});
