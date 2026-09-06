/* Draft Command UI. Depends on players.js (window.PLAYER_DATA) and engine.js (window.Engine). */
(function () {
  'use strict';
  const E = window.Engine;
  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = 'draft-command-v1';

  // ---------- state ----------
  let state = loadState();
  let players = buildPool();
  let view = { posFilter: 'ALL', sortKey: 'score', sortDir: -1, hideDrafted: true, ddIndex: 0, ddItems: [] };
  let calc = null;
  let es = null;

  function loadState() {
    let s = null;
    try { s = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (e) { s = null; }
    const settings = Object.assign(E.defaultSettings(), (s && s.settings) || {});
    settings.roster = Object.assign(E.defaultSettings().roster, settings.roster || {});
    settings.scoring = Object.assign(E.defaultSettings().scoring, settings.scoring || {});
    return { settings, picks: (s && s.picks) || [], customPlayers: (s && s.customPlayers) || null, extraPlayers: (s && s.extraPlayers) || [], syncUrl: (s && s.syncUrl) || '', yahooLeague: (s && s.yahooLeague) || null };
  }
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
  }
  function buildPool() {
    const raw = (state.customPlayers || (window.PLAYER_DATA && window.PLAYER_DATA.players) || []).concat(state.extraPlayers || []);
    const pool = E.prepare(raw);
    E.autoTiers(pool, state.settings.scoring);
    return pool;
  }
  function teamName(i) {
    const n = state.settings.teamNames && state.settings.teamNames[i];
    if (n) return n;
    return i === state.settings.myPick - 1 ? 'ME' : 'Team ' + (i + 1);
  }
  function picksWithSlots() {
    return state.picks.map((pk, i) => {
      const slot = E.slotFor(i + 1, state.settings.teams);
      return { playerId: pk.playerId, pickNo: i + 1, round: slot.round, teamIdx: pk.teamOverride != null ? pk.teamOverride : slot.teamIdx };
    });
  }
  function recompute() {
    calc = E.compute(players, picksWithSlots(), state.settings);
  }
  const byId = () => { const m = {}; players.forEach(p => { m[p.id] = p; }); return m; };

  // ---------- actions ----------
  function draftPlayer(id, teamOverride, source) {
    if (state.picks.some(p => p.playerId === id)) { toast('Already drafted'); return false; }
    if (calc.draftOver) { toast('Draft is complete'); return false; }
    state.picks.push({ playerId: id, teamOverride: teamOverride == null ? undefined : teamOverride, source: source || 'manual', ts: Date.now() });
    saveState(); renderAll();
    const p = byId()[id];
    const slot = E.slotFor(state.picks.length, state.settings.teams);
    toast(`#${state.picks.length} ${p ? p.name : id} → ${teamName(teamOverride != null ? teamOverride : slot.teamIdx)}`);
    return true;
  }
  function undoPick() {
    if (!state.picks.length) return;
    const pk = state.picks.pop();
    saveState(); renderAll();
    const p = byId()[pk.playerId];
    toast('Undid ' + (p ? p.name : pk.playerId));
  }
  function removePickAt(index) {
    const pk = state.picks[index];
    if (!pk) return;
    const p = byId()[pk.playerId];
    if (!confirm(`Remove pick #${index + 1} (${p ? p.name : pk.playerId})? Later picks shift up one slot.`)) return;
    state.picks.splice(index, 1);
    saveState(); renderAll();
  }
  function applyNames(names, source) {
    const map = {};
    players.forEach(p => { map[E.normalizeName(p.name)] = p; });
    let added = 0, unknown = [];
    for (const n of names) {
      const key = typeof n === 'string' ? E.normalizeName(n) : E.normalizeName(n.name);
      let p = map[key] || (n.id ? byId()[n.id] : null);
      if (!p) { const s = E.searchPlayers(players, key, 1); if (s.length && E.normalizeName(s[0].name) === key) p = s[0]; }
      if (!p) { unknown.push(typeof n === 'string' ? n : n.name); continue; }
      if (state.picks.some(x => x.playerId === p.id)) continue;
      if (state.picks.length >= calc.totalPicks) break;
      state.picks.push({ playerId: p.id, source: source || 'sync', ts: Date.now() });
      added++;
    }
    if (added) { saveState(); renderAll(); }
    return { added, unknown };
  }
  // Find the pool player for a Yahoo pick ({name, pos, team}); DEF matches by team abbreviation.
  function matchPlayer(pk) {
    const key = E.normalizeName(pk.name);
    if (pk.pos === 'DEF' && pk.team) { const d = players.find(p => p.pos === 'DEF' && String(p.team || '').toUpperCase() === String(pk.team).toUpperCase()); if (d) return d; }
    let p = players.find(x => E.normalizeName(x.name) === key && (!pk.pos || !x.pos || x.pos === pk.pos)) || players.find(x => E.normalizeName(x.name) === key);
    if (p) return p;
    const s = E.searchPlayers(players, key, 3).filter(x => !pk.pos || x.pos === pk.pos);
    const last = key.split(' ').pop();
    p = s.find(x => E.normalizeName(x.name).split(' ').pop() === last && (!pk.team || !x.team || String(x.team).toUpperCase() === String(pk.team).toUpperCase()));
    return p || null;
  }
  // Add a placeholder for a drafted player that is not in the projection pool, so pick numbering stays right.
  function ensurePlayer(pk) {
    let p = matchPlayer(pk);
    if (p) return p;
    const raw = { name: pk.name, pos: E.POS.includes(pk.pos) ? pk.pos : 'WR', team: pk.team || '', adp: 500, tier: 0, bye: 0, proj_pts_halfppr: 0, status: 'healthy', notes: 'Not in projections (from Yahoo)' };
    raw.id = 'yahoo-' + E.playerId(raw);
    state.extraPlayers = state.extraPlayers || [];
    state.extraPlayers.push(raw);
    players = buildPool();
    players.forEach(x => { if (x._srcTier === undefined) x._srcTier = x.tier; });
    return byId()[raw.id];
  }
  // Picks from the Yahoo API are authoritative: [{pick, name, pos, team, teamIdx}] in pick order.
  function applyYahooPicks(picks) {
    if (!Array.isArray(picks)) return { added: 0, replaced: false };
    const sorted = picks.slice().sort((a, b) => a.pick - b.pick);
    const next = [];
    sorted.forEach(pk => {
      const p = ensurePlayer(pk);
      if (!p || next.some(x => x.playerId === p.id)) return;
      const slot = E.slotFor(next.length + 1, state.settings.teams);
      const override = pk.teamIdx != null && pk.teamIdx !== slot.teamIdx && pk.teamIdx < state.settings.teams ? pk.teamIdx : undefined;
      const existing = state.picks[next.length];
      next.push(existing && existing.playerId === p.id && (existing.teamOverride === override) ? existing : { playerId: p.id, teamOverride: override, source: 'yahoo', ts: Date.now() });
    });
    const replaced = state.picks.slice(0, next.length).some((pk, i) => pk.playerId !== next[i].playerId);
    const added = Math.max(0, next.length - state.picks.length);
    if (replaced) state.picks = next; // resync: Yahoo disagrees with local picks
    else if (added) state.picks = next.concat(state.picks.slice(next.length).filter(pk => pk.source !== 'yahoo' && !next.some(x => x.playerId === pk.playerId)));
    if (replaced || added) { saveState(); renderAll(); }
    return { added, replaced };
  }
  // Settings from the Yahoo league (teams, roster, scoring, teamNames, myPick).
  function applyLeagueSettings(ls) {
    if (!ls) return;
    const s = state.settings;
    if (ls.teams) s.teams = ls.teams;
    if (ls.roster) Object.assign(s.roster, ls.roster);
    if (ls.scoring) Object.assign(s.scoring, ls.scoring);
    if (ls.teamNames && ls.teamNames.length) s.teamNames = ls.teamNames.slice();
    if (ls.myPick) s.myPick = Math.min(s.teams, Math.max(1, ls.myPick));
    players.forEach(p => { p.tier = p._srcTier != null ? p._srcTier : p.tier; });
    players = buildPool();
    players.forEach(x => { if (x._srcTier === undefined) x._srcTier = x.tier; });
    saveState(); renderAll();
  }

  // ---------- rendering ----------
  function renderAll() {
    recompute();
    renderStatus(); renderBoard(); renderRoster(); renderTable(); renderAdvice(); renderOutlook(); renderPlan(); renderPickTeam();
  }

  function renderStatus() {
    const s = state.settings;
    const c = calc;
    const parts = [];
    if (c.draftOver) parts.push(`<span class="pill">Draft complete</span>`);
    else {
      parts.push(`<span class="pill">Pick <b>${c.currentPick}</b> / ${c.totalPicks} &middot; Round ${c.onClock.round}</span>`);
      parts.push(c.isMyPick ? `<span class="pill mine">YOU ARE ON THE CLOCK</span>` : `<span class="pill hot">On the clock: ${esc(teamName(c.onClock.teamIdx))}</span>`);
      if (!c.isMyPick && c.nextMyPick) parts.push(`<span class="pill">Your next pick: #${c.nextMyPick} (${c.picksUntilMine} away)</span>`);
      else if (c.isMyPick && c.nextMyPick) parts.push(`<span class="pill">Then #${c.nextMyPick}</span>`);
    }
    parts.push(`<span class="pill muted">${s.teams} teams &middot; pick ${s.myPick} &middot; ${E.totalRounds(s)} rds &middot; ${s.scoring.rec == 1 ? 'PPR' : s.scoring.rec == 0.5 ? 'Half PPR' : s.scoring.rec == 0 ? 'Std' : s.scoring.rec + ' PPR'}</span>`);
    $('status').innerHTML = parts.join('');
    $('boardMeta').textContent = `${state.picks.length} picks`;
    $('adviceMeta').textContent = calc.isMyPick ? 'your pick now' : (calc.nextMyPick ? `planning for pick #${calc.nextMyPick}` : '');
  }

  function renderBoard() {
    const s = state.settings, teams = s.teams, rounds = calc.rounds;
    const map = byId();
    const cells = {};
    picksWithSlots().forEach((pk, i) => { cells[pk.round + ':' + pk.teamIdx] = { pk, i }; });
    let h = '<table><tr><th></th>';
    for (let t = 0; t < teams; t++) h += `<th class="${t === s.myPick - 1 ? 'me' : ''}" data-team="${t}" title="Click to rename">${esc(teamName(t))}</th>`;
    h += '</tr>';
    for (let r = 1; r <= rounds; r++) {
      h += `<tr><td class="rnd">${r}</td>`;
      for (let t = 0; t < teams; t++) {
        const c = cells[r + ':' + t];
        const isCur = !calc.draftOver && calc.onClock.round === r && calc.onClock.teamIdx === t;
        const me = t === s.myPick - 1;
        if (c) {
          const p = map[c.pk.playerId];
          h += `<td class="${me ? 'me' : ''} ${isCur ? 'cur' : ''}"><div class="cell pos-${p ? p.pos : ''}" data-index="${c.i}" title="#${c.i + 1} ${p ? p.name : ''} - click to remove"><span class="nm">${esc(p ? p.name : c.pk.playerId)}</span><span class="pt">${p ? p.pos + ' ' + (p.team || '') : ''} &middot; ${c.i + 1}</span></div></td>`;
        } else {
          h += `<td class="${me ? 'me' : ''} ${isCur ? 'cur' : ''}"><div class="cell"><span class="pt">${E.pickNoFor(r, t, teams)}</span></div></td>`;
        }
      }
      h += '</tr>';
    }
    h += '</table>';
    $('board').innerHTML = h;
    // auto-scroll to current round
    const cur = $('board').querySelector('td.cur');
    if (cur) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderRoster() {
    const s = state.settings;
    const mine = calc.myPicks.slice();
    const slots = [];
    const order = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SFLEX', 'K', 'DEF', 'BN'];
    const elig = { FLEX: ['RB', 'WR', 'TE'], SFLEX: ['QB', 'RB', 'WR', 'TE'] };
    const used = new Set();
    order.forEach(slot => {
      const n = Number(s.roster[slot]) || 0;
      for (let i = 0; i < n; i++) {
        let pick = null;
        if (slot === 'BN') pick = mine.find(p => !used.has(p.id));
        else {
          const ok = elig[slot] || [slot];
          // best remaining projected player eligible for the slot
          const cands = mine.filter(p => !used.has(p.id) && ok.includes(p.pos)).sort((a, b) => calc.proj[b.id] - calc.proj[a.id]);
          pick = cands[0] || null;
        }
        if (pick) used.add(pick.id);
        slots.push({ slot, p: pick });
      }
    });
    $('roster').innerHTML = slots.map(x => x.p
      ? `<div class="slot"><span class="lab">${x.slot === 'FLEX' ? 'W/R/T' : x.slot === 'SFLEX' ? 'Q/W/R/T' : x.slot}</span><span class="badge ${x.p.pos}">${x.p.pos}</span><span>${esc(x.p.name)}</span><span class="muted" style="margin-left:auto">${calc.proj[x.p.id].toFixed(0)}</span></div>`
      : `<div class="slot empty"><span class="lab">${x.slot === 'FLEX' ? 'W/R/T' : x.slot === 'SFLEX' ? 'Q/W/R/T' : x.slot}</span><span>—</span></div>`).join('');
    const total = mine.reduce((t, p) => t + calc.proj[p.id], 0);
    $('rosterMeta').textContent = `${mine.length} players · ${total.toFixed(0)} proj pts`;
  }

  function renderPickTeam() {
    const sel = $('pickTeam');
    const s = state.settings;
    let h = '';
    for (let t = 0; t < s.teams; t++) h += `<option value="${t}">${esc(teamName(t))}${!calc.draftOver && calc.onClock.teamIdx === t ? ' (on the clock)' : ''}</option>`;
    sel.innerHTML = h;
    sel.value = calc.draftOver ? 0 : calc.onClock.teamIdx;
    $('pickHint').textContent = calc.draftOver ? '' : `Enter drafts to ${teamName(calc.onClock.teamIdx)}`;
  }

  const COLS = [
    ['rank', '#', 'num'], ['name', 'Player', ''], ['pos', 'Pos', ''], ['bye', 'Bye', 'num'], ['tier', 'Tier', 'num'], ['adp', 'ADP', 'num'],
    ['proj', 'Proj', 'num'], ['vorp', 'VORP', 'num'], ['vona', 'VONA', 'num'], ['pAvailNext', 'Avail', 'num'], ['score', 'Score', 'num'], ['act', '', ''],
  ];
  function renderTable() {
    const map = byId();
    let rows = calc.rows.slice();
    if (view.posFilter === 'FLEX') rows = rows.filter(r => ['RB', 'WR', 'TE'].includes(r.player.pos));
    else if (view.posFilter !== 'ALL') rows = rows.filter(r => r.player.pos === view.posFilter);
    if (!view.hideDrafted) {
      const drafted = state.picks.map((pk, i) => ({ drafted: i + 1, player: map[pk.playerId] })).filter(x => x.player)
        .filter(x => view.posFilter === 'ALL' || (view.posFilter === 'FLEX' ? ['RB', 'WR', 'TE'].includes(x.player.pos) : x.player.pos === view.posFilter));
      rows = rows.concat(drafted.map(x => ({ player: x.player, proj: calc.proj[x.player.id], vorp: 0, vona: 0, score: -999, pAvailNext: 0, drafted: x.drafted })));
    }
    const k = view.sortKey, d = view.sortDir;
    const val = r => k === 'name' ? r.player.name : k === 'pos' ? r.player.pos : k === 'adp' ? r.player.adp : k === 'tier' ? (r.player.tier || 99) : k === 'bye' ? (r.player.bye || 0) : k === 'rank' ? -r.score : r[k];
    rows.sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * d; });
    let h = '<thead><tr>' + COLS.map(c => `<th data-key="${c[0]}" class="${c[0] === k ? 'sorted' : ''}">${c[1]}${c[0] === k ? (d < 0 ? ' ▼' : ' ▲') : ''}</th>`).join('') + '</tr></thead><tbody>';
    const show = rows.slice(0, 250);
    show.forEach((r, i) => {
      const p = r.player;
      const av = r.pAvailNext;
      const avCls = av < 0.35 ? 'lo' : av < 0.7 ? 'mid' : 'hi';
      const tags = [];
      if (r.lastInTier) tags.push('<span class="tag tier">last in tier</span>');
      if (p.status && p.status !== 'healthy') tags.push(`<span class="tag warn">${esc(p.status)}</span>`);
      if (calc.runCount[p.pos] >= 3 && !r.drafted) tags.push('<span class="tag">run</span>');
      h += `<tr class="${r.drafted ? 'drafted' : ''}" style="${r.drafted ? 'opacity:.45' : ''}">
        <td class="num">${r.drafted ? '' : i + 1}</td>
        <td><span class="name">${esc(p.name)}</span>${tags.join('')}<div class="sub">${esc(p.team || '')}${p.notes ? ' · ' + esc(String(p.notes).slice(0, 70)) : ''}</div></td>
        <td><span class="badge ${p.pos}">${p.pos}</span> <span class="sub">${r.posRank ? p.pos + r.posRank : ''}</span></td>
        <td class="num">${p.bye || ''}</td>
        <td class="num">${p.tier || ''}</td>
        <td class="num">${p.adp ? p.adp.toFixed(1) : ''}</td>
        <td class="num"><b>${r.proj.toFixed(0)}</b></td>
        <td class="num">${r.drafted ? '' : r.vorp.toFixed(0)}</td>
        <td class="num">${r.drafted ? '' : r.vona.toFixed(0)}</td>
        <td class="num">${r.drafted ? '' : `<span class="avail ${avCls}">${Math.round(av * 100)}%</span>`}</td>
        <td class="num"><b>${r.drafted ? 'pick ' + r.drafted : r.score.toFixed(1)}</b></td>
        <td>${r.drafted ? '' : `<button class="small draft-btn" data-id="${p.id}">Draft</button>`}</td>
      </tr>`;
    });
    h += '</tbody>';
    $('players').innerHTML = h;
  }

  function renderAdvice() {
    const c = calc;
    if (c.draftOver) { $('advice').innerHTML = '<div class="muted">Draft complete. Good luck this season.</div>'; return; }
    let h = '';
    if (c.mustFill) h += `<div class="rec" style="border-left-color:var(--danger)"><b>Fill your starters:</b> you have ${c.myPickNos.filter(n => n >= c.currentPick).length} picks left and open starter slots at ${E.POS.filter(p => c.starterOpen[p] > 0).map(p => p + '×' + c.starterOpen[p]).join(', ') || 'none'}.</div>`;
    const runs = E.POS.filter(p => c.runCount[p] >= 3);
    if (runs.length) h += `<div class="rec" style="border-left-color:var(--accent2)"><b>Run alert:</b> ${runs.map(p => `${c.runCount[p]} of the last 6 picks were ${p}s`).join('; ')}.</div>`;
    c.recs.slice(0, 5).forEach((rec, i) => {
      const r = rec.row, p = r.player;
      h += `<div class="rec ${i === 0 ? 'top' : ''}">
        <div class="head"><span><span class="badge ${p.pos}">${p.pos}</span> <span class="nm">${esc(p.name)}</span> <span class="muted">${esc(p.team || '')}${p.bye ? ' · bye ' + p.bye : ''}${p.tier ? ' · T' + p.tier : ''}</span></span>
          <button class="small primary draft-btn" data-id="${p.id}" data-mine="1">${c.isMyPick ? 'Draft for me' : 'Draft'}</button></div>
        <div class="stats"><span>Proj <b>${r.proj.toFixed(0)}</b></span><span>VORP <b>${r.vorp.toFixed(0)}</b></span><span>VONA <b>${r.vona.toFixed(0)}</b></span><span>Avail next <b>${Math.round(r.pAvailNext * 100)}%</b></span><span>ADP ${p.adp.toFixed(1)}</span><span>Score <b>${r.score.toFixed(1)}</b></span></div>
        <ul>${rec.reasons.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>`;
    });
    if (!c.isMyPick && c.nextMyPick) {
      // Who is likely to be there at my next pick
      const likely = c.rows.filter(r => r.pAvailNext >= 0.5).slice(0, 6);
      h += `<div class="rec"><b>Likely available at #${c.nextMyPick}</b> (≥50%): ${likely.map(r => `${esc(r.player.name)} (${Math.round(r.pAvailNext * 100)}%)`).join(', ') || 'nobody notable'}</div>`;
    }
    $('advice').innerHTML = h;
  }

  function renderOutlook() {
    const c = calc;
    let h = `<table class="pos"><tr><th>Pos</th><th>Mine</th><th>Need</th><th>Best now</th><th>Exp @${c.nextMyPick || '-'}</th><th>Exp @${c.pickAfterNext || '-'}</th><th>Repl</th><th>Tiers left</th><th>Run</th></tr>`;
    c.posSummary.forEach(s => {
      h += `<tr><td><span class="badge ${s.pos}">${s.pos}</span></td><td>${s.myCount}${s.starterOpen ? ` <span class="muted">(${s.starterOpen} open)</span>` : ''}</td><td>${s.need.toFixed(2)}</td>
        <td title="${s.best ? esc(s.best.name) : ''}">${s.best ? s.best.proj.toFixed(0) : '-'}</td><td>${s.ebaNext.toFixed(0)}</td><td>${s.ebaAfter.toFixed(0)}</td><td>${s.replacement.toFixed(0)}</td>
        <td class="muted">${s.tiers.map(t => `T${t.tier}:${t.left}`).join(' ')}</td><td class="${s.run >= 3 ? 'run' : ''}">${s.run}</td></tr>`;
    });
    h += '</table><div class="muted" style="font-size:11px;margin-top:4px">Exp = expected best projection at that position still available at your pick. Repl = replacement level (rank ' + E.POS.map(p => p + c.baseRank[p]).join(', ') + ').</div>';
    $('posOutlook').innerHTML = h;
  }

  function renderPlan() {
    const notes = window.STRATEGY_NOTES || {};
    const key = state.settings.teams >= 12 ? 'teams12' : 'teams10';
    const txt = notes[key] || notes.general || 'No strategy notes loaded.';
    const mine = calc.myPickNos;
    $('planNotes').textContent = `Your picks: ${mine.join(', ')}\n\n` + txt;
  }

  // ---------- dropdown search ----------
  function updateDropdown() {
    const q = $('search').value.trim();
    const dd = $('dropdown');
    if (!q) { dd.hidden = true; view.ddItems = []; return; }
    const drafted = new Set(state.picks.map(p => p.playerId));
    const items = E.searchPlayers(players, q, 12).filter(p => !drafted.has(p.id)).slice(0, 8);
    view.ddItems = items;
    view.ddIndex = Math.min(view.ddIndex, Math.max(items.length - 1, 0));
    if (!items.length) { dd.innerHTML = '<div class="meta">No match (already drafted or not in pool)</div>'; dd.hidden = false; return; }
    dd.innerHTML = items.map((p, i) => {
      const r = calc.rowById[p.id];
      return `<div class="${i === view.ddIndex ? 'active' : ''}" data-id="${p.id}"><span><span class="badge ${p.pos}">${p.pos}</span> ${esc(p.name)} <span class="meta">${esc(p.team || '')}</span></span><span class="meta">ADP ${p.adp.toFixed(1)} · ${r ? r.proj.toFixed(0) + ' pts · score ' + r.score.toFixed(1) : ''}</span></div>`;
    }).join('');
    dd.hidden = false;
  }
  function commitDropdown() {
    const p = view.ddItems[view.ddIndex];
    if (!p) return;
    const team = parseInt($('pickTeam').value, 10);
    const onClock = calc.draftOver ? -1 : calc.onClock.teamIdx;
    draftPlayer(p.id, team === onClock ? undefined : team, 'manual');
    $('search').value = ''; $('dropdown').hidden = true; view.ddItems = []; view.ddIndex = 0;
  }

  // ---------- settings modal ----------
  function openSettings() {
    const s = state.settings;
    const pre = $('preset');
    pre.innerHTML = '<option value="">(custom)</option>' + Object.keys(E.PRESETS).map(k => `<option value="${k}">${E.PRESETS[k].label}</option>`).join('');
    $('teams').value = s.teams; $('myPick').value = s.myPick; $('rounds').value = s.rounds || 0;
    const rf = $('rosterFields');
    const labels = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', FLEX: 'W/R/T (flex)', SFLEX: 'Q/W/R/T (superflex)', K: 'K', DEF: 'DEF', BN: 'Bench' };
    rf.innerHTML = Object.keys(labels).map(k => `<label>${labels[k]}</label><input type="number" min="0" max="10" data-roster="${k}" value="${s.roster[k] || 0}">`).join('');
    $('scoringFields').innerHTML = E.SCORING_FIELDS.map(f => `<label>${f[1]}</label><input type="number" step="0.01" data-score="${f[0]}" value="${s.scoring[f[0]] != null ? s.scoring[f[0]] : f[2]}">`).join('');
    $('teamNames').value = (s.teamNames || []).join('\n');
    $('parseResult').textContent = '';
    $('settingsModal').classList.add('open');
  }
  function applyPreset(key) {
    const p = E.PRESETS[key]; if (!p) return;
    $('teams').value = p.teams;
    document.querySelectorAll('[data-roster]').forEach(inp => { inp.value = p.roster[inp.dataset.roster] || 0; });
    document.querySelectorAll('[data-score]').forEach(inp => { inp.value = p.scoring[inp.dataset.score] != null ? p.scoring[inp.dataset.score] : 0; });
  }
  function saveSettings() {
    const s = state.settings;
    const teams = Math.max(2, parseInt($('teams').value, 10) || 10);
    s.teams = teams;
    s.myPick = Math.min(teams, Math.max(1, parseInt($('myPick').value, 10) || 1));
    s.rounds = Math.max(0, parseInt($('rounds').value, 10) || 0);
    document.querySelectorAll('[data-roster]').forEach(inp => { s.roster[inp.dataset.roster] = Math.max(0, parseInt(inp.value, 10) || 0); });
    document.querySelectorAll('[data-score]').forEach(inp => { s.scoring[inp.dataset.score] = parseFloat(inp.value) || 0; });
    s.teamNames = $('teamNames').value.split('\n').map(x => x.trim()).filter(Boolean);
    players.forEach(p => { p.tier = p._srcTier != null ? p._srcTier : p.tier; });
    players = buildPool();
    saveState(); $('settingsModal').classList.remove('open'); renderAll();
  }

  // ---------- sync ----------
  function connectSync(url) {
    if (es) { es.close(); es = null; }
    url = (url || '').replace(/\/$/, '');
    state.syncUrl = url; saveState();
    if (!url) { setSyncStatus(false, 'not connected'); return; }
    fetch(url + '/api/state').then(r => r.json()).then(st => { if (st) handlePicksEvent(st, 'Synced'); }).catch(() => {});
    es = new EventSource(url + '/api/events');
    es.onopen = () => { setSyncStatus(true, 'connected to ' + url); refreshYahoo(); };
    es.onerror = () => { setSyncStatus(false, 'connection lost, retrying…'); renderYahoo(null); };
    es.addEventListener('picks', ev => { try { handlePicksEvent(JSON.parse(ev.data), 'Auto-synced'); } catch (e) { console.error(e); } });
    es.addEventListener('yahoo', ev => {
      try {
        const st = JSON.parse(ev.data);
        if (st.settingsUpdate && st.league && state.yahooLeague === st.league.key) { applyLeagueSettings(st.settingsUpdate); toast('League settings updated from Yahoo'); }
        renderYahoo(st);
      } catch (e) { console.error(e); }
    });
  }
  function handlePicksEvent(data, verb) {
    if (data.source === 'yahoo' && Array.isArray(data.picks)) {
      const r = applyYahooPicks(data.picks);
      if (r.replaced) toast('Resynced picks from Yahoo');
      else if (r.added) toast(`${verb} ${r.added} pick${r.added > 1 ? 's' : ''} from Yahoo`);
      return;
    }
    const r = applyNames(data.names || [], 'sync');
    if (r.added) toast(`${verb} ${r.added} pick${r.added > 1 ? 's' : ''}`);
    if (r.unknown.length) console.warn('Unknown names from sync:', r.unknown);
  }
  function setSyncStatus(on, msg) { $('syncStatus').innerHTML = `<span class="dot ${on ? 'on' : ''}"></span>${esc(msg)}`; }

  // ---------- Yahoo API (via the local server) ----------
  let yahooState = null;
  function yahooApi(path, method, payload) {
    if (!state.syncUrl) return Promise.reject(new Error('Connect to the local server first'));
    return fetch(state.syncUrl + '/api/yahoo/' + path, { method: method || 'GET', headers: { 'Content-Type': 'application/json' }, body: payload ? JSON.stringify(payload) : undefined })
      .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j; });
  }
  function refreshYahoo() {
    if (!state.syncUrl) { renderYahoo(null); return Promise.resolve(null); }
    return yahooApi('status').then(st => { renderYahoo(st); if (st.authorized && !$('yahooLeague').options.length) loadYahooLeagues(); return st; }).catch(() => { renderYahoo(null); return null; });
  }
  function loadYahooLeagues() {
    const sel = $('yahooLeague');
    sel.innerHTML = '<option value="">loading…</option>';
    return yahooApi('leagues').then(r => {
      const list = r.leagues || [];
      sel.innerHTML = list.length ? list.map(l => `<option value="${esc(l.key)}">${esc(l.name)} (${esc(l.season)}, ${l.numTeams || '?'} teams, ${esc(l.draftStatus || '')})</option>`).join('') : '<option value="">no NFL leagues found</option>';
      const cur = (yahooState && yahooState.league && yahooState.league.key) || state.yahooLeague;
      if (cur && list.some(l => l.key === cur)) sel.value = cur;
    }).catch(e => { sel.innerHTML = '<option value="">could not load leagues</option>'; yahooMsg('warn', e.message); });
  }
  function yahooMsg(kind, msg) { $('yahooStatus').innerHTML = `<span class="dot ${kind === 'ok' ? 'on' : kind === 'warn' ? 'warn' : ''}"></span>${esc(msg)}`; }
  function renderYahoo(st) {
    yahooState = st;
    const server = !!(st && state.syncUrl && es && es.readyState !== 2);
    $('yahooNoServer').hidden = server;
    $('yahooCreds').hidden = !server || !!st.configured;
    $('yahooAuthRow').hidden = !server || !st.configured || !!st.authorized;
    $('yahooLeagueRow').hidden = !server || !st.authorized;
    if (!server) { yahooMsg('', 'not connected to the local server'); return; }
    if (st.redirectUri) $('yahooRedirect').value = st.redirectUri === 'oob' ? '' : st.redirectUri;
    if (!st.configured) return yahooMsg('', 'add your Yahoo app client id and secret');
    if (!st.authorized) return yahooMsg('', 'not connected to Yahoo yet');
    if (!st.league) return yahooMsg('ok', 'connected to Yahoo; choose a league');
    const lg = st.league;
    const status = { predraft: 'draft not started', draftinginprogress: 'DRAFT IN PROGRESS', postdraft: 'draft complete' }[lg.draftStatus] || lg.draftStatus;
    const when = lg.draftTime && lg.draftStatus === 'predraft' ? ' (' + new Date(lg.draftTime).toLocaleString() + ')' : '';
    const age = st.lastPoll ? Math.round((Date.now() - new Date(st.lastPoll).getTime()) / 1000) + 's ago' : 'never';
    const order = st.settings && st.settings.orderKnown ? '' : ' · draft order unknown until pick 1 (check My pick in Settings)';
    yahooMsg(st.error ? 'warn' : 'ok', `${lg.name}: ${status}${when} · ${st.picks} picks · ${st.polling ? 'watching' : 'idle'} · last check ${age}${order}` + (st.error ? ' · error: ' + st.error : ''));
    if (lg.warnings && lg.warnings.length) $('yahooStatus').innerHTML += '<div class="muted">' + lg.warnings.map(esc).join('<br>') + '</div>';
  }
  function useYahooLeague() {
    const key = $('yahooLeague').value;
    if (!key) return yahooMsg('warn', 'pick a league first');
    yahooMsg('', 'loading league…');
    yahooApi('league', 'POST', { leagueKey: key }).then(r => {
      state.yahooLeague = key; saveState();
      applyLeagueSettings(r.settings);
      toast('League settings imported from Yahoo');
      renderYahoo(r);
      return yahooApi('league').then(d => { if (d.picksDetail && d.picksDetail.length) applyYahooPicks(d.picksDetail); });
    }).catch(e => yahooMsg('warn', e.message));
  }
  function bindYahoo() {
    $('btnYahooSaveCreds').addEventListener('click', () => {
      yahooApi('config', 'POST', { clientId: $('yahooClientId').value, clientSecret: $('yahooClientSecret').value, redirectUri: $('yahooRedirect').value.trim() || 'oob' })
        .then(st => { $('yahooClientSecret').value = ''; renderYahoo(st); }).catch(e => yahooMsg('warn', e.message));
    });
    $('btnYahooEditCreds').addEventListener('click', () => { $('yahooCreds').hidden = false; });
    $('btnYahooConnect').addEventListener('click', () => {
      yahooApi('auth-url').then(r => { window.open(r.url, '_blank', 'noopener'); yahooMsg('', r.redirectUri === 'oob' ? 'approve in the Yahoo tab, then paste the code it shows' : 'approve in the Yahoo tab; if it lands on an error page copy that page\'s URL here'); })
        .catch(e => yahooMsg('warn', e.message));
    });
    $('btnYahooCode').addEventListener('click', () => {
      const code = $('yahooCode').value.trim(); if (!code) return;
      yahooMsg('', 'exchanging code…');
      yahooApi('code', 'POST', { code }).then(st => { $('yahooCode').value = ''; renderYahoo(st); loadYahooLeagues(); toast('Yahoo connected'); }).catch(e => yahooMsg('warn', e.message));
    });
    $('btnYahooRefreshLeagues').addEventListener('click', loadYahooLeagues);
    $('btnYahooUse').addEventListener('click', useYahooLeague);
    $('btnYahooPoll').addEventListener('click', () => { yahooMsg('', 'fetching…'); yahooApi('poll', 'POST').then(r => { renderYahoo(r); if (r.picks && r.source === 'yahoo') handlePicksEvent(r, 'Fetched'); }).catch(e => yahooMsg('warn', e.message)); });
    $('btnYahooStop').addEventListener('click', () => { yahooApi('league', 'DELETE').then(st => { state.yahooLeague = null; saveState(); renderYahoo(st); }).catch(e => yahooMsg('warn', e.message)); });
    $('btnYahooLogout').addEventListener('click', () => { if (!confirm('Forget the Yahoo login stored on the server?')) return; yahooApi('auth', 'DELETE').then(st => { state.yahooLeague = null; saveState(); $('yahooLeague').innerHTML = ''; renderYahoo(st); }).catch(e => yahooMsg('warn', e.message)); });
  }

  // ---------- helpers ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  let toastT = null;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.style.display = 'block'; clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, 2200); }

  // ---------- events ----------
  function bind() {
    const search = $('search');
    search.addEventListener('input', () => { view.ddIndex = 0; updateDropdown(); });
    search.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); view.ddIndex = Math.min(view.ddIndex + 1, view.ddItems.length - 1); updateDropdown(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); view.ddIndex = Math.max(view.ddIndex - 1, 0); updateDropdown(); }
      else if (e.key === 'Enter') { e.preventDefault(); commitDropdown(); }
      else if (e.key === 'Escape') { search.value = ''; $('dropdown').hidden = true; }
    });
    $('dropdown').addEventListener('mousedown', e => {
      const row = e.target.closest('[data-id]'); if (!row) return;
      view.ddIndex = view.ddItems.findIndex(p => p.id === row.dataset.id); commitDropdown();
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('.searchwrap')) $('dropdown').hidden = true;
      const btn = e.target.closest('.draft-btn');
      if (btn) { draftPlayer(btn.dataset.id, undefined, 'manual'); return; }
      const cell = e.target.closest('.board .cell[data-index]');
      if (cell) { removePickAt(parseInt(cell.dataset.index, 10)); return; }
      const th = e.target.closest('.board th[data-team]');
      if (th) {
        const t = parseInt(th.dataset.team, 10);
        const name = prompt('Team name for slot ' + (t + 1), teamName(t));
        if (name != null) { state.settings.teamNames = state.settings.teamNames || []; while (state.settings.teamNames.length < state.settings.teams) state.settings.teamNames.push(''); state.settings.teamNames[t] = name.trim(); saveState(); renderAll(); }
        return;
      }
      const sortTh = e.target.closest('table.players th[data-key]');
      if (sortTh) {
        const k = sortTh.dataset.key; if (k === 'act') return;
        if (view.sortKey === k) view.sortDir *= -1; else { view.sortKey = k; view.sortDir = (k === 'name' || k === 'pos' || k === 'adp' || k === 'tier' || k === 'rank' || k === 'bye') ? 1 : -1; }
        renderTable();
      }
      const tab = e.target.closest('#posTabs button');
      if (tab) { view.posFilter = tab.dataset.pos; renderTabs(); renderTable(); }
    });
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !isTyping(e)) { e.preventDefault(); undoPick(); }
      if (e.key === '/' && !isTyping(e)) { e.preventDefault(); search.focus(); }
      if (e.key === 'Escape') document.querySelectorAll('.modal-bg.open').forEach(m => m.classList.remove('open'));
    });
    $('hideDrafted').addEventListener('change', e => { view.hideDrafted = e.target.checked; renderTable(); });
    $('btnUndo').addEventListener('click', undoPick);
    $('btnSettings').addEventListener('click', openSettings);
    $('btnSettingsCancel').addEventListener('click', () => $('settingsModal').classList.remove('open'));
    $('btnSettingsSave').addEventListener('click', saveSettings);
    $('preset').addEventListener('change', e => applyPreset(e.target.value));
    $('btnParseSettings').addEventListener('click', () => {
      const r = E.parseYahooSettings($('settingsPaste').value);
      const done = [];
      if (r.teams) { $('teams').value = r.teams; done.push('teams=' + r.teams); }
      if (r.roster) { document.querySelectorAll('[data-roster]').forEach(inp => { inp.value = r.roster[inp.dataset.roster] || 0; }); done.push('roster'); }
      if (r.scoring) { Object.keys(r.scoring).forEach(k => { const inp = document.querySelector(`[data-score="${k}"]`); if (inp) inp.value = r.scoring[k]; }); done.push('scoring: ' + Object.keys(r.scoring).join(', ')); }
      $('parseResult').textContent = (done.length ? 'Filled ' + done.join('; ') + '. ' : '') + (r.warnings.join(' ') || '') + (done.length ? ' Click Save to apply.' : '');
    });
    $('btnResetDraft').addEventListener('click', () => { if (confirm('Clear all picks?')) { state.picks = []; saveState(); $('settingsModal').classList.remove('open'); renderAll(); } });
    $('btnSync').addEventListener('click', () => { $('syncUrl').value = state.syncUrl || (location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? location.origin : ''); $('syncModal').classList.add('open'); refreshYahoo(); });
    $('btnSyncClose').addEventListener('click', () => $('syncModal').classList.remove('open'));
    $('btnParsePicks').addEventListener('click', () => {
      const names = E.parsePastedPicks($('pastePicks').value, players);
      const r = applyNames(names, 'paste');
      $('pasteResult').textContent = `Found ${names.length} players; added ${r.added} new picks.` + (names.length === 0 ? ' No known player names found in the text.' : '');
      if (r.added) $('pastePicks').value = '';
    });
    $('btnConnect').addEventListener('click', () => connectSync($('syncUrl').value.trim()));
    $('btnImportCsv').addEventListener('click', () => {
      const r = E.importPlayersCsv($('csvPaste').value);
      if (!r.players.length) { $('csvResult').textContent = 'No players parsed. ' + r.warnings.join(' '); return; }
      state.customPlayers = r.players; state.picks = state.picks.filter(pk => r.players.some(p => p.id === pk.playerId));
      players = buildPool(); saveState(); renderAll();
      $('csvResult').textContent = `Imported ${r.players.length} players. ` + r.warnings.join(' ');
    });
    $('btnRestoreBuiltin').addEventListener('click', () => { state.customPlayers = null; state.extraPlayers = []; players = buildPool(); state.picks = state.picks.filter(pk => players.some(p => p.id === pk.playerId)); saveState(); renderAll(); $('csvResult').textContent = 'Built-in data restored.'; });
    $('btnExport').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'draft-state.json'; a.click();
    });
    $('btnImport').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      f.text().then(txt => { const s = JSON.parse(txt); state = { settings: Object.assign(E.defaultSettings(), s.settings || {}), picks: s.picks || [], customPlayers: s.customPlayers || null, extraPlayers: s.extraPlayers || [], syncUrl: s.syncUrl || '', yahooLeague: s.yahooLeague || null }; players = buildPool(); saveState(); renderAll(); toast('Imported'); }).catch(() => toast('Invalid file'));
    });
    $('btnHelp').addEventListener('click', () => $('helpModal').classList.add('open'));
    $('btnHelpClose').addEventListener('click', () => $('helpModal').classList.remove('open'));
    document.querySelectorAll('.modal-bg').forEach(m => m.addEventListener('mousedown', e => { if (e.target === m) m.classList.remove('open'); }));
  }
  function isTyping(e) { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT'); }
  function renderTabs() {
    const tabs = ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'];
    $('posTabs').innerHTML = tabs.map(t => `<button data-pos="${t}" class="${view.posFilter === t ? 'on' : ''}">${t === 'FLEX' ? 'RB/WR/TE' : t}</button>`).join('');
  }

  // ---------- init ----------
  players.forEach(p => { p._srcTier = p.tier; });
  bind(); bindYahoo(); renderTabs(); renderAll();
  if (state.syncUrl) connectSync(state.syncUrl);
  else if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') connectSync(location.origin);
  const meta = window.PLAYER_DATA && window.PLAYER_DATA.generated;
  if (meta) console.log('Player data generated', meta);
  window.DraftApp = { get state() { return state; }, get calc() { return calc; }, draftPlayer, undoPick, applyNames, applyYahooPicks, applyLeagueSettings, renderAll, players: () => players };
})();
