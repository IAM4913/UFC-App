/* Unit tests for the Yahoo Fantasy API module. Run: node test/yahoo.test.js
   Uses fixtures shaped like Yahoo's real JSON (collections as {"0":..,"count":n}, resources as arrays of single-key objects)
   and a fake fetch, so no network or credentials are needed. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Y = require('../yahoo.js');

let passed = 0;
function t(name, fn) { try { fn(); passed++; } catch (e) { console.error('FAIL', name, '\n ', e.stack || e.message); process.exitCode = 1; } }
async function ta(name, fn) { try { await fn(); passed++; } catch (e) { console.error('FAIL', name, '\n ', e.stack || e.message); process.exitCode = 1; } }

// ---------- fixtures ----------
const LEAGUE_META = { league_key: '461.l.5555', league_id: '5555', name: 'Office League', num_teams: 10, draft_status: 'predraft', season: '2026', scoring_type: 'head' };
const stat = (id, name) => ({ stat: { stat_id: id, enabled: '1', name, display_name: name, position_type: 'O' } });
const mod = (id, value) => ({ stat: { stat_id: id, value } });
const rp = (position, count) => ({ roster_position: { position, position_type: 'O', count } });
const SETTINGS_RES = { fantasy_content: { league: [LEAGUE_META, { settings: [{
  draft_type: 'live', is_auction_draft: '0', draft_time: '1788800000',
  roster_positions: [rp('QB', 1), rp('WR', 3), rp('RB', 2), rp('TE', 1), rp('W/R/T', 1), rp('K', 1), rp('DEF', 1), rp('BN', 6), rp('IR', 1)],
  stat_categories: { stats: [stat(4, 'Passing Yards'), stat(5, 'Passing Touchdowns'), stat(6, 'Interceptions'), stat(9, 'Rushing Yards'), stat(10, 'Rushing Touchdowns'), stat(11, 'Receptions'), stat(12, 'Reception Yards'), stat(13, 'Reception Touchdowns'), stat(18, 'Fumbles Lost'), stat(57, 'Offensive Fumble Return TD'), stat(999, 'Passing Touchdowns')] },
  stat_modifiers: { stats: [mod(4, '0.04'), mod(5, '4'), mod(6, '-1'), mod(9, '0.1'), mod(10, '6'), mod(11, '0.5'), mod(12, '0.1'), mod(13, '6'), mod(18, '-2'), mod(57, '6')] },
}] }] } };
const team = (id, name, mine) => ({ team: [[{ team_key: '461.l.5555.t.' + id }, { team_id: String(id) }, { name }, { is_owned_by_current_login: mine ? 1 : 0 }, { managers: [{ manager: { manager_id: String(id), nickname: 'm' + id, is_current_login: mine ? '1' : undefined } }] }]] });
const teamsObj = {};
for (let i = 1; i <= 10; i++) teamsObj[String(i - 1)] = team(i, i === 3 ? 'My Squad' : 'Team ' + i, i === 3);
teamsObj.count = 10;
const TEAMS_RES = { fantasy_content: { league: [LEAGUE_META, { teams: teamsObj }] } };
function draftRes(picks, status) {
  const o = {};
  picks.forEach((p, i) => { o[String(i)] = { draft_result: { pick: p.pick, round: p.round, team_key: p.team, player_key: p.player } }; });
  o.count = picks.length;
  return { fantasy_content: { league: [Object.assign({}, LEAGUE_META, { draft_status: status || 'draftinginprogress' }), { draft_results: o }] } };
}
const PLAYER_DB = {
  '461.p.100': { full: 'Bijan Robinson', pos: 'RB', team: 'Atl' }, '461.p.101': { full: "Ja'Marr Chase", pos: 'WR', team: 'Cin' },
  '461.p.102': { full: 'Jahmyr Gibbs', pos: 'RB', team: 'Det' }, '461.p.103': { full: 'Baltimore', pos: 'DEF', team: 'Bal' },
};
function playersRes(keys) {
  const o = {};
  keys.forEach((k, i) => { const p = PLAYER_DB[k]; o[String(i)] = { player: [[{ player_key: k }, { player_id: k.split('.').pop() }, { name: { full: p.full, first: p.full.split(' ')[0], last: p.full.split(' ').slice(1).join(' ') } }, { editorial_team_abbr: p.team }, { display_position: p.pos }, { primary_position: p.pos }]] }; });
  o.count = keys.length;
  return { fantasy_content: { league: [LEAGUE_META, { players: o }] } };
}
const LEAGUES_RES = { fantasy_content: { users: { 0: { user: [{ guid: 'ABC' }, { games: { 0: { game: [{ game_key: '461', code: 'nfl', season: '2026' }, { leagues: { 0: { league: [LEAGUE_META] }, 1: { league: [{ league_key: '461.l.777', name: 'Dynasty', num_teams: 12, draft_status: 'postdraft', season: '2026' }] }, count: 2 } }] }, count: 1 } }] }, count: 1 } } };

// ---------- normalizer ----------
t('normalize collections and single-key arrays', () => {
  const n = Y.normalize(SETTINGS_RES.fantasy_content);
  assert.strictEqual(n.league.league_key, '461.l.5555');
  assert.strictEqual(n.league.settings.draft_type, 'live');
  assert.strictEqual(n.league.settings.roster_positions.length, 9);
  const teams = Y.normalize(TEAMS_RES.fantasy_content).league.teams;
  assert.strictEqual(teams.length, 10);
  assert.strictEqual(teams[2].team.name, 'My Squad');
  assert.strictEqual(Y.unwrap(teams[2].team.managers, 'manager')[0].nickname, 'm3');
  assert.deepStrictEqual(Y.unwrap({ stat: { a: 1 } }, 'stat'), [{ a: 1 }]);
});

// ---------- settings mapping ----------
t('buildLeague maps roster, scoring, teams', () => {
  const lg = Y.buildLeague(Y.normalize(SETTINGS_RES.fantasy_content), Y.normalize(TEAMS_RES.fantasy_content));
  assert.strictEqual(lg.key, '461.l.5555');
  assert.strictEqual(lg.numTeams, 10);
  assert.strictEqual(lg.draftStatus, 'predraft');
  assert.deepStrictEqual(lg.roster, { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, SFLEX: 0, K: 1, DEF: 1, BN: 6 });
  assert.deepStrictEqual(lg.scoring, { pass_yds: 0.04, pass_td: 4, pass_int: -1, rush_yds: 0.1, rush_td: 6, rec: 0.5, rec_yds: 0.1, rec_td: 6, fumbles: -2 });
  assert.strictEqual(lg.teams.length, 10);
  assert.strictEqual(lg.teams.find(x => x.isMine).name, 'My Squad');
  assert.ok(lg.warnings.some(w => /Offensive Fumble Return TD/.test(w)), 'unmodeled stat is reported');
  assert.strictEqual(lg.draftTime, new Date(1788800000 * 1000).toISOString());
});
t('scoring falls back to stat names for unknown ids', () => {
  const r = Y.mapScoring({ stats: [{ stat: { stat_id: 555, name: 'Receptions' } }] }, { stats: [{ stat: { stat_id: 555, value: '1' } }] });
  assert.deepStrictEqual(r.scoring, { rec: 1 });
});
t('appSettings: order unknown before pick 1, then derived from round 1', () => {
  const lg = Y.buildLeague(Y.normalize(SETTINGS_RES.fantasy_content), Y.normalize(TEAMS_RES.fantasy_content));
  const s0 = Y.appSettings(lg, []);
  assert.strictEqual(s0.teams, 10);
  assert.strictEqual(s0.orderKnown, false);
  assert.strictEqual(s0.myPick, 3); // team-id order fallback
  assert.strictEqual(s0.teamNames[2], 'My Squad');
  const r1 = [];
  for (let i = 1; i <= 10; i++) r1.push({ pick: i, round: 1, teamKey: '461.l.5555.t.' + (11 - i), playerKey: '461.p.' + i });
  const s1 = Y.appSettings(lg, r1);
  assert.strictEqual(s1.orderKnown, true);
  assert.strictEqual(s1.myPick, 8); // t.3 picks 8th
  assert.strictEqual(s1.teamNames[7], 'My Squad');
  assert.strictEqual(s1.teamNames[0], 'Team 10');
});
t('appSettings uses draft_position when Yahoo provides it', () => {
  const lg = Y.buildLeague(Y.normalize(SETTINGS_RES.fantasy_content), Y.normalize(TEAMS_RES.fantasy_content));
  lg.teams.forEach(x => { x.draftPosition = 11 - x.id; });
  const s = Y.appSettings(lg, []);
  assert.strictEqual(s.orderKnown, true);
  assert.strictEqual(s.myPick, 8);
});
t('mapDraftResults and mapPlayers', () => {
  const d = Y.mapDraftResults(Y.normalize(draftRes([{ pick: 2, round: 1, team: 't2', player: '461.p.101' }, { pick: 1, round: 1, team: 't1', player: '461.p.100' }]).fantasy_content));
  assert.deepStrictEqual(d.map(x => x.pick), [1, 2]);
  const p = Y.mapPlayers(Y.normalize(playersRes(['461.p.100', '461.p.103']).fantasy_content));
  assert.deepStrictEqual(p['461.p.100'], { key: '461.p.100', name: 'Bijan Robinson', pos: 'RB', team: 'ATL' });
  assert.strictEqual(p['461.p.103'].pos, 'DEF');
});
t('extractCode accepts a code, a URL, or "code=..."', () => {
  assert.strictEqual(Y.YahooClient.extractCode('abcdefg'), 'abcdefg');
  assert.strictEqual(Y.YahooClient.extractCode('https://localhost:3000/api/yahoo/callback?code=xyz123&state=1'), 'xyz123');
  assert.strictEqual(Y.YahooClient.extractCode('code: q1w2e3'), 'q1w2e3');
});

// ---------- client + poller with a fake fetch ----------
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yahoo-test-'));
  const calls = [];
  let picks = [];
  let status = 'predraft';
  const fakeFetch = async (url, opts) => {
    calls.push(url);
    const ok = (obj, code) => ({ ok: (code || 200) < 400, status: code || 200, text: async () => JSON.stringify(obj) });
    if (url.startsWith('https://api.login.yahoo.com/oauth2/get_token')) {
      const body = new URLSearchParams(opts.body);
      if (body.get('grant_type') === 'authorization_code') { assert.strictEqual(body.get('code'), 'thecode'); return ok({ access_token: 'AT1', refresh_token: 'RT1', expires_in: 3600 }); }
      if (body.get('grant_type') === 'refresh_token') { assert.strictEqual(body.get('refresh_token'), 'RT1'); return ok({ access_token: 'AT2', refresh_token: 'RT1', expires_in: 3600 }); }
      return ok({ error: 'bad' }, 400);
    }
    assert.ok(/format=json/.test(url));
    if (url.includes('users;use_login=1/games;game_codes=nfl/leagues')) return ok(LEAGUES_RES);
    if (url.includes('/settings')) return ok(SETTINGS_RES);
    if (url.includes('/teams')) return ok(TEAMS_RES);
    if (url.includes('/draftresults')) return ok(draftRes(picks, status));
    const m = url.match(/players;player_keys=([^/?]+)/);
    if (m) return ok(playersRes(m[1].split(',')));
    return ok({ error: 'not found' }, 404);
  };

  const client = new Y.YahooClient(dir, { fetch: fakeFetch });
  await ta('client config + auth flow', async () => {
    assert.strictEqual(client.configured(), false);
    client.saveConfig({ clientId: 'cid', clientSecret: 'sec' });
    assert.strictEqual(client.configured(), true);
    assert.strictEqual(client.redirectUri(), 'oob');
    const url = client.authUrl();
    assert.ok(url.startsWith('https://api.login.yahoo.com/oauth2/request_auth?'));
    assert.ok(url.includes('client_id=cid') && url.includes('redirect_uri=oob') && url.includes('response_type=code'));
    await client.exchangeCode('https://localhost/cb?code=thecode');
    assert.strictEqual(client.authorized(), true);
    assert.ok(fs.existsSync(path.join(dir, 'yahoo-tokens.json')));
    // a fresh client picks the tokens up from disk and refreshes when expired
    const c2 = new Y.YahooClient(dir, { fetch: fakeFetch });
    assert.strictEqual(c2.authorized(), true);
    c2.tokens.expires_at = 0;
    assert.strictEqual(await c2.accessToken(), 'AT2');
  });
  await ta('leagues list', async () => {
    const ls = await client.leagues();
    assert.strictEqual(ls.length, 2);
    assert.strictEqual(ls[0].key, '461.l.5555');
    assert.strictEqual(ls[1].numTeams, 12);
  });
  await ta('poller: select league, follow picks, resolve names, stop at postdraft', async () => {
    const updates = [];
    const poller = new Y.DraftPoller(client, { onUpdate: u => updates.push(u), intervals: { predraft: 5, draftinginprogress: 5, postdraft: 0 } });
    const lg = await poller.select('461.l.5555');
    assert.strictEqual(lg.name, 'Office League');
    assert.strictEqual(poller.polling, true);
    assert.strictEqual(poller.settings.myPick, 3);
    assert.strictEqual(updates.length, 0, 'no update when nothing drafted yet');
    // draft starts, three picks in; team order is t.10, t.9, ... so my team (t.3) picks 8th
    status = 'draftinginprogress';
    picks = [{ pick: 1, round: 1, team: '461.l.5555.t.10', player: '461.p.100' }, { pick: 2, round: 1, team: '461.l.5555.t.9', player: '461.p.101' }, { pick: 3, round: 1, team: '461.l.5555.t.8', player: '461.p.102' }];
    await poller.poll();
    assert.strictEqual(poller.picks.length, 3);
    assert.strictEqual(poller.picks[0].name, 'Bijan Robinson');
    assert.strictEqual(poller.picks[0].teamName, 'Team 10');
    assert.strictEqual(poller.picks[2].pos, 'RB');
    assert.strictEqual(poller.league.draftStatus, 'draftinginprogress');
    assert.strictEqual(updates.length, 1);
    assert.strictEqual(updates[0].picks.length, 3);
    // order is still unknown (round 1 incomplete): settings unchanged apart from status
    const before = calls.length;
    await poller.poll();
    assert.strictEqual(updates.length, 1, 'no update when nothing changed');
    assert.strictEqual(calls.length - before, 1, 'only draftresults fetched when nothing changed');
    // round 1 completes → order known, myPick becomes 8, team names reordered, DEF resolved from cache-miss batch
    for (let i = 4; i <= 10; i++) picks.push({ pick: i, round: 1, team: '461.l.5555.t.' + (11 - i), player: i === 10 ? '461.p.103' : '461.p.' + (200 + i) });
    Object.assign(PLAYER_DB, { '461.p.204': { full: 'A B', pos: 'WR', team: 'X' }, '461.p.205': { full: 'C D', pos: 'WR', team: 'X' }, '461.p.206': { full: 'E F', pos: 'TE', team: 'X' }, '461.p.207': { full: 'G H', pos: 'QB', team: 'X' }, '461.p.208': { full: 'I J', pos: 'RB', team: 'X' }, '461.p.209': { full: 'K L', pos: 'WR', team: 'X' } });
    await poller.poll();
    const u = updates[updates.length - 1];
    assert.strictEqual(u.picks.length, 10);
    assert.strictEqual(u.settings.myPick, 8);
    assert.strictEqual(u.settings.orderKnown, true);
    assert.strictEqual(u.settings.teamNames[7], 'My Squad');
    assert.deepStrictEqual(u.picks.map(p => p.teamIdx), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.strictEqual(u.picks[9].pos, 'DEF');
    // draft ends: one more update carries the status, then polling stops
    status = 'postdraft';
    await poller.poll();
    assert.strictEqual(poller.league.draftStatus, 'postdraft');
    poller._schedule();
    assert.strictEqual(poller.polling, false);
    poller.stop();
  });
  await ta('poller reports API errors without throwing away picks', async () => {
    const errs = [];
    const poller = new Y.DraftPoller(client, { onUpdate: u => { if (u.error) errs.push(u.error); }, intervals: { predraft: 0, draftinginprogress: 0, postdraft: 0 } });
    await poller.select('461.l.5555');
    const n = poller.picks.length;
    const bad = new Y.YahooClient(dir, { fetch: async () => ({ ok: false, status: 500, text: async () => 'boom' }) });
    poller.client = bad;
    await poller.poll().catch(() => {});
    assert.ok(/500/.test(poller.error));
    assert.strictEqual(errs.length, 1);
    assert.strictEqual(poller.picks.length, n);
    poller.stop();
  });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(process.exitCode ? 'some tests failed' : `yahoo tests OK (${passed})`);
})();
