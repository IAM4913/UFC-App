/* Yahoo Fantasy Sports API integration for the sync server.
   - OAuth2 (authorization code) with refresh-token persistence, so one login lasts the season.
   - Small client for the v2 REST API with a normalizer for Yahoo's JSON shape.
   - League settings → app settings mapping (teams, roster slots, scoring, team names, my draft slot).
   - Draft poller: watches league/{key}/draftresults and reports picks in pick order with the drafting team.
   No dependencies: uses the global fetch in Node 18+. Runs only on the server (Yahoo does not allow browser CORS
   and the client secret must never ship to the page). */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const API_URL = 'https://fantasysports.yahooapis.com/fantasy/v2';

// Yahoo NFL stat ids → app scoring keys (names are matched as a fallback for custom leagues).
const STAT_IDS = { 4: 'pass_yds', 5: 'pass_td', 6: 'pass_int', 9: 'rush_yds', 10: 'rush_td', 11: 'rec', 12: 'rec_yds', 13: 'rec_td', 18: 'fumbles' };
const STAT_NAMES = [
  ['pass_yds', /^passing\s+yards?$/i], ['pass_td', /^passing\s+touchdowns?$/i], ['pass_int', /^interceptions?$/i],
  ['rush_yds', /^rushing\s+yards?$/i], ['rush_td', /^rushing\s+touchdowns?$/i],
  ['rec', /^receptions?$/i], ['rec_yds', /^(?:reception|receiving)\s+yards?$/i], ['rec_td', /^(?:reception|receiving)\s+touchdowns?$/i],
  ['fumbles', /^fumbles?\s+lost$/i],
];
const ROSTER_MAP = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', K: 'K', DEF: 'DEF', 'D/ST': 'DEF', DST: 'DEF', BN: 'BN', 'W/R/T': 'FLEX', 'W/R': 'FLEX', 'R/W/T': 'FLEX', 'W/T': 'FLEX', 'Q/W/R/T': 'SFLEX', SUPERFLEX: 'SFLEX' };
const IGNORED_SLOTS = /^(IR|IL|IR\+|NA|IR\/NA|DL)$/i;

// ---------- JSON normalizer ----------
// Yahoo's JSON encodes collections as {"0": {...}, "1": {...}, "count": n} and resources as arrays of
// single-key objects (sometimes nested one level deeper). normalize() turns both into plain objects/arrays.
function normalize(v) {
  if (Array.isArray(v)) {
    const items = v.map(normalize);
    if (items.length && items.every(x => x && typeof x === 'object' && !Array.isArray(x))) {
      const merged = {};
      let disjoint = true;
      for (const it of items) for (const k of Object.keys(it)) { if (k in merged) { disjoint = false; break; } merged[k] = it[k]; }
      if (disjoint) return merged;
    }
    return items;
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length && keys.every(k => /^\d+$/.test(k) || k === 'count')) {
      return keys.filter(k => k !== 'count').sort((a, b) => a - b).map(k => normalize(v[k]));
    }
    const out = {};
    for (const k of keys) out[k] = normalize(v[k]);
    return out;
  }
  return v;
}
// Yahoo wraps repeated items as [{stat:{...}}, {stat:{...}}]; unwrap to [{...}, {...}].
// A one-item list normalizes to a single object ({stat:{...}}), so accept that shape too.
function unwrap(list, key) {
  if (list && !Array.isArray(list) && typeof list === 'object') list = list[key] !== undefined ? [list] : [];
  if (!Array.isArray(list)) return [];
  return list.map(x => (x && x[key] !== undefined ? x[key] : x)).filter(Boolean);
}

// ---------- settings mapping ----------
function mapRoster(rosterPositions) {
  const roster = { QB: 0, RB: 0, WR: 0, TE: 0, FLEX: 0, SFLEX: 0, K: 0, DEF: 0, BN: 0 };
  const warnings = [];
  let any = false;
  unwrap(rosterPositions, 'roster_position').forEach(rp => {
    const pos = String(rp.position || '').toUpperCase();
    const key = ROSTER_MAP[pos];
    if (!key) { if (!IGNORED_SLOTS.test(pos)) warnings.push('Unknown roster slot: ' + pos); return; }
    roster[key] += Number(rp.count) || 1;
    any = true;
  });
  return any ? { roster, warnings } : { roster: null, warnings };
}
function mapScoring(statCategories, statModifiers) {
  const cats = unwrap(statCategories && statCategories.stats, 'stat');
  const mods = unwrap(statModifiers && statModifiers.stats, 'stat');
  const nameById = {};
  cats.forEach(c => { nameById[c.stat_id] = c.name || c.display_name || ''; });
  const scoring = {};
  const unmapped = [];
  mods.forEach(m => {
    const id = Number(m.stat_id);
    const val = parseFloat(m.value);
    if (!isFinite(val)) return;
    let key = STAT_IDS[id];
    if (!key) { const n = nameById[id] || ''; const hit = STAT_NAMES.find(([, re]) => re.test(n.trim())); if (hit) key = hit[0]; }
    if (key) { if (scoring[key] === undefined) scoring[key] = val; } else if (nameById[id]) unmapped.push(nameById[id] + ' (' + val + ')');
  });
  return { scoring: Object.keys(scoring).length ? scoring : null, unmapped };
}
function teamBool(v) { return v === 1 || v === '1' || v === true; }
function mapTeams(teams) {
  return unwrap(teams, 'team').map(t => ({
    key: t.team_key, id: Number(t.team_id), name: t.name || ('Team ' + t.team_id),
    isMine: teamBool(t.is_owned_by_current_login) || (Array.isArray(unwrap(t.managers, 'manager')) && unwrap(t.managers, 'manager').some(m => teamBool(m.is_current_login))),
    draftPosition: t.draft_position != null ? Number(t.draft_position) : null,
  })).sort((a, b) => a.id - b.id);
}
// Build the app-facing league description from the normalized settings + teams resources.
function buildLeague(settingsRes, teamsRes) {
  const lg = settingsRes.league || settingsRes;
  const st = lg.settings || {};
  const { roster, warnings } = mapRoster(st.roster_positions);
  const { scoring, unmapped } = mapScoring(st.stat_categories, st.stat_modifiers);
  const teams = teamsRes ? mapTeams((teamsRes.league || teamsRes).teams) : [];
  const out = {
    key: lg.league_key, name: lg.name, season: lg.season, numTeams: Number(lg.num_teams) || teams.length || null,
    draftStatus: lg.draft_status || 'unknown', draftType: st.draft_type || null, isAuction: teamBool(st.is_auction_draft),
    draftTime: st.draft_time ? new Date(Number(st.draft_time) * 1000).toISOString() : null,
    roster, scoring, teams, warnings: warnings.slice(),
  };
  if (unmapped.length) out.warnings.push('Scoring rules not modeled by the app: ' + unmapped.join(', '));
  if (!scoring) out.warnings.push('No scoring modifiers found; keeping current scoring.');
  if (out.isAuction) out.warnings.push('Auction draft: picks are assigned to the winning team but the snake-order advice does not apply.');
  return out;
}
// Slot order of teams (index 0 = pick 1). Uses draft_position if Yahoo exposes it, else round-1 draft results, else team id order.
function teamOrder(league, picks) {
  const teams = league.teams || [];
  if (teams.length && teams.every(t => t.draftPosition)) return teams.slice().sort((a, b) => a.draftPosition - b.draftPosition).map(t => t.key);
  const n = league.numTeams || teams.length;
  const r1 = (picks || []).filter(p => p.round === 1).sort((a, b) => a.pick - b.pick);
  if (n && r1.length >= n && new Set(r1.slice(0, n).map(p => p.teamKey)).size === n) return r1.slice(0, n).map(p => p.teamKey);
  return teams.map(t => t.key);
}
// Settings payload the app applies: mirrors Engine.defaultSettings() keys.
function appSettings(league, picks) {
  const order = teamOrder(league, picks);
  const byKey = {};
  (league.teams || []).forEach(t => { byKey[t.key] = t; });
  const teamNames = order.map(k => (byKey[k] ? byKey[k].name : k));
  const mineIdx = order.findIndex(k => byKey[k] && byKey[k].isMine);
  const teamsList = league.teams || [];
  const orderKnown = teamsList.length > 0 && (teamsList.every(t => t.draftPosition) || (picks || []).some(p => p.round === 1));
  const out = { teams: league.numTeams || order.length, teamNames, orderKnown };
  if (league.roster) out.roster = league.roster;
  if (league.scoring) out.scoring = league.scoring;
  if (mineIdx >= 0) out.myPick = mineIdx + 1;
  return out;
}
function mapDraftResults(res) {
  const lg = res.league || res;
  return unwrap(lg.draft_results, 'draft_result').map(d => ({
    pick: Number(d.pick), round: Number(d.round), teamKey: d.team_key, playerKey: d.player_key, cost: d.cost != null ? Number(d.cost) : undefined,
  })).filter(d => d.playerKey && d.pick > 0).sort((a, b) => a.pick - b.pick);
}
function mapPlayers(res) {
  const lg = res.league || res;
  const out = {};
  unwrap(lg.players, 'player').forEach(p => {
    const name = p.name && (p.name.full || [p.name.first, p.name.last].filter(Boolean).join(' '));
    let pos = String(p.primary_position || p.display_position || '').toUpperCase().split(',')[0];
    if (pos === 'DST' || pos === 'D/ST') pos = 'DEF';
    out[p.player_key] = { key: p.player_key, name, pos, team: String(p.editorial_team_abbr || '').toUpperCase() };
  });
  return out;
}

// ---------- client ----------
class YahooClient {
  constructor(dir, opts) {
    opts = opts || {};
    this.dir = dir;
    this.configFile = path.join(dir, 'yahoo-config.json');
    this.tokenFile = path.join(dir, 'yahoo-tokens.json');
    this.fetch = opts.fetch || global.fetch;
    this.config = this._readJson(this.configFile) || {};
    if (process.env.YAHOO_CLIENT_ID) this.config.clientId = process.env.YAHOO_CLIENT_ID;
    if (process.env.YAHOO_CLIENT_SECRET) this.config.clientSecret = process.env.YAHOO_CLIENT_SECRET;
    if (process.env.YAHOO_REDIRECT_URI) this.config.redirectUri = process.env.YAHOO_REDIRECT_URI;
    this.tokens = this._readJson(this.tokenFile) || null;
    this.pendingState = null;
    this.playerCache = {};
  }
  _readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } }
  _writeJson(f, obj) { fs.writeFileSync(f, JSON.stringify(obj, null, 2)); }

  configured() { return !!(this.config.clientId && this.config.clientSecret); }
  authorized() { return !!(this.tokens && this.tokens.refresh_token); }
  redirectUri() { return this.config.redirectUri || 'oob'; }
  saveConfig(cfg) {
    const next = Object.assign({}, this.config);
    if (cfg.clientId != null) next.clientId = String(cfg.clientId).trim();
    if (cfg.clientSecret != null && String(cfg.clientSecret).trim()) next.clientSecret = String(cfg.clientSecret).trim();
    if (cfg.redirectUri != null) next.redirectUri = String(cfg.redirectUri).trim() || 'oob';
    this.config = next;
    this._writeJson(this.configFile, next);
  }
  forgetTokens() { this.tokens = null; try { fs.unlinkSync(this.tokenFile); } catch (e) { /* ignore */ } }

  authUrl() {
    if (!this.configured()) throw new Error('Yahoo client id/secret not configured');
    this.pendingState = crypto.randomBytes(12).toString('hex');
    const q = new URLSearchParams({ client_id: this.config.clientId, redirect_uri: this.redirectUri(), response_type: 'code', language: 'en-us', state: this.pendingState });
    return AUTH_URL + '?' + q.toString();
  }
  // Accepts the raw code, or the full redirect URL the browser landed on (code is pulled from ?code=).
  static extractCode(input) {
    const s = String(input || '').trim();
    const m = s.match(/[?&#]code=([^&#\s]+)/);
    if (m) return decodeURIComponent(m[1]);
    return s.replace(/^code[:=\s]+/i, '').trim();
  }
  async _tokenRequest(params) {
    const basic = Buffer.from(this.config.clientId + ':' + this.config.clientSecret).toString('base64');
    const body = new URLSearchParams(Object.assign({ client_id: this.config.clientId, client_secret: this.config.clientSecret, redirect_uri: this.redirectUri() }, params));
    const r = await this.fetch(TOKEN_URL, { method: 'POST', headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) { j = null; }
    if (!r.ok || !j || !j.access_token) throw new Error('Yahoo token request failed (' + r.status + '): ' + ((j && (j.error_description || j.error)) || txt.slice(0, 200)));
    this.tokens = { access_token: j.access_token, refresh_token: j.refresh_token || (this.tokens && this.tokens.refresh_token), expires_at: Date.now() + (Number(j.expires_in) || 3600) * 1000 - 60000, token_type: j.token_type || 'bearer' };
    this._writeJson(this.tokenFile, this.tokens);
    return this.tokens;
  }
  exchangeCode(code) { return this._tokenRequest({ grant_type: 'authorization_code', code: YahooClient.extractCode(code) }); }
  refresh() {
    if (!this.authorized()) throw new Error('Not connected to Yahoo');
    return this._tokenRequest({ grant_type: 'refresh_token', refresh_token: this.tokens.refresh_token });
  }
  async accessToken() {
    if (!this.authorized()) throw new Error('Not connected to Yahoo');
    if (!this.tokens.access_token || Date.now() >= (this.tokens.expires_at || 0)) await this.refresh();
    return this.tokens.access_token;
  }
  async get(resource, retry) {
    const token = await this.accessToken();
    const url = API_URL + '/' + resource.replace(/^\//, '') + (resource.includes('?') ? '&' : '?') + 'format=json';
    const r = await this.fetch(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    if (r.status === 401 && !retry) { await this.refresh(); return this.get(resource, true); }
    const txt = await r.text();
    if (!r.ok) throw new Error('Yahoo API ' + r.status + ' for ' + resource + ': ' + txt.replace(/\s+/g, ' ').slice(0, 300));
    let j; try { j = JSON.parse(txt); } catch (e) { throw new Error('Yahoo API returned non-JSON for ' + resource); }
    return normalize(j.fantasy_content || j);
  }

  async leagues() {
    const res = await this.get('users;use_login=1/games;game_codes=nfl/leagues');
    const users = Array.isArray(res.users) ? res.users : [res.users];
    const out = [];
    users.forEach(u => {
      const user = u && u.user ? u.user : u;
      const games = user && user.games ? (Array.isArray(user.games) ? user.games : [user.games]) : [];
      games.forEach(g => {
        const game = g && g.game ? g.game : g;
        const leagues = game && game.leagues ? (Array.isArray(game.leagues) ? game.leagues : [game.leagues]) : [];
        leagues.forEach(l => {
          const lg = l && l.league ? l.league : l;
          if (!lg || !lg.league_key) return;
          out.push({ key: lg.league_key, name: lg.name, season: lg.season || game.season, numTeams: Number(lg.num_teams) || null, draftStatus: lg.draft_status, scoringType: lg.scoring_type, url: lg.url });
        });
      });
    });
    return out.sort((a, b) => String(b.season).localeCompare(String(a.season)));
  }
  async league(leagueKey) {
    const [settings, teams] = await Promise.all([this.get(`league/${leagueKey}/settings`), this.get(`league/${leagueKey}/teams`)]);
    return buildLeague(settings, teams);
  }
  async draftResults(leagueKey) {
    const res = await this.get(`league/${leagueKey}/draftresults`);
    const lg = res.league || res;
    return { draftStatus: lg.draft_status, picks: mapDraftResults(res) };
  }
  async players(leagueKey, keys) {
    const missing = keys.filter(k => !this.playerCache[k]);
    for (let i = 0; i < missing.length; i += 25) {
      const batch = missing.slice(i, i + 25);
      const res = await this.get(`league/${leagueKey}/players;player_keys=${batch.join(',')}`);
      Object.assign(this.playerCache, mapPlayers(res));
      batch.forEach(k => { if (!this.playerCache[k]) this.playerCache[k] = { key: k, name: k, pos: '', team: '' }; });
    }
    const out = {};
    keys.forEach(k => { out[k] = this.playerCache[k]; });
    return out;
  }
}

// ---------- draft poller ----------
// Keeps the selected league's draft picks in sync and calls onUpdate(payload) when anything changes.
class DraftPoller {
  constructor(client, opts) {
    this.client = client;
    this.onUpdate = (opts && opts.onUpdate) || (() => {});
    this.onLog = (opts && opts.onLog) || (() => {});
    this.intervals = Object.assign({ draftinginprogress: 5000, predraft: 30000, postdraft: 0 }, (opts && opts.intervals) || {});
    this.league = null; this.picks = []; this.settings = null;
    this.timer = null; this.lastPoll = null; this.error = null; this.polling = false; this.inFlight = null;
  }
  status() {
    return {
      league: this.league ? { key: this.league.key, name: this.league.name, season: this.league.season, draftStatus: this.league.draftStatus, draftType: this.league.draftType, isAuction: this.league.isAuction, draftTime: this.league.draftTime, numTeams: this.league.numTeams, warnings: this.league.warnings } : null,
      settings: this.settings, picks: this.picks.length, polling: this.polling, lastPoll: this.lastPoll, error: this.error,
    };
  }
  async select(leagueKey) {
    this.stop();
    this.league = await this.client.league(leagueKey);
    this.picks = []; this.error = null;
    this.settings = appSettings(this.league, []);
    await this.poll();
    this.start();
    return this.league;
  }
  start() { this.polling = true; this._schedule(); }
  stop() { this.polling = false; if (this.timer) { clearTimeout(this.timer); this.timer = null; } }
  clear() { this.stop(); this.league = null; this.picks = []; this.settings = null; this.error = null; }
  _schedule() {
    if (this.timer) clearTimeout(this.timer);
    if (!this.polling || !this.league) return;
    const ms = this.intervals[this.league.draftStatus] != null ? this.intervals[this.league.draftStatus] : 15000;
    if (!ms) { this.polling = false; return; } // draft over: nothing left to watch
    this.timer = setTimeout(() => { this.poll().catch(() => {}).then(() => this._schedule()); }, ms);
    if (this.timer.unref) this.timer.unref();
  }
  // Returns the pick list enriched with player info and the team's slot index.
  async poll() {
    if (!this.league) return null;
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      try {
        const { draftStatus, picks } = await this.client.draftResults(this.league.key);
        const statusChanged = draftStatus && draftStatus !== this.league.draftStatus;
        if (statusChanged) this.league.draftStatus = draftStatus;
        const changed = statusChanged || picks.length !== this.picks.length || picks.some((p, i) => !this.picks[i] || this.picks[i].playerKey !== p.playerKey || this.picks[i].teamKey !== p.teamKey);
        this.lastPoll = new Date().toISOString(); this.error = null;
        if (!changed) return this.picks;
        const info = await this.client.players(this.league.key, picks.map(p => p.playerKey));
        const settings = appSettings(this.league, picks);
        const order = teamOrder(this.league, picks);
        const byKey = {}; (this.league.teams || []).forEach(t => { byKey[t.key] = t; });
        this.picks = picks.map(p => {
          const pl = info[p.playerKey] || {};
          const idx = order.indexOf(p.teamKey);
          return Object.assign({}, p, { name: pl.name || p.playerKey, pos: pl.pos || '', team: pl.team || '', teamIdx: idx >= 0 ? idx : null, teamName: byKey[p.teamKey] ? byKey[p.teamKey].name : p.teamKey });
        });
        const settingsChanged = JSON.stringify(settings) !== JSON.stringify(this.settings);
        this.settings = settings;
        this.onLog(`Yahoo: ${this.picks.length} picks, draft ${this.league.draftStatus}`);
        this.onUpdate({ picks: this.picks, settings: settingsChanged ? settings : null, league: this.status().league });
        return this.picks;
      } catch (e) {
        this.error = String(e.message || e); this.lastPoll = new Date().toISOString();
        this.onLog('Yahoo poll failed: ' + this.error);
        this.onUpdate({ error: this.error, league: this.status().league });
        throw e;
      } finally { this.inFlight = null; }
    })();
    return this.inFlight;
  }
}

module.exports = { YahooClient, DraftPoller, normalize, unwrap, buildLeague, appSettings, teamOrder, mapDraftResults, mapPlayers, mapRoster, mapScoring, STAT_IDS };
