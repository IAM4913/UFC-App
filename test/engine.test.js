/* Unit tests for the draft engine. Run: node test/engine.test.js */
const assert = require('assert');
const E = require('../app/engine.js');

let passed = 0;
function t(name, fn) { try { fn(); passed++; } catch (e) { console.error('FAIL', name, '\n ', e.message); process.exitCode = 1; } }

// draft order
t('snake order', () => {
  assert.deepStrictEqual(E.slotFor(7, 10), { round: 1, teamIdx: 6, pickInRound: 7 });
  assert.deepStrictEqual(E.slotFor(14, 10), { round: 2, teamIdx: 6, pickInRound: 4 });
  assert.deepStrictEqual(E.slotFor(11, 10), { round: 2, teamIdx: 9, pickInRound: 1 });
  assert.strictEqual(E.pickNoFor(2, 6, 10), 14);
  assert.strictEqual(E.pickNoFor(3, 6, 10), 27);
  const s = { teams: 12, myPick: 7, roster: E.PRESETS.half_12.roster, rounds: 0 };
  assert.deepStrictEqual(E.myPickNumbers(s).slice(0, 4), [7, 18, 31, 42]);
});

// scoring
t('projectPoints half ppr', () => {
  const p = { pos: 'WR', rec: 100, rec_yds: 1000, rec_td: 10 };
  assert.strictEqual(E.projectPoints(p, E.PRESETS.yahoo_half.scoring), 210);
  assert.strictEqual(E.projectPoints(p, E.PRESETS.yahoo_ppr.scoring), 260);
  const qb = { pos: 'QB', pass_yds: 4000, pass_td: 30, pass_int: 10, rush_yds: 300, rush_td: 3 };
  assert.strictEqual(E.projectPoints(qb, E.PRESETS.yahoo_half.scoring), 160 + 120 - 10 + 30 + 18);
  assert.strictEqual(E.projectPoints({ pos: 'K', proj_pts_halfppr: 140 }, E.PRESETS.yahoo_half.scoring), 140);
});

// availability model
t('pAvailable monotone and conditional', () => {
  assert.strictEqual(E.pAvailable(5, 7, 7), 1);
  const a = E.pAvailable(10, 7, 14), b = E.pAvailable(30, 7, 14), c = E.pAvailable(10, 7, 27);
  assert(a < b, 'higher adp more available');
  assert(c < a, 'later pick less available');
  assert(E.pAvailable(2, 7, 14) < 0.15, 'top player still there at 7 unlikely to last to 14');
  assert(E.pAvailable(60, 7, 14) > 0.95);
});

// parsers
t('parseYahooSettings', () => {
  const r = E.parseYahooSettings('League Settings\nMax Teams: 10\nRoster Positions: QB, WR, WR, WR, RB, RB, TE, W/R/T, K, DEF, BN, BN, BN, BN, BN, BN, IR, IR\nPassing Yards 25 yards per point\nPassing Touchdowns 4\nInterceptions -1\nRushing Yards 10 yards per point\nRushing Touchdowns 6\nReceptions 0.5\nReception Yards 10 yards per point\nReception Touchdowns 6\nFumbles Lost -2');
  assert.strictEqual(r.teams, 10);
  assert.deepStrictEqual(r.roster, { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SFLEX: 0, K: 1, DEF: 1, BN: 6 });
  assert.strictEqual(r.scoring.pass_yds, 0.04);
  assert.strictEqual(r.scoring.rec, 0.5);
  assert.strictEqual(r.scoring.fumbles, -2);
  assert.strictEqual(r.scoring.pass_int, -1);
  assert.strictEqual(r.scoring.rush_yds, 0.1);
});
t('parseYahooSettings value on next line + superflex', () => {
  const r = E.parseYahooSettings('Roster Positions: QB, Q/W/R/T, WR x 2, RB (2), BN x 5\nPassing Yards\n0.04\nReceptions\n1');
  assert.strictEqual(r.roster.SFLEX, 1); assert.strictEqual(r.roster.WR, 2); assert.strictEqual(r.roster.RB, 2); assert.strictEqual(r.roster.BN, 5);
  assert.strictEqual(r.scoring.pass_yds, 0.04); assert.strictEqual(r.scoring.rec, 1);
});

const pool = E.prepare([
  { name: 'Jahmyr Gibbs', team: 'DET', pos: 'RB', adp: 1.5, tier: 1, rush_yds: 1350, rush_td: 13, rec: 60, rec_yds: 520, rec_td: 4 },
  { name: 'Bijan Robinson', team: 'ATL', pos: 'RB', adp: 2.2, tier: 1, rush_yds: 1400, rush_td: 12, rec: 58, rec_yds: 480, rec_td: 2 },
  { name: "Ja'Marr Chase", team: 'CIN', pos: 'WR', adp: 3.1, tier: 1, rec: 115, rec_yds: 1550, rec_td: 12 },
  { name: 'Chase Brown', team: 'CIN', pos: 'RB', adp: 20, tier: 3, rush_yds: 1100, rush_td: 8, rec: 40, rec_yds: 300, rec_td: 1 },
  { name: 'Michael Pittman Jr.', team: 'IND', pos: 'WR', adp: 80, tier: 6, rec: 80, rec_yds: 900, rec_td: 5 },
  { name: 'Kenneth Walker III', team: 'SEA', pos: 'RB', adp: 25, tier: 3, rush_yds: 1000, rush_td: 9, rec: 30, rec_yds: 220, rec_td: 1 },
  { name: 'Josh Allen', team: 'BUF', pos: 'QB', adp: 25, tier: 1, pass_yds: 4100, pass_td: 30, pass_int: 9, rush_yds: 520, rush_td: 12 },
  { name: 'Ravens D/ST', team: 'BAL', pos: 'DEF', adp: 140, tier: 1, proj_pts_halfppr: 125 },
]);

t('search', () => {
  assert.strictEqual(E.searchPlayers(pool, 'gibbs')[0].name, 'Jahmyr Gibbs');
  assert.strictEqual(E.searchPlayers(pool, 'j chase')[0].name, "Ja'Marr Chase");
  assert.strictEqual(E.searchPlayers(pool, 'chase brown')[0].name, 'Chase Brown');
  assert.strictEqual(E.searchPlayers(pool, 'pittman')[0].name, 'Michael Pittman Jr.');
  assert.strictEqual(E.searchPlayers(pool, 'ken walker')[0].name, 'Kenneth Walker III');
  assert.strictEqual(E.searchPlayers(pool, 'ravens')[0].pos, 'DEF');
});

t('parsePastedPicks order, dedup, newest-first detection', () => {
  const text = '1.03  Team C   Ja\'Marr Chase (Cin - WR)\n1.02  Team B   Bijan Robinson (Atl - RB)\n1.01  Team A   Jahmyr Gibbs (Det - RB)\n\nTeam A roster: Jahmyr Gibbs';
  const r = E.parsePastedPicks(text, pool);
  assert.deepStrictEqual(r.map(x => x.name), ['Jahmyr Gibbs', 'Bijan Robinson', "Ja'Marr Chase"]);
  const r2 = E.parsePastedPicks('Round 1, Pick 1: Michael Pittman Jr.\nRound 1, Pick 2: Kenneth Walker III', pool);
  assert.deepStrictEqual(r2.map(x => x.name), ['Michael Pittman Jr.', 'Kenneth Walker III']);
  // "Chase" + "Brown" on separate lines must not create a Chase Brown pick
  const r3 = E.parsePastedPicks("Ja'Marr Chase\nBrown, A.J.", pool);
  assert.deepStrictEqual(r3.map(x => x.name), ["Ja'Marr Chase"]);
});

t('compute basics', () => {
  const settings = Object.assign(E.defaultSettings(), { teams: 10, myPick: 7 });
  let c = E.compute(pool, [], settings);
  assert.strictEqual(c.currentPick, 1); assert.strictEqual(c.isMyPick, false); assert.strictEqual(c.nextMyPick, 7); assert.strictEqual(c.picksUntilMine, 6);
  assert.strictEqual(c.rows.length, pool.length);
  // DEF should never be top recommendation early
  assert.notStrictEqual(c.recs[0].row.player.pos, 'DEF');
  const picks = [1, 2, 3, 4, 5, 6].map((n, i) => ({ playerId: pool[i].id, teamIdx: i, pickNo: n }));
  c = E.compute(pool, picks, settings);
  assert.strictEqual(c.isMyPick, true); assert.strictEqual(c.nextMyPick, 14);
  assert.strictEqual(c.draftedCount.RB, 4);
  assert(c.recs.length > 0 && c.recs[0].reasons.length > 0);
});

t('need multiplier respects roster fill', () => {
  const settings = Object.assign(E.defaultSettings(), { teams: 2, myPick: 1, roster: { QB: 1, RB: 1, WR: 0, TE: 0, FLEX: 0, SFLEX: 0, K: 0, DEF: 1, BN: 0 } });
  // 3 rounds. I pick 1,4,5. After I take a RB and QB, only DEF is left to fill -> must fill -> DEF need 1.5
  const picks = [
    { playerId: pool[0].id, teamIdx: 0, pickNo: 1 }, { playerId: pool[6].id, teamIdx: 1, pickNo: 2 },
    { playerId: pool[1].id, teamIdx: 1, pickNo: 3 }, { playerId: pool[3].id, teamIdx: 0, pickNo: 4 },
  ];
  const c = E.compute(pool, picks, settings);
  assert.strictEqual(c.currentPick, 5); assert.strictEqual(c.isMyPick, true);
  assert.strictEqual(c.needMult.DEF, 1.5);
  assert.strictEqual(c.recs[0].row.player.pos, 'DEF');
});

t('csv import', () => {
  const r = E.importPlayersCsv('Player,Team,Pos,ADP,rec,rec_yds,rec_td\n"Chase, Ja\'Marr",CIN,WR,3,110,1500,12\nSome Guy,DAL,RB1,50,10,100,1');
  assert.strictEqual(r.players.length, 2);
  assert.strictEqual(r.players[1].pos, 'RB');
  assert.strictEqual(r.players[0].rec_yds, 1500);
});

console.log(`${passed} engine tests passed${process.exitCode ? ' (with failures)' : ''}`);
