/* Simulates a full draft: other teams pick by ADP with noise, "me" follows the engine's top recommendation.
   Prints my roster and sanity checks (no K/DEF before the last rounds, starters filled, no drafted-twice). */
const E = require('../app/engine.js');
const data = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'players.json'), 'utf8'));
const teams = +(process.argv[2] || 10), myPick = +(process.argv[3] || 7), seed = +(process.argv[4] || 1);
let s = seed; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
const settings = Object.assign(E.defaultSettings(), { teams, myPick });
if (teams >= 12) settings.roster = Object.assign({}, E.PRESETS.half_12.roster);
const players = E.autoTiers(E.prepare(data.players), settings.scoring);
const picks = [];
const rounds = E.totalRounds(settings);
const log = [];
for (let pk = 1; pk <= teams * rounds; pk++) {
  const c = E.compute(players, picks, settings);
  const slot = c.onClock;
  let choice;
  if (c.isMyPick) choice = c.recs[0].row.player;
  else {
    // ADP-based opponent: pick from the best few by ADP with noise; needs K/DEF late.
    const rem = c.rows.map(r => r.player).filter(p => p.status !== 'out-season' && p.status !== 'unsigned');
    const teamPicks = picks.filter(x => x.teamIdx === slot.teamIdx).map(x => players.find(p => p.id === x.playerId));
    const has = pos => teamPicks.filter(p => p.pos === pos).length;
    const late = slot.round >= rounds - 1;
    let pool = rem.filter(p => (late ? true : (p.pos !== 'K' && p.pos !== 'DEF')) && !(p.pos === 'QB' && has('QB') >= 1 && rnd() < 0.9) && !(p.pos === 'TE' && has('TE') >= 1 && rnd() < 0.9));
    if (late) { if (!has('K')) pool = pool.filter(p => p.pos === 'K'); else if (!has('DEF')) pool = pool.filter(p => p.pos === 'DEF'); }
    pool.sort((a, b) => (a.adp + rnd() * 6 - 3) - (b.adp + rnd() * 6 - 3));
    choice = pool[0];
  }
  picks.push({ playerId: choice.id, teamIdx: slot.teamIdx, pickNo: pk });
  if (c.isMyPick) log.push(`R${slot.round} #${pk}: ${choice.pos} ${choice.name} (${choice.team}) ADP ${choice.adp} proj ${c.proj[choice.id].toFixed(0)} | ${c.recs[0].reasons[0]} ${c.recs[0].reasons[1] || ''}`);
}
const final = E.compute(players, picks, settings);
console.log(`Simulated ${teams}-team draft, pick ${myPick}, seed ${seed}`);
log.forEach(l => console.log(' ', l));
const mine = final.myPicks;
const cnt = {}; mine.forEach(p => { cnt[p.pos] = (cnt[p.pos] || 0) + 1; });
console.log('roster:', JSON.stringify(cnt), 'starters proj total:', mine.reduce((t, p) => t + final.proj[p.id], 0).toFixed(0));
const ids = picks.map(p => p.playerId); if (new Set(ids).size !== ids.length) console.log('ERROR duplicate pick');
const kdefEarly = picks.filter((p, i) => { const pl = players.find(x => x.id === p.playerId); return p.teamIdx === myPick - 1 && (pl.pos === 'K' || pl.pos === 'DEF') && E.slotFor(i + 1, teams).round < rounds - 1; });
if (kdefEarly.length) console.log('WARN K/DEF drafted early for me');
['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].forEach(pos => { if ((cnt[pos] || 0) < (settings.roster[pos] || 0)) console.log('WARN starter slot unfilled', pos); });
