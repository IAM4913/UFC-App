/* Draft engine: scoring, value-based drafting (VBD), availability model, recommendations, parsers.
   Runs in the browser (window.Engine) and in Node (module.exports) so it can be unit tested. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
  const FLEX_ELIGIBLE = { FLEX: ['RB', 'WR', 'TE'], SFLEX: ['QB', 'RB', 'WR', 'TE'] };
  const BENCH_FACTOR = { QB: 0.15, RB: 0.5, WR: 0.5, TE: 0.15, K: 0, DEF: 0 };
  // Projections for kickers/defenses are unreliable; discount their VBD so they never look like early-round values.
  const RELIABILITY = { QB: 0.85, RB: 1, WR: 1, TE: 0.9, K: 0.3, DEF: 0.4 };

  const SCORING_FIELDS = [
    ['pass_yds', 'Passing yards (pts per yard)', 0.04],
    ['pass_td', 'Passing TD', 4],
    ['pass_int', 'Interception', -1],
    ['rush_yds', 'Rushing yards (pts per yard)', 0.1],
    ['rush_td', 'Rushing TD', 6],
    ['rec', 'Reception', 0.5],
    ['rec_yds', 'Receiving yards (pts per yard)', 0.1],
    ['rec_td', 'Receiving TD', 6],
    ['fumbles', 'Fumble lost', -2],
    ['te_rec_bonus', 'TE premium (extra pts per TE reception)', 0],
  ];

  const PRESETS = {
    yahoo_half: {
      label: 'Yahoo default (Half PPR, 10 teams, 2 WR)',
      teams: 10,
      roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SFLEX: 0, K: 1, DEF: 1, BN: 6 },
      scoring: { pass_yds: 0.04, pass_td: 4, pass_int: -1, rush_yds: 0.1, rush_td: 6, rec: 0.5, rec_yds: 0.1, rec_td: 6, fumbles: -2, te_rec_bonus: 0 },
    },
    yahoo_ppr: {
      label: 'Full PPR (10 teams, 2 WR)',
      teams: 10,
      roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SFLEX: 0, K: 1, DEF: 1, BN: 6 },
      scoring: { pass_yds: 0.04, pass_td: 4, pass_int: -1, rush_yds: 0.1, rush_td: 6, rec: 1, rec_yds: 0.1, rec_td: 6, fumbles: -2, te_rec_bonus: 0 },
    },
    yahoo_std: {
      label: 'Standard (no PPR, 10 teams, 2 WR)',
      teams: 10,
      roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SFLEX: 0, K: 1, DEF: 1, BN: 6 },
      scoring: { pass_yds: 0.04, pass_td: 4, pass_int: -1, rush_yds: 0.1, rush_td: 6, rec: 0, rec_yds: 0.1, rec_td: 6, fumbles: -2, te_rec_bonus: 0 },
    },
    half_3wr: {
      label: 'Half PPR, 10 teams, 3 WR',
      teams: 10,
      roster: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SFLEX: 0, K: 1, DEF: 1, BN: 6 },
      scoring: { pass_yds: 0.04, pass_td: 4, pass_int: -1, rush_yds: 0.1, rush_td: 6, rec: 0.5, rec_yds: 0.1, rec_td: 6, fumbles: -2, te_rec_bonus: 0 },
    },
    half_12: {
      label: 'Half PPR, 12 teams, 3 WR',
      teams: 12,
      roster: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SFLEX: 0, K: 1, DEF: 1, BN: 6 },
      scoring: { pass_yds: 0.04, pass_td: 4, pass_int: -1, rush_yds: 0.1, rush_td: 6, rec: 0.5, rec_yds: 0.1, rec_td: 6, fumbles: -2, te_rec_bonus: 0 },
    },
  };

  function defaultSettings() {
    const p = PRESETS.yahoo_half;
    return {
      teams: p.teams,
      myPick: 7,
      roster: Object.assign({}, p.roster),
      scoring: Object.assign({}, p.scoring),
      teamNames: [],
      rounds: 0, // 0 = derive from roster size
    };
  }

  function rosterSize(roster) {
    return Object.keys(roster).reduce((s, k) => s + (Number(roster[k]) || 0), 0);
  }
  function totalRounds(settings) {
    return settings.rounds && settings.rounds > 0 ? settings.rounds : rosterSize(settings.roster);
  }

  // ---------- normalization / ids ----------
  function normalizeName(s) {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[.'`’]/g, '')
      .replace(/-/g, ' ')
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function playerId(p) {
    return normalizeName(p.name).replace(/ /g, '-') + '-' + String(p.pos).toLowerCase();
  }

  // ---------- scoring ----------
  function projectPoints(p, scoring) {
    if (p.pos === 'K' || p.pos === 'DEF') return Number(p.proj_pts_halfppr || p.proj_pts || 0);
    const s = scoring;
    let pts = 0;
    pts += (p.pass_yds || 0) * (s.pass_yds || 0);
    pts += (p.pass_td || 0) * (s.pass_td || 0);
    pts += (p.pass_int || 0) * (s.pass_int || 0);
    pts += (p.rush_yds || 0) * (s.rush_yds || 0);
    pts += (p.rush_td || 0) * (s.rush_td || 0);
    pts += (p.rec || 0) * ((s.rec || 0) + (p.pos === 'TE' ? (s.te_rec_bonus || 0) : 0));
    pts += (p.rec_yds || 0) * (s.rec_yds || 0);
    pts += (p.rec_td || 0) * (s.rec_td || 0);
    pts += (p.fumbles || 0) * (s.fumbles || 0);
    // Players with no stat line but a point projection: fall back to it.
    if (pts === 0 && p.proj_pts_halfppr) return Number(p.proj_pts_halfppr);
    return Math.round(pts * 10) / 10;
  }

  // ---------- draft order ----------
  function slotFor(pickNo, teams) {
    const round = Math.ceil(pickNo / teams);
    const i = (pickNo - 1) % teams;
    const teamIdx = round % 2 === 1 ? i : teams - 1 - i;
    return { round, teamIdx, pickInRound: i + 1 };
  }
  function pickNoFor(round, teamIdx, teams) {
    const i = round % 2 === 1 ? teamIdx : teams - 1 - teamIdx;
    return (round - 1) * teams + i + 1;
  }
  function myPickNumbers(settings) {
    const rounds = totalRounds(settings);
    const out = [];
    for (let r = 1; r <= rounds; r++) out.push(pickNoFor(r, settings.myPick - 1, settings.teams));
    return out;
  }

  // ---------- availability model ----------
  // Standard normal CDF (Abramowitz-Stegun approximation).
  function phi(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
  }
  function sigmaFor(adp) { return 2.5 + 0.13 * adp; }
  // P(player is still on the board when pick `atPick` comes up), given he is still available at `currentPick`.
  function pAvailable(adp, currentPick, atPick, shift) {
    if (atPick <= currentPick) return 1;
    const a = (adp || 300) + (shift || 0);
    const s = sigmaFor(a);
    const survive = (pick) => 1 - phi((pick - 0.5 - a) / s);
    const now = Math.max(survive(currentPick), 1e-6);
    const later = survive(atPick);
    return Math.max(0, Math.min(1, later / now));
  }

  // ---------- core computation ----------
  /**
   * players: [{id,name,team,pos,adp,tier,bye,status,notes,...stats}]
   * picks: [{playerId, teamIdx, pickNo}] in pick order
   * settings: {teams, myPick, roster, scoring}
   */
  function compute(players, picks, settings) {
    const teams = settings.teams;
    const rounds = totalRounds(settings);
    const totalPicks = teams * rounds;
    const currentPick = picks.length + 1;
    const draftOver = currentPick > totalPicks;
    const myIdx = settings.myPick - 1;
    const myPickNos = myPickNumbers(settings);
    const onClock = draftOver ? null : slotFor(currentPick, teams);
    const isMyPick = !!onClock && onClock.teamIdx === myIdx;
    const futureMine = myPickNos.filter(n => n > currentPick);
    const nextMyPick = isMyPick ? (futureMine[0] || null) : (myPickNos.find(n => n >= currentPick) || null);
    const pickAfterNext = isMyPick ? (futureMine[1] || null) : (futureMine[0] || null);
    const picksUntilMine = nextMyPick ? nextMyPick - currentPick : null;

    const draftedIds = new Set(picks.map(p => p.playerId));
    const byId = {};
    players.forEach(p => { byId[p.id] = p; });

    // Projected points under this league's scoring.
    const proj = {};
    players.forEach(p => { proj[p.id] = projectPoints(p, settings.scoring); });

    const remaining = players.filter(p => !draftedIds.has(p.id));
    const byPos = {};
    const remByPos = {};
    POS.forEach(pos => {
      byPos[pos] = players.filter(p => p.pos === pos).sort((a, b) => proj[b.id] - proj[a.id]);
      remByPos[pos] = remaining.filter(p => p.pos === pos).sort((a, b) => proj[b.id] - proj[a.id]);
    });

    // Flex allocation on the full pool: starters first, then flex spots go to the best leftovers.
    const starters = {};
    POS.forEach(pos => { starters[pos] = teams * (Number(settings.roster[pos]) || 0); });
    const flexAlloc = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DEF: 0 };
    const cursor = {};
    POS.forEach(pos => { cursor[pos] = starters[pos]; });
    ['FLEX', 'SFLEX'].forEach(slot => {
      const n = teams * (Number(settings.roster[slot]) || 0);
      for (let k = 0; k < n; k++) {
        let best = null;
        FLEX_ELIGIBLE[slot].forEach(pos => {
          const cand = byPos[pos][cursor[pos]];
          if (cand && (!best || proj[cand.id] > proj[best.id])) best = cand;
        });
        if (!best) break;
        flexAlloc[best.pos]++;
        cursor[best.pos]++;
      }
    });
    const baseRank = {};
    POS.forEach(pos => {
      baseRank[pos] = Math.round(starters[pos] + flexAlloc[pos] + BENCH_FACTOR[pos] * teams);
    });

    // Replacement levels: static (full pool) and dynamic (remaining pool, shifted by what's been drafted).
    const draftedCount = {};
    POS.forEach(pos => { draftedCount[pos] = 0; });
    picks.forEach(pk => { const p = byId[pk.playerId]; if (p) draftedCount[p.pos]++; });
    const replStatic = {}, replDyn = {}, replDeep = {};
    POS.forEach(pos => {
      const full = byPos[pos];
      const rem = remByPos[pos];
      const idxS = Math.min(Math.max(baseRank[pos] - 1, 0), Math.max(full.length - 1, 0));
      replStatic[pos] = full.length ? proj[full[idxS].id] : 0;
      if (rem.length === 0) { replDyn[pos] = 0; replDeep[pos] = 0; return; }
      const idxD = Math.min(Math.max(baseRank[pos] - draftedCount[pos] - 1, 0), rem.length - 1);
      replDyn[pos] = proj[rem[idxD].id];
      // Deeper baseline (one more full round of the position) used to value bench depth.
      const idxDeep = Math.min(Math.max(baseRank[pos] + teams - draftedCount[pos] - 1, 0), rem.length - 1);
      replDeep[pos] = proj[rem[idxDeep].id];
    });

    // Positional runs: how many of the last 6 picks were at each position.
    const recent = picks.slice(-6).map(pk => byId[pk.playerId]).filter(Boolean);
    const runCount = {};
    POS.forEach(pos => { runCount[pos] = recent.filter(p => p.pos === pos).length; });
    const runShift = {};
    POS.forEach(pos => { runShift[pos] = runCount[pos] >= 3 ? -3 : 0; });

    // Availability at my next two picks.
    const pAvailNext = {}, pAvailAfter = {};
    remaining.forEach(p => {
      pAvailNext[p.id] = nextMyPick ? pAvailable(p.adp, currentPick, nextMyPick, runShift[p.pos]) : 1;
      pAvailAfter[p.id] = pickAfterNext ? pAvailable(p.adp, currentPick, pickAfterNext, runShift[p.pos]) : 1;
    });

    // Expected best available projection per position at my next pick (and the one after).
    function expectedBest(pos, pav) {
      const list = remByPos[pos];
      let remainingProb = 1, e = 0, lastProj = 0;
      for (let i = 0; i < list.length; i++) {
        const pr = pav[list[i].id];
        const pj = proj[list[i].id];
        e += pj * pr * remainingProb;
        remainingProb *= (1 - pr);
        lastProj = pj;
        if (remainingProb < 1e-4) break;
      }
      e += remainingProb * lastProj;
      return e;
    }
    const ebaNext = {}, ebaAfter = {};
    POS.forEach(pos => {
      ebaNext[pos] = nextMyPick ? expectedBest(pos, pAvailNext) : (remByPos[pos][0] ? proj[remByPos[pos][0].id] : 0);
      ebaAfter[pos] = pickAfterNext ? expectedBest(pos, pAvailAfter) : ebaNext[pos];
    });

    // My roster and needs.
    const myPicks = picks.filter(pk => pk.teamIdx === myIdx).map(pk => byId[pk.playerId]).filter(Boolean);
    const myCount = {};
    POS.forEach(pos => { myCount[pos] = myPicks.filter(p => p.pos === pos).length; });
    const roster = settings.roster;
    const starterOpen = {};
    POS.forEach(pos => { starterOpen[pos] = Math.max(0, (Number(roster[pos]) || 0) - myCount[pos]); });
    function flexOpen(slot) {
      const surplus = FLEX_ELIGIBLE[slot].reduce((s, pos) => s + Math.max(0, myCount[pos] - (Number(roster[pos]) || 0)), 0);
      return Math.max(0, (Number(roster[slot]) || 0) - surplus);
    }
    const flexOpenN = flexOpen('FLEX');
    const sflexOpenN = flexOpen('SFLEX');
    // Only count slots that can still be filled from the remaining pool.
    const fillable = pos => remByPos[pos].length > 0;
    const openStarterSlots = POS.reduce((s, pos) => s + (fillable(pos) ? starterOpen[pos] : 0), 0)
      + (FLEX_ELIGIBLE.FLEX.some(fillable) ? flexOpenN : 0) + (FLEX_ELIGIBLE.SFLEX.some(fillable) ? sflexOpenN : 0);
    const myRemainingPicks = myPickNos.filter(n => n >= currentPick).length;
    const mustFill = myRemainingPicks <= openStarterSlots;
    const rosterFull = myPicks.length >= rounds;
    // "Forced fill" baseline: if I keep filling one open starter slot per pick, the last one gets filled at this pick.
    // The expected best available then is what an open slot really costs to leave open.
    const futureMineAll = myPickNos.filter(n => n >= currentPick);
    const forcedPick = futureMineAll[Math.min(Math.max(openStarterSlots - 1, 0), futureMineAll.length - 1)] || null;
    const pAvailForced = {};
    if (forcedPick) remaining.forEach(p => { pAvailForced[p.id] = pAvailable(p.adp, currentPick, forcedPick, runShift[p.pos]); });
    const ebaForced = {};
    POS.forEach(pos => { ebaForced[pos] = forcedPick ? expectedBest(pos, pAvailForced) : ebaNext[pos]; });

    function need(pos) {
      if (rosterFull) return 0;
      const open = starterOpen[pos] > 0;
      const round = onClock ? onClock.round : rounds;
      if (pos === 'K' || pos === 'DEF') {
        if (!open) return 0;
        if (mustFill) return 1.5;
        // Only worth it in the last two rounds unless the roster is otherwise done.
        return myRemainingPicks <= 2 ? 1.0 : 0.02;
      }
      // Open starter slot: grows more urgent as the draft goes on and the pool drains.
      if (open) return mustFill ? 1.5 : Math.min(1.8, 1.0 + 0.08 * (round - 1));
      if (mustFill) return 0.2;
      if (FLEX_ELIGIBLE.FLEX.includes(pos) && flexOpenN > 0) return 0.9;
      if (FLEX_ELIGIBLE.SFLEX.includes(pos) && sflexOpenN > 0) return 0.9;
      // Bench depth: worth less with each extra body already held at the position; a 2nd QB/TE is a luxury.
      const extra = Math.max(0, myCount[pos] - (Number(roster[pos]) || 0) - (FLEX_ELIGIBLE.FLEX.includes(pos) ? 1 : 0));
      if (pos === 'QB' || pos === 'TE') return (extra === 0 ? 0.25 : 0.08);
      return 0.75 * Math.pow(0.8, extra);
    }
    const needMult = {};
    POS.forEach(pos => { needMult[pos] = need(pos); });

    // Tier bookkeeping.
    const tierLeft = {};
    POS.forEach(pos => {
      tierLeft[pos] = {};
      remByPos[pos].forEach(p => { const t = p.tier || 99; tierLeft[pos][t] = (tierLeft[pos][t] || 0) + 1; });
    });

    // Per-player metrics.
    const rows = remaining.map(p => {
      const pj = proj[p.id];
      const vorp = (pj - replDyn[p.pos]) * RELIABILITY[p.pos];
      const vorpStatic = (pj - replStatic[p.pos]) * RELIABILITY[p.pos];
      const vona = (pj - ebaNext[p.pos]) * RELIABILITY[p.pos];
      const nm = needMult[p.pos];
      // Bench picks: once the starter-level baseline gives ~0, value depth against the deeper baseline instead.
      const benchOnly = starterOpen[p.pos] === 0 && !(FLEX_ELIGIBLE.FLEX.includes(p.pos) && flexOpenN > 0);
      let vorpEff = vorp;
      if (benchOnly && (p.pos === 'RB' || p.pos === 'WR')) vorpEff = Math.max(vorp, 0.6 * (pj - replDeep[p.pos]) * RELIABILITY[p.pos], 0.5);
      else if (!benchOnly && p.pos !== 'K' && p.pos !== 'DEF') vorpEff = Math.max(vorp, (pj - ebaForced[p.pos]) * RELIABILITY[p.pos]);
      // When starters must be filled with the picks left, push those positions to the top regardless of value.
      const fillBonus = (mustFill && starterOpen[p.pos] > 0) ? 10 + 0.1 * pj : 0;
      const score = nm * (0.55 * vorpEff + 0.45 * vona) + fillBonus;
      const posRank = remByPos[p.pos].indexOf(p) + 1;
      const lastInTier = (tierLeft[p.pos][p.tier || 99] || 0) === 1;
      return {
        player: p, proj: pj, vorp, vorpStatic, vona, need: nm, score, posRank,
        pAvailNext: pAvailNext[p.id], pAvailAfter: pAvailAfter[p.id], lastInTier,
      };
    });
    rows.sort((a, b) => b.score - a.score);
    const byScore = rows;
    const rowById = {};
    rows.forEach(r => { rowById[r.player.id] = r; });

    // Recommendations with reasons.
    const recs = rows.slice(0, 8).map((r, i) => ({ row: r, reasons: explain(r, i, {
      ebaNext, replDyn, runCount, starterOpen, flexOpenN, tierLeft, remByPos, currentPick, nextMyPick, isMyPick, picksUntilMine, mustFill, proj,
    }) }));

    // Position summary for the advice panel.
    const posSummary = POS.map(pos => {
      const list = remByPos[pos];
      const tiers = Object.keys(tierLeft[pos]).map(Number).sort((a, b) => a - b).slice(0, 4)
        .map(t => ({ tier: t, left: tierLeft[pos][t] }));
      return {
        pos, remaining: list.length, drafted: draftedCount[pos], baseRank: baseRank[pos],
        replacement: replDyn[pos], best: list[0] ? { name: list[0].name, proj: proj[list[0].id] } : null,
        ebaNext: ebaNext[pos], ebaAfter: ebaAfter[pos], run: runCount[pos], tiers, need: needMult[pos],
        myCount: myCount[pos], starterOpen: starterOpen[pos],
      };
    });

    return {
      currentPick, totalPicks, rounds, draftOver, onClock, isMyPick, nextMyPick, pickAfterNext, picksUntilMine,
      myPickNos, rows, rowById, proj, replDyn, replStatic, replDeep, ebaForced, forcedPick, baseRank, flexAlloc, ebaNext, ebaAfter, runCount,
      needMult, myPicks, myCount, starterOpen, flexOpenN, sflexOpenN, mustFill, recs, posSummary, remByPos, draftedCount,
    };
  }

  function pct(x) { return Math.round(x * 100) + '%'; }

  function explain(r, rank, ctx) {
    const p = r.player;
    const out = [];
    if (rank === 0) out.push('Top overall value on the board right now.');
    out.push(`Projects ${r.proj.toFixed(0)} pts: +${r.vorp.toFixed(0)} over the ${p.pos} replacement level (${ctx.replDyn[p.pos].toFixed(0)}).`);
    if (ctx.nextMyPick) {
      const drop = r.proj - ctx.ebaNext[p.pos];
      if (drop > 0) out.push(`Expected best ${p.pos} at your next pick (#${ctx.nextMyPick}) projects ~${ctx.ebaNext[p.pos].toFixed(0)}, so waiting costs ~${drop.toFixed(0)} pts.`);
      else out.push(`A comparable ${p.pos} (~${ctx.ebaNext[p.pos].toFixed(0)} pts) should still be there at your next pick, so you can wait on this position.`);
      if (r.pAvailNext < 0.35) out.push(`Only ${pct(r.pAvailNext)} chance he lasts to your next pick.`);
      else if (r.pAvailNext > 0.7) out.push(`${pct(r.pAvailNext)} chance he is still there at #${ctx.nextMyPick}: you could take someone else first.`);
    }
    if (r.lastInTier) {
      const nextTierBest = ctx.remByPos[p.pos].find(x => (x.tier || 99) > (p.tier || 99));
      out.push(`Last player left in ${p.pos} tier ${p.tier}` + (nextTierBest ? `; next tier starts at ${nextTierBest.name} (${ctx.proj[nextTierBest.id].toFixed(0)}).` : '.'));
    }
    if (ctx.runCount[p.pos] >= 3) out.push(`${p.pos} run in progress: ${ctx.runCount[p.pos]} of the last 6 picks.`);
    if (ctx.starterOpen[p.pos] > 0) out.push(`Fills an empty ${p.pos} starter slot.`);
    else if (['RB', 'WR', 'TE'].includes(p.pos) && ctx.flexOpenN > 0) out.push('Would start at FLEX.');
    else out.push(`Bench depth at ${p.pos} (starters already filled).`);
    if (p.status && p.status !== 'healthy') out.push(`Status: ${p.status}${p.notes ? ' - ' + p.notes : ''}`);
    else if (p.notes) out.push(p.notes);
    if (ctx.mustFill) out.push('You must fill remaining starter slots with your remaining picks.');
    return out;
  }

  // ---------- search ----------
  function searchPlayers(players, query, limit) {
    const q = normalizeName(query);
    if (!q) return [];
    const qTokens = q.split(' ');
    const scored = [];
    for (const p of players) {
      const n = p._norm || (p._norm = normalizeName(p.name));
      const tokens = n.split(' ');
      let score = 0;
      if (n === q) score = 100;
      else if (n.startsWith(q)) score = 90;
      else if (n.includes(q)) score = 80;
      else {
        // every query token must prefix-match some name token (handles "j chase", "chase", "jsn" no)
        let ok = true, used = new Set();
        for (const qt of qTokens) {
          const idx = tokens.findIndex((t, i) => !used.has(i) && t.startsWith(qt));
          if (idx < 0) { ok = false; break; }
          used.add(idx);
        }
        if (ok) score = 70;
        else {
          // initials like "jsn" -> jaxon smith njigba
          const initials = tokens.map(t => t[0]).join('');
          if (qTokens.length === 1 && initials.startsWith(q) && q.length >= 2) score = 50;
        }
      }
      if (score) scored.push({ p, score: score - Math.min(p.adp || 300, 300) / 1000 });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit || 8).map(s => s.p);
  }

  // ---------- pasted draft results parser ----------
  // Finds player names in free text (Yahoo "Draft Results" copy-paste) and returns them in pick order.
  function parsePastedPicks(text, players) {
    const lines = String(text || '').split(/\r?\n/);
    const found = []; // {idx, lineNo, col, id, pickNo}
    const norms = players.map(p => ({ p, n: p._norm || (p._norm = normalizeName(p.name)) })).filter(x => x.n.length >= 4);
    // Prefer longer names first so "Michael Pittman" doesn't shadow "Michael Pittman Jr" (same person anyway) and
    // "Chase Brown" can't be matched inside another name on the same line.
    norms.sort((a, b) => b.n.length - a.n.length);
    lines.forEach((line, lineNo) => {
      const nl = ' ' + normalizeName(line) + ' ';
      let masked = nl;
      const pickMatch = line.match(/(?:round\s*(\d+)[^\d]{0,12}pick\s*(\d+))|(?:\b(\d{1,2})\.(\d{2})\b)|(?:pick\s*#?\s*(\d+))/i);
      let pickNo = null;
      for (const { p, n } of norms) {
        const needle = ' ' + n + ' ';
        const at = masked.indexOf(needle);
        if (at < 0) continue;
        masked = masked.slice(0, at) + ' '.repeat(needle.length) + masked.slice(at + needle.length);
        found.push({ lineNo, col: at, id: p.id, name: p.name, pickNo: null });
      }
      if (pickMatch) {
        if (pickMatch[1]) pickNo = { round: +pickMatch[1], pick: +pickMatch[2] };
        else if (pickMatch[3]) pickNo = { round: +pickMatch[3], pick: +pickMatch[4] };
        else if (pickMatch[5]) pickNo = { overall: +pickMatch[5] };
        found.filter(f => f.lineNo === lineNo).forEach(f => { f.pickNo = pickNo; });
      }
    });
    found.sort((a, b) => a.lineNo - b.lineNo || a.col - b.col);
    // If pick markers exist and run newest-first, reverse to chronological order.
    const marked = found.filter(f => f.pickNo);
    if (marked.length >= 2) {
      const key = f => f.pickNo.overall != null ? f.pickNo.overall : f.pickNo.round * 100 + f.pickNo.pick;
      let desc = 0, asc = 0;
      for (let i = 1; i < marked.length; i++) { if (key(marked[i]) < key(marked[i - 1])) desc++; else asc++; }
      if (desc > asc) found.reverse();
    }
    // de-dup (a name can appear in both a results list and a roster panel)
    const seen = new Set();
    return found.filter(f => { if (seen.has(f.id)) return false; seen.add(f.id); return true; })
      .map(f => ({ id: f.id, name: f.name }));
  }

  // ---------- Yahoo league settings parser ----------
  function parseYahooSettings(text) {
    const out = { warnings: [] };
    const t = String(text || '');
    const teamsM = t.match(/(?:max(?:imum)?\s+teams|number\s+of\s+teams|teams)\s*:?\s*(\d{1,2})\b/i);
    if (teamsM) out.teams = +teamsM[1];

    const rosterM = t.match(/roster\s+positions?\s*:?\s*([^\n]+)/i);
    if (rosterM) {
      const roster = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SFLEX: 0, K: 0, DEF: 0, BN: 0 };
      const map = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', K: 'K', DEF: 'DEF', 'D/ST': 'DEF', DST: 'DEF', BN: 'BN', 'W/R/T': 'FLEX', 'W/R': 'FLEX', 'R/W/T': 'FLEX', 'W/T': 'FLEX', 'Q/W/R/T': 'SFLEX', 'SUPERFLEX': 'SFLEX' };
      let any = false;
      rosterM[1].split(/[,;]+/).map(s => s.trim()).forEach(tok => {
        const m = tok.match(/^([A-Za-z\/]+)\s*(?:[x×(]\s*(\d+)\s*\)?)?$/i);
        if (!m) return;
        const key = map[m[1].toUpperCase()];
        if (!key) { if (!/^(IR|IL|IR\+|NA)$/i.test(m[1])) out.warnings.push('Unknown roster slot: ' + tok); return; }
        roster[key] += m[2] ? +m[2] : 1;
        any = true;
      });
      if (any) out.roster = roster;
    }

    const scoring = {};
    // Most specific labels first; the first label that matches a line wins (so "Reception Touchdowns" never sets "rec").
    const labels = [
      ['pass_yds', /passing\s+yards?/i], ['pass_td', /passing\s+touchdowns?/i], ['pass_int', /^\s*interceptions?\b(?!.*return)/i],
      ['rush_yds', /rushing\s+yards?/i], ['rush_td', /rushing\s+touchdowns?/i],
      ['rec_yds', /(?:reception|receiving)\s+yards?/i], ['rec_td', /(?:reception|receiving)\s+touchdowns?/i],
      ['rec', /^\s*receptions?\b/i], ['fumbles', /fumbles?\s+lost/i],
    ];
    const lines = t.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const [key, re] of labels) {
        if (!re.test(line)) continue;
        // value may be on this line or the next
        let rest = line.replace(re, '');
        let val = parseScoreValue(rest);
        if (val == null) {
          // Yahoo copies a changed row as three lines: "<Stat>", "Yahoo Default", "<league value>\t<default value>".
          const n1 = lines[i + 1] || '', n2 = lines[i + 2] || '';
          if (/^\s*yahoo default\s*$/i.test(n1)) val = parseScoreValue(n2.split('\t')[0]);
          else if (/^\s*-?\d*\.?\d+(\s|$)/.test(n1) || /yards? per point/i.test(n1)) val = parseScoreValue(n1);
        }
        if (val != null && scoring[key] === undefined) scoring[key] = val;
        break;
      }
    }
    if (Object.keys(scoring).length) out.scoring = scoring;
    if (!out.teams && !out.roster && !out.scoring) out.warnings.push('Could not find team count, roster positions, or scoring in the pasted text.');
    return out;
  }
  function parseScoreValue(s) {
    const per = s.match(/(-?\d*\.?\d+)\s*(?:yards?|yds?)\s*per\s*point/i);
    if (per) return Math.round((1 / parseFloat(per[1])) * 10000) / 10000;
    const pts = s.match(/(-?\d*\.?\d+)\s*(?:points?|pts?)?\s*(?:per\s*(?:yard|yd))/i);
    if (pts) return parseFloat(pts[1]);
    const m = s.match(/(-?\d*\.?\d+)/);
    return m ? parseFloat(m[1]) : null;
  }

  // ---------- CSV import (FantasyPros-style projections/ADP) ----------
  function parseCsv(text) {
    const rows = [];
    let cur = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
      else if (c === '"') inQ = true;
      else if (c === ',') { cur.push(field); field = ''; }
      else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
      else if (c !== '\r') field += c;
    }
    if (field.length || cur.length) { cur.push(field); rows.push(cur); }
    return rows.filter(r => r.some(x => x.trim() !== ''));
  }
  function importPlayersCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) return { players: [], warnings: ['No data rows found'] };
    const header = rows[0].map(h => h.trim().toLowerCase());
    const col = (...names) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
    const ci = {
      name: col('player', 'name', 'player name'), team: col('team', 'tm'), pos: col('pos', 'position'),
      adp: col('adp', 'avg', 'average'), tier: col('tier'), bye: col('bye', 'bye week'),
      pass_yds: col('pass_yds', 'passing yds', 'pass yds', 'yds_pass'), pass_td: col('pass_td', 'passing tds', 'pass tds', 'tds_pass'),
      pass_int: col('pass_int', 'ints', 'int', 'interceptions'), rush_yds: col('rush_yds', 'rushing yds', 'rush yds'), rush_td: col('rush_td', 'rushing tds', 'rush tds'),
      rec: col('rec', 'receptions'), rec_yds: col('rec_yds', 'receiving yds', 'rec yds'), rec_td: col('rec_td', 'receiving tds', 'rec tds'),
      fumbles: col('fumbles', 'fl', 'fum'), pts: col('fpts', 'points', 'proj', 'projection', 'proj_pts', 'fantasy points'),
    };
    const warnings = [];
    if (ci.name < 0 || ci.pos < 0) warnings.push('CSV needs at least Player and Pos columns.');
    const num = (r, i) => (i >= 0 && r[i] !== undefined && r[i] !== '') ? parseFloat(String(r[i]).replace(/[^0-9.\-]/g, '')) || 0 : 0;
    const players = [];
    rows.slice(1).forEach(r => {
      if (ci.name < 0 || ci.pos < 0) return;
      const name = String(r[ci.name] || '').trim();
      let pos = String(r[ci.pos] || '').trim().toUpperCase().replace(/[0-9]+$/, '');
      if (pos === 'DST' || pos === 'D/ST' || pos === 'D') pos = 'DEF';
      if (!name || !POS.includes(pos)) return;
      const p = { name, pos, team: ci.team >= 0 ? String(r[ci.team] || '').trim().toUpperCase() : '', adp: num(r, ci.adp) || 300, tier: num(r, ci.tier) || 0, bye: num(r, ci.bye) || 0,
        pass_yds: num(r, ci.pass_yds), pass_td: num(r, ci.pass_td), pass_int: num(r, ci.pass_int), rush_yds: num(r, ci.rush_yds), rush_td: num(r, ci.rush_td),
        rec: num(r, ci.rec), rec_yds: num(r, ci.rec_yds), rec_td: num(r, ci.rec_td), fumbles: num(r, ci.fumbles), proj_pts_halfppr: num(r, ci.pts), status: 'healthy', notes: '' };
      p.id = playerId(p);
      players.push(p);
    });
    return { players, warnings };
  }

  // Assign tiers automatically when a data source has none (gaps in projected points).
  function autoTiers(players, scoring) {
    POS.forEach(pos => {
      const list = players.filter(p => p.pos === pos).sort((a, b) => projectPoints(b, scoring) - projectPoints(a, scoring));
      let tier = 1;
      for (let i = 0; i < list.length; i++) {
        if (i > 0) {
          const gap = projectPoints(list[i - 1], scoring) - projectPoints(list[i], scoring);
          if (gap > 12 || (i % 6 === 0 && gap > 4)) tier++;
        }
        if (!list[i].tier) list[i].tier = tier;
      }
    });
    return players;
  }

  function prepare(rawPlayers) {
    const seen = new Set();
    const out = [];
    rawPlayers.forEach(p => {
      const q = Object.assign({}, p);
      q.id = q.id || playerId(q);
      if (seen.has(q.id)) return;
      seen.add(q.id);
      q.adp = Number(q.adp) || 300;
      q.tier = Number(q.tier) || 0;
      q.status = q.status || 'healthy';
      out.push(q);
    });
    return out;
  }

  return {
    POS, PRESETS, SCORING_FIELDS, defaultSettings, totalRounds, rosterSize, normalizeName, playerId, projectPoints,
    slotFor, pickNoFor, myPickNumbers, pAvailable, phi, compute, explain, searchPlayers, parsePastedPicks,
    parseYahooSettings, parseScoreValue, parseCsv, importPlayersCsv, autoTiers, prepare,
  };
});
