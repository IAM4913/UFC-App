/* Draft-time chatbot. Two providers:
   1. Artifact runtime `sample` capability (hosted page): claude.use('sample'), viewer pays, no key needed.
   2. Local server: POST /api/chat (server.js reads ANTHROPIC_API_KEY from .env) with an SSE text stream. */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const E = window.Engine;
  const App = window.DraftApp;
  const history = []; // {role, content}
  let provider = null; // {kind:'sample', fn} | {kind:'server', url}
  let busy = false;
  let abort = null;

  const STATIC_INSTRUCTIONS = `You are a fantasy football draft advisor sitting next to the user during a live Yahoo draft. They are on a short pick clock, so answer fast and direct.
Rules:
- Lead with the recommendation in one line (player name and position), then at most 3 short bullets of reasoning. Keep answers under 120 words unless the user asks for depth.
- Use the numbers in the DRAFT CONTEXT block (Proj, VORP, VONA, Avail%, tiers, roster needs, position outlook). Refer to them explicitly ("VORP 62, 35% chance he lasts to your next pick").
- Respect the league format in the context (team count, roster slots, scoring). Fewer teams means replacement level is high and elite positional edges matter more; more teams means depth matters.
- The context lists the user's roster, picks made so far, and the engine's top recommendations. Do not recommend a player who is already drafted. If a player the user asks about is not in the available list, say so.
- Injury and news notes in the context come from an August/September 2026 news sweep; projections and ADP are estimates. If a question hinges on something not in the context, say what you do not know rather than inventing news.
- Kickers and defenses belong in the last two rounds.
- When comparing two players, state which one and why in the first sentence.`;

  function fmtPlayerRow(r) {
    const p = r.player;
    return `${p.name} (${p.pos}${r.posRank || ''} ${p.team || ''}, ADP ${p.adp}, T${p.tier || '?'}${p.bye ? ', bye ' + p.bye : ''}) proj ${r.proj.toFixed(0)}, VORP ${r.vorp.toFixed(0)}, VONA ${r.vona.toFixed(0)}, avail@next ${Math.round(r.pAvailNext * 100)}%, score ${r.score.toFixed(1)}${p.status && p.status !== 'healthy' ? ', STATUS ' + p.status : ''}${p.notes ? ' - ' + String(p.notes).slice(0, 110) : ''}`;
  }
  function buildContext() {
    const st = App.state, c = App.calc, players = App.players();
    const s = st.settings;
    const byId = {}; players.forEach(p => { byId[p.id] = p; });
    const lines = [];
    lines.push(`LEAGUE: ${s.teams} teams, snake, ${E.totalRounds(s)} rounds. Roster: ${Object.keys(s.roster).filter(k => s.roster[k]).map(k => k + '×' + s.roster[k]).join(', ')}. Scoring: ${s.scoring.rec} PPR, pass TD ${s.scoring.pass_td}, pass yd ${s.scoring.pass_yds}/yd, rush/rec TD ${s.scoring.rush_td}/${s.scoring.rec_td}, INT ${s.scoring.pass_int}, fumble ${s.scoring.fumbles}.`);
    lines.push(`USER: draft slot ${s.myPick}. Their picks: ${c.myPickNos.join(', ')}.`);
    if (c.draftOver) lines.push('DRAFT STATUS: complete.');
    else lines.push(`DRAFT STATUS: pick #${c.currentPick} of ${c.totalPicks}, round ${c.onClock.round}. On the clock: ${c.isMyPick ? 'THE USER' : 'team slot ' + (c.onClock.teamIdx + 1)}. User's next pick: #${c.nextMyPick || 'none'}${c.picksUntilMine != null ? ' (' + c.picksUntilMine + ' picks away)' : ''}, then #${c.pickAfterNext || 'none'}.`);
    const mine = c.myPicks.map(p => `${p.name} (${p.pos} ${p.team || ''}, proj ${c.proj[p.id].toFixed(0)})`);
    lines.push(`USER ROSTER (${mine.length}): ${mine.join('; ') || 'empty'}. Open starter slots: ${E.POS.filter(p => c.starterOpen[p] > 0).map(p => p + '×' + c.starterOpen[p]).join(', ') || 'none'}${c.flexOpenN ? ', FLEX×' + c.flexOpenN : ''}.`);
    const recent = st.picks.slice(-12).map((pk, i) => { const p = byId[pk.playerId]; const n = st.picks.length - 12 + i + 1; return p ? `#${n > 0 ? n : i + 1} ${p.name} ${p.pos}` : ''; }).filter(Boolean);
    lines.push(`RECENT PICKS (last ${recent.length}): ${recent.join('; ') || 'none yet'}.`);
    const runs = E.POS.filter(p => c.runCount[p] >= 3).map(p => `${p} (${c.runCount[p]} of last 6)`);
    if (runs.length) lines.push(`POSITIONAL RUNS: ${runs.join(', ')}.`);
    lines.push('POSITION OUTLOOK (mine / need mult / best available proj / expected best at next pick / expected at pick after / replacement level / tiers left / drafted):');
    c.posSummary.forEach(ps => lines.push(`  ${ps.pos}: ${ps.myCount} / ${ps.need.toFixed(2)} / ${ps.best ? ps.best.name + ' ' + ps.best.proj.toFixed(0) : '-'} / ${ps.ebaNext.toFixed(0)} / ${ps.ebaAfter.toFixed(0)} / ${ps.replacement.toFixed(0)} / ${ps.tiers.map(t => 'T' + t.tier + ':' + t.left).join(' ')} / ${ps.drafted}`));
    lines.push('ENGINE TOP RECOMMENDATIONS NOW (best first):');
    c.recs.slice(0, 8).forEach((rec, i) => lines.push(`  ${i + 1}. ${fmtPlayerRow(rec.row)} | ${rec.reasons.slice(0, 3).join(' ')}`));
    lines.push('BEST AVAILABLE BY POSITION:');
    E.POS.forEach(pos => {
      const list = c.rows.filter(r => r.player.pos === pos).slice(0, pos === 'K' || pos === 'DEF' ? 4 : 8);
      lines.push(`  ${pos}: ` + list.map(r => fmtPlayerRow(r)).join(' || '));
    });
    return lines.join('\n');
  }
  function staticContext() {
    const notes = window.STRATEGY_NOTES || {};
    const teams = App.state.settings.teams;
    const key = teams <= 8 ? 'teams8' : teams >= 12 ? 'teams12' : 'teams10';
    return STATIC_INSTRUCTIONS + '\n\nPRE-DRAFT PLAN FOR THIS LEAGUE SIZE:\n' + (notes[key] || notes.general || '');
  }

  // ---------- providers ----------
  async function detectProvider() {
    try {
      if (window.claude && typeof window.claude.use === 'function') {
        const fn = await window.claude.use('sample');
        if (fn) { provider = { kind: 'sample', fn }; return; }
      }
    } catch (e) { /* fall through */ }
    const url = (App.state.syncUrl || ((location.hostname === 'localhost' || location.hostname === '127.0.0.1') ? location.origin : '')).replace(/\/$/, '');
    if (url) {
      try {
        const r = await fetch(url + '/api/chat/status');
        const j = await r.json();
        provider = { kind: 'server', url, ready: !!j.ready, model: j.model, reason: j.reason };
        return;
      } catch (e) { provider = { kind: 'server', url, ready: false, reason: 'server not reachable' }; return; }
    }
    provider = null;
  }
  function providerLabel() {
    if (!provider) return 'Chat needs the local server: run node server.js with ANTHROPIC_API_KEY in .env, then open http://localhost:3000';
    if (provider.kind === 'sample') return 'Connected: hosted Claude';
    if (provider.ready) return 'Connected: local server (' + (provider.model || 'Claude') + ')';
    return 'Local server found but chat is not ready: ' + (provider.reason || 'add ANTHROPIC_API_KEY to .env and restart node server.js');
  }

  async function ask(text) {
    if (busy || !text.trim()) return;
    if (!provider || (provider.kind === 'server' && !provider.ready)) { await detectProvider(); setStatus(); if (!provider || (provider.kind === 'server' && !provider.ready)) return; }
    busy = true; setStatus('thinking…');
    history.push({ role: 'user', content: text });
    addBubble('user', text);
    const el = addBubble('assistant', '…');
    const ctx = buildContext();
    const stat = staticContext();
    let out = '';
    const onText = (t) => { out = t; el.innerHTML = renderMd(t); scrollLog(); };
    try {
      if (provider.kind === 'sample') {
        const turns = history.slice(-12).map((m, i, arr) => (i === arr.length - 1 && m.role === 'user')
          ? { role: 'user', content: `${stat}\n\n=== DRAFT CONTEXT (live) ===\n${ctx}\n=== END CONTEXT ===\n\nUser question: ${m.content}` }
          : { role: m.role, content: m.content });
        abort = new AbortController();
        const res = await provider.fn(turns, { onText: (u) => onText(u.text), signal: abort.signal, cache: false, modelTier: 'default' });
        out = res.text || out;
      } else {
        abort = new AbortController();
        const res = await fetch(provider.url + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: history.slice(-12), context: ctx, staticContext: stat }), signal: abort.signal });
        if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error || ('HTTP ' + res.status)); }
        const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
        while (true) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
            const ev = (chunk.match(/^event: (.*)$/m) || [])[1]; const data = (chunk.match(/^data: (.*)$/m) || [])[1];
            if (!ev || !data) continue;
            const d = JSON.parse(data);
            if (ev === 'delta') onText(out + d.text);
            else if (ev === 'error') throw new Error(d.message || 'chat error');
          }
        }
      }
      if (!out) { out = '(no answer)'; el.innerHTML = renderMd(out); }
      history.push({ role: 'assistant', content: out });
    } catch (e) {
      const msg = (e && e.code === 'cancelled') || (e && e.name === 'AbortError') ? 'Cancelled.' : 'Error: ' + (e.message || e);
      el.innerHTML = renderMd(out ? out + '\n\n' + msg : msg);
      if (out) history.push({ role: 'assistant', content: out }); else history.pop();
    }
    busy = false; abort = null; setStatus(); scrollLog();
  }

  // ---------- UI ----------
  function addBubble(role, text) {
    const d = document.createElement('div');
    d.className = 'msg ' + role;
    d.innerHTML = renderMd(text);
    $('chatLog').appendChild(d); scrollLog();
    return d;
  }
  function scrollLog() { const l = $('chatLog'); l.scrollTop = l.scrollHeight; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function renderMd(t) {
    const lines = esc(t).split('\n');
    let html = '', inList = false;
    for (let line of lines) {
      line = line.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
      const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (m) { if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + m[1] + '</li>'; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      if (line.trim() === '') continue;
      html += '<p>' + line.replace(/^#+\s*/, '') + '</p>';
    }
    if (inList) html += '</ul>';
    return html || '<p></p>';
  }
  function setStatus(extra) { $('chatStatus').textContent = extra ? extra : providerLabel(); $('chatStatus').className = 'muted ' + (provider && (provider.kind === 'sample' || provider.ready) ? 'ok' : 'warn'); }

  const QUICK = [
    ['Who now?', 'Who should I take right now and why? Give me your top 2 with the trade-off.'],
    ['Wait or reach?', 'Which position should I take now versus wait on until my next pick, given who is likely to be gone?'],
    ['Roster check', 'Look at my roster and the picks left. What positions am I weak at, and what should my plan be for the next three picks?'],
    ['Runs', 'Is a positional run happening, and how should I react to it?'],
    ['QB/TE timing', 'When should I take my QB and TE in this league, given who is left and the number of teams?'],
  ];
  function bind() {
    $('chatQuick').innerHTML = QUICK.map((q, i) => `<button class="small" data-q="${i}">${esc(q[0])}</button>`).join('');
    $('chatQuick').addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (b) ask(QUICK[+b.dataset.q][1]); });
    const inp = $('chatInput');
    inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const t = inp.value; inp.value = ''; ask(t); } });
    $('chatSend').addEventListener('click', () => { const t = inp.value; inp.value = ''; ask(t); });
    $('chatClear').addEventListener('click', () => { history.length = 0; $('chatLog').innerHTML = ''; });
    $('chatStop').addEventListener('click', () => { if (abort) abort.abort(); });
  }
  bind();
  addBubble('assistant', 'Ask anything during the draft: "Achane or CMC?", "should I wait on TE?", "who is the best handcuff for my RB1?". I see the live board, your roster, and the engine\'s numbers.');
  detectProvider().then(setStatus);
  window.DraftChat = { ask, buildContext, detectProvider };
})();
