// ==UserScript==
// @name         Yahoo Draft -> Draft Command sync
// @namespace    draft-command
// @version      1.0
// @description  Watches the Yahoo Fantasy draft room and pushes drafted player names to the local Draft Command server (node server.js).
// @match        https://football.fantasysports.yahoo.com/*
// @match        https://*.fantasysports.yahoo.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

/* HOW IT WORKS
   1. Fetches the player-name list from the local server (http://localhost:3000/api/players).
   2. Every 2 seconds looks for the "draft results / picks" area of the draft room and extracts player names in pick order.
      It first tries the CSS selectors in SELECTORS; if none match it falls back to a heuristic: the smallest element that
      contains 3+ known player names AND pick markers (1.07, "Pick 7", "Round 1").
   3. POSTs the ordered list to /api/sync. The app appends anything new. Sending the same list twice is harmless.
   If nothing syncs: open DevTools, right-click the draft results list -> Inspect, copy a class name from the container,
   and add it to SELECTORS below (e.g. '.ys-draft-results'). The on-page badge (bottom-right) shows what the script sees. */

(function () {
  'use strict';
  const SERVER = 'http://localhost:3000';
  const SELECTORS = [
    '[class*="draft-results"]', '[class*="DraftResults"]', '[class*="draftresults"]', '[id*="draftresults"]',
    '[class*="draft-picks"]', '[class*="DraftPicks"]', '[class*="pick-list"]', '[class*="PickList"]', '[class*="picks-list"]',
    '[data-tst*="draft-results"]', '[data-tst*="picks"]',
  ];
  const NEWEST_FIRST_HINT = null; // set true/false to force ordering if auto-detection gets it wrong

  let names = [];      // canonical names from the server
  let normIndex = [];  // [{norm, name}]
  let lastSent = '';
  let badge;

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[.'`’]/g, '').replace(/-/g, ' ').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
      .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function gm(method, url, data) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url, data: data ? JSON.stringify(data) : undefined, headers: { 'Content-Type': 'application/json' },
        onload: r => { try { resolve(JSON.parse(r.responseText)); } catch (e) { resolve(null); } }, onerror: reject, ontimeout: reject, timeout: 5000,
      });
    });
  }
  function setBadge(msg, ok) {
    if (!badge) {
      badge = document.createElement('div');
      badge.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:999999;background:#111;color:#eee;font:12px/1.3 sans-serif;padding:6px 10px;border-radius:6px;border:1px solid #444;max-width:320px;opacity:.9;pointer-events:none';
      document.body.appendChild(badge);
    }
    badge.textContent = 'Draft Command sync: ' + msg;
    badge.style.borderColor = ok ? '#4fd1c5' : '#fc8181';
  }

  function textOf(el) { return (el.innerText || el.textContent || ''); }

  // Extract known player names from an element's text in order of appearance, one line at a time.
  function extractNames(el) {
    const lines = textOf(el).split(/\n+/);
    const out = [];
    const markers = [];
    lines.forEach(line => {
      const nl = ' ' + norm(line) + ' ';
      let masked = nl;
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
    let newestFirst = NEWEST_FIRST_HINT;
    if (newestFirst == null && markers.length >= 2) {
      let desc = 0, asc = 0;
      for (let i = 1; i < markers.length; i++) (markers[i] < markers[i - 1] ? desc++ : asc++);
      newestFirst = desc > asc;
    }
    const dedup = [];
    const seen = new Set();
    (newestFirst ? out.slice().reverse() : out).forEach(n => { if (!seen.has(n)) { seen.add(n); dedup.push(n); } });
    return { list: dedup, markers: markers.length };
  }

  function findResultsContainer() {
    for (const sel of SELECTORS) {
      const els = document.querySelectorAll(sel);
      for (const el of els) { const r = extractNames(el); if (r.list.length >= 1) return { el, sel, r }; }
    }
    // Heuristic: candidates are elements with pick markers and several names; choose the smallest such element.
    let best = null;
    const all = document.querySelectorAll('div, section, ul, ol, table, tbody');
    for (const el of all) {
      const t = el.textContent || '';
      if (t.length < 20 || t.length > 200000) continue;
      if (!/\b\d{1,2}\.\d{2}\b|round\s*\d+|pick\s*#?\d+/i.test(t)) continue;
      const r = extractNames(el);
      if (r.list.length >= 3 && r.markers >= 2) {
        if (!best || t.length < best.len) best = { el, sel: 'heuristic', r, len: t.length };
      }
    }
    return best;
  }

  async function tick() {
    if (!names.length) {
      try { const d = await gm('GET', SERVER + '/api/players'); names = (d && d.names) || []; normIndex = names.map(n => ({ n: norm(n), name: n })).filter(x => x.n.length >= 4).sort((a, b) => b.n.length - a.n.length); }
      catch (e) { setBadge('server not reachable at ' + SERVER + ' (run node server.js)', false); return; }
      if (!names.length) { setBadge('server returned no player names', false); return; }
    }
    const found = findResultsContainer();
    if (!found) { setBadge('waiting for draft results list (' + names.length + ' names loaded)', false); return; }
    const list = found.r.list;
    const sig = list.join('|');
    if (sig !== lastSent) {
      try { const resp = await gm('POST', SERVER + '/api/sync', { names: list }); lastSent = sig; setBadge(`${list.length} picks seen via ${found.sel}${resp && resp.added ? ', +' + resp.added + ' new' : ''}`, true); }
      catch (e) { setBadge('POST failed: ' + e, false); }
    } else setBadge(`${list.length} picks (up to date) via ${found.sel}`, true);
  }
  setInterval(() => { tick().catch(e => setBadge('error: ' + e, false)); }, 2000);
})();
