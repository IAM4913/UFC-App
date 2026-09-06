// ==UserScript==
// @name         Yahoo Draft -> Draft Command sync
// @namespace    draft-command
// @version      2.0
// @description  Watches the Yahoo Fantasy draft room (2026 React client) and pushes picks to the local Draft Command server.
// @match        https://football.fantasysports.yahoo.com/draftclient/*
// @match        https://football.fantasysports.yahoo.com/betadraftclient/*
// @match        https://football.fantasysports.yahoo.com/f1/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/* HOW IT WORKS (runs in the page context: @grant none, so React internals are visible)
   Layer 1: Redux store. Yahoo's 2026 draft room is React+Redux mounted at #main-0-DraftClientBootstrap-Proxy. The script walks
            React fibers from the root to find the store, then reads state.draftPicks.order[{id,teamId,playerId}] and
            state.players.byId[pid]{fname,lname,primary_pos,team_abbr} -> exact pick order with names. Also reads
            draftOrder.currentPick/currentTeam and context.managerId to know whose turn it is.
   Layer 2: DOM. Every .ys-player[data-id] element ("Name Was - WR") inside board cells (.ys-team), plus the turn banner
            ("Your Turn • Round R, Pick P" / "X's Pick • You're up in N Picks • Round R, Pick P").
   Layer 3: Text heuristic on any list with pick markers (1.07 / Round 1, Pick 7) and known player names.
   Every 1.5 s the ordered pick list is POSTed to http://localhost:3000/api/sync (server adds CORS headers; Chrome allows
   https->http://localhost). The app appends only new picks, so resending is harmless.
   The badge at the bottom-right shows which layer is working. Keep this tab visible (Chrome throttles background tabs). */

(function () {
  'use strict';
  const SERVER = 'http://localhost:3000';
  const INTERVAL_MS = 1500;
  let knownNames = [];  // from server, for the text heuristic
  let normIndex = [];
  let lastSig = '';
  let store = null;
  let badge;

  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[.'`’]/g, '').replace(/-/g, ' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

  function setBadge(msg, ok) {
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'draft-command-badge';
      badge.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:2147483647;background:#111;color:#eee;font:12px/1.3 sans-serif;padding:6px 10px;border-radius:6px;border:1px solid #444;max-width:340px;opacity:.92;pointer-events:none';
      document.body.appendChild(badge);
    }
    badge.textContent = 'Draft Command: ' + msg;
    badge.style.borderColor = ok ? '#4fd1c5' : '#fc8181';
  }
  async function api(method, path, data) {
    const r = await fetch(SERVER + path, { method, headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined });
    return r.json();
  }

  // ---------- Layer 1: Redux store via React fibers ----------
  function findStore() {
    if (store && typeof store.getState === 'function') return store;
    const roots = [document.getElementById('main-0-DraftClientBootstrap-Proxy'), document.getElementById('app'), document.body].filter(Boolean);
    for (const root of roots) {
      const key = Object.keys(root).find(k => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'));
      if (!key) continue;
      let fiber = root[key];
      const queue = [fiber];
      const seen = new Set();
      let n = 0;
      while (queue.length && n++ < 200000) {
        const f = queue.shift();
        if (!f || seen.has(f)) continue;
        seen.add(f);
        const props = f.memoizedProps;
        if (props && props.store && typeof props.store.getState === 'function') { store = props.store; return store; }
        if (props && props.value && typeof props.value === 'object' && props.value.store && typeof props.value.store.getState === 'function') { store = props.value.store; return store; }
        if (f.child) queue.push(f.child);
        if (f.sibling) queue.push(f.sibling);
      }
    }
    return null;
  }
  function picksFromStore() {
    const st = findStore();
    if (!st) return null;
    let state;
    try { state = st.getState(); } catch (e) { return null; }
    if (!state || !state.draftPicks || !state.players) return null;
    const order = state.draftPicks.order || state.draftPicks.list || [];
    const byId = state.players.byId || {};
    const picks = [];
    order.forEach((pk, i) => {
      const pid = pk.playerId || pk.player_id || pk.pid;
      if (!pid) return;
      const p = byId[pid] || {};
      const name = p.fname && p.lname ? `${p.fname} ${p.lname}`.trim() : (p.name || p.display_name || '');
      if (!name) return;
      picks.push({ pick: pk.pick || pk.id || i + 1, name, pos: p.primary_pos || p.pos || '', team: (p.team_abbr || p.team || '').toUpperCase(), teamId: pk.teamId });
    });
    const info = {};
    try {
      info.currentPick = state.draftOrder && state.draftOrder.currentPick;
      info.currentTeam = state.draftOrder && state.draftOrder.currentTeam;
      info.myManagerId = state.context && state.context.managerId;
      const mgr = state.league && state.league.managers && info.myManagerId != null ? state.league.managers[info.myManagerId] : null;
      info.myTeamId = mgr ? mgr.teamId : undefined;
      info.myTurn = info.myTeamId != null && info.currentTeam != null && String(info.myTeamId) === String(info.currentTeam);
      info.seconds = state.countdown && state.countdown.seconds;
      info.status = state.draftStatus;
    } catch (e) { /* ignore */ }
    return { picks, info, layer: 'redux' };
  }

  // ---------- Layer 2: DOM (.ys-player inside .ys-team board cells) ----------
  function parseYsPlayer(el) {
    // Text like "Terry McLaurin Was - WR" with <abbr> for team and position.
    const abbrs = Array.from(el.querySelectorAll('abbr'));
    let name = (el.textContent || '').trim();
    let team = '', pos = '';
    if (abbrs.length >= 2) { team = abbrs[0].textContent.trim().toUpperCase(); pos = abbrs[1].textContent.trim().toUpperCase(); }
    else {
      const m = name.match(/^(.*?)\s+([A-Za-z]{2,3})\s*-\s*(QB|RB|WR|TE|K|DEF|D\/ST)\s*$/i);
      if (m) { name = m[1]; team = m[2].toUpperCase(); pos = m[3].toUpperCase(); }
    }
    abbrs.forEach(a => { name = name.replace(a.textContent, ''); });
    name = name.replace(/\s*-\s*$/, '').replace(/\s+/g, ' ').trim();
    if (pos === 'D/ST') pos = 'DEF';
    if (pos === 'DEF' && !/D\/ST|DEF/i.test(name)) name = name + ' D/ST';
    return { name, team, pos, id: el.getAttribute('data-id') };
  }
  function picksFromDom() {
    const cells = Array.from(document.querySelectorAll('.ys-team .ys-player[data-id], .ys-team [data-id]'));
    const list = [];
    const seen = new Set();
    cells.forEach(el => {
      const p = parseYsPlayer(el);
      if (!p.name || !p.pos || seen.has(p.id || p.name)) return;
      seen.add(p.id || p.name);
      list.push(p);
    });
    if (list.length) return { picks: list.map((p, i) => Object.assign({ pick: i + 1 }, p)), info: bannerInfo(), layer: 'dom(.ys-team)', unordered: true };
    return null;
  }
  function bannerInfo() {
    const t = document.body.innerText || '';
    const info = {};
    const mine = t.match(/Your Turn\s*[•·-]\s*Round\s*(\d+),\s*Pick\s*(\d+)/i);
    const other = t.match(/([^\n•·]+?)'s Pick\s*[•·-]\s*You're up in\s*(\d+)\s*Picks?\s*[•·-]\s*Round\s*(\d+),\s*Pick\s*(\d+)/i);
    if (mine) { info.myTurn = true; info.round = +mine[1]; info.pickNo = +mine[2]; }
    else if (other) { info.myTurn = false; info.onClock = other[1].trim(); info.picksUntilMe = +other[2]; info.round = +other[3]; info.pickNo = +other[4]; }
    return info;
  }

  // ---------- Layer 3: text heuristic ----------
  function extractNames(el) {
    const lines = (el.innerText || el.textContent || '').split(/\n+/);
    const out = [], markers = [];
    lines.forEach(line => {
      let masked = ' ' + norm(line) + ' ';
      const hits = [];
      for (const { n, name } of normIndex) {
        const needle = ' ' + n + ' ';
        const at = masked.indexOf(needle);
        if (at < 0) continue;
        masked = masked.slice(0, at) + ' '.repeat(needle.length) + masked.slice(at + needle.length);
        hits.push({ at, name });
      }
      hits.sort((a, b) => a.at - b.at);
      const m = line.match(/(?:round\s*(\d+)[^\d]{0,12}pick\s*(\d+))|(?:\b(\d{1,2})\.(\d{2})\b)|(?:pick\s*#?\s*(\d+))/i);
      const key = m ? (m[1] ? +m[1] * 100 + +m[2] : m[3] ? +m[3] * 100 + +m[4] : +m[5]) : null;
      hits.forEach(h => { out.push(h.name); if (key != null) markers.push(key); });
    });
    let newestFirst = false;
    if (markers.length >= 2) { let d = 0, a = 0; for (let i = 1; i < markers.length; i++) (markers[i] < markers[i - 1] ? d++ : a++); newestFirst = d > a; }
    const seen = new Set(), dedup = [];
    (newestFirst ? out.slice().reverse() : out).forEach(n => { if (!seen.has(n)) { seen.add(n); dedup.push(n); } });
    return { list: dedup, markers: markers.length };
  }
  function picksFromText() {
    if (!normIndex.length) return null;
    let best = null;
    for (const el of document.querySelectorAll('div, section, ul, ol, table, tbody')) {
      const t = el.textContent || '';
      if (t.length < 20 || t.length > 200000) continue;
      if (!/\b\d{1,2}\.\d{2}\b|round\s*\d+|pick\s*#?\d+/i.test(t)) continue;
      const r = extractNames(el);
      if (r.list.length >= 3 && r.markers >= 2 && (!best || t.length < best.len)) best = { r, len: t.length };
    }
    if (!best) return null;
    return { picks: best.r.list.map((name, i) => ({ pick: i + 1, name })), info: bannerInfo(), layer: 'text' };
  }

  async function tick() {
    if (!knownNames.length) {
      try { const d = await api('GET', '/api/players'); knownNames = (d && d.names) || []; normIndex = knownNames.map(n => ({ n: norm(n), name: n })).filter(x => x.n.length >= 4).sort((a, b) => b.n.length - a.n.length); }
      catch (e) { setBadge('server not reachable at ' + SERVER + ' (run: node server.js)', false); return; }
    }
    const result = picksFromStore() || picksFromDom() || picksFromText();
    if (!result) { setBadge('waiting for the draft room to load picks…', false); return; }
    const payload = { picks: result.picks, names: result.picks.map(p => p.name), info: result.info || {}, layer: result.layer, unordered: !!result.unordered };
    const sig = JSON.stringify([payload.names, payload.info.currentPick, payload.info.pickNo, payload.info.myTurn]);
    if (sig === lastSig) { setBadge(`${result.picks.length} picks (up to date) via ${result.layer}${payload.info.myTurn ? ' — YOUR TURN' : ''}`, true); return; }
    try {
      const resp = await api('POST', '/api/sync', payload);
      lastSig = sig;
      setBadge(`${result.picks.length} picks via ${result.layer}${resp && resp.added ? ', +' + resp.added + ' new' : ''}${payload.info.myTurn ? ' — YOUR TURN' : ''}`, true);
    } catch (e) { setBadge('POST failed: ' + e.message, false); }
  }
  setInterval(() => { tick().catch(e => setBadge('error: ' + e.message, false)); }, INTERVAL_MS);
  setBadge('loaded, looking for picks…', false);
})();
