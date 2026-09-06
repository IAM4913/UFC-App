#!/usr/bin/env node
/* Merges per-position research JSON (data/raw/*.json) into app/players.js + data/players.json.
   Usage: node scripts/build-data.js [rawDir]  */
const fs = require('fs');
const path = require('path');
const E = require('../app/engine.js');

const rawDir = process.argv[2] || path.join(__dirname, '..', 'data', 'raw');
const files = fs.readdirSync(rawDir).filter(f => /^data_.*\.json$/.test(f));
const TEAMS = new Set('ARI ATL BAL BUF CAR CHI CIN CLE DAL DEN DET GB HOU IND JAX KC LV LAC LAR MIA MIN NE NO NYG NYJ PHI PIT SF SEA TB TEN WAS'.split(' '));
const FIX = { JAC: 'JAX', WSH: 'WAS', LA: 'LAR', OAK: 'LV', SD: 'LAC', STL: 'LAR', GNB: 'GB', KAN: 'KC', NWE: 'NE', NOR: 'NO', SFO: 'SF', TAM: 'TB', LVR: 'LV' };
const NUM = ['adp', 'tier', 'bye', 'pass_yds', 'pass_td', 'pass_int', 'rush_att', 'rush_yds', 'rush_td', 'rec', 'rec_yds', 'rec_td', 'fumbles', 'proj_pts_halfppr'];

let all = [];
const warnings = [];
for (const f of files) {
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(rawDir, f), 'utf8')); } catch (e) { warnings.push(`${f}: invalid JSON (${e.message})`); continue; }
  const list = Array.isArray(d) ? d : (d.players || []);
  list.forEach(p => {
    const q = {};
    q.name = String(p.name || '').trim();
    q.pos = String(p.pos || '').toUpperCase().replace('DST', 'DEF').replace('D/ST', 'DEF');
    q.team = String(p.team || '').toUpperCase().trim();
    q.team = FIX[q.team] || q.team;
    if (!TEAMS.has(q.team) && q.team !== 'FA') warnings.push(`${f}: unknown team "${q.team}" for ${q.name}`);
    NUM.forEach(k => { if (p[k] != null && p[k] !== '') q[k] = Number(p[k]) || 0; });
    q.status = p.status || 'healthy';
    q.notes = String(p.notes || '').trim();
    q.confidence = p.confidence || '';
    if (!q.name || !E.POS.includes(q.pos)) { warnings.push(`${f}: skipped ${JSON.stringify(p).slice(0, 80)}`); return; }
    // Sanity: stat line vs claimed points (half PPR).
    const calc = E.projectPoints(q, E.PRESETS.yahoo_half.scoring);
    if (q.pos !== 'K' && q.pos !== 'DEF' && q.proj_pts_halfppr && Math.abs(calc - q.proj_pts_halfppr) > 25)
      warnings.push(`${q.name}: stat line gives ${calc} but proj_pts ${q.proj_pts_halfppr}`);
    all.push(q);
  });
}
// Dedup by id (keep the entry with more stats)
const byId = {};
all.forEach(p => {
  const id = E.playerId(p);
  if (!byId[id] || Object.keys(p).length > Object.keys(byId[id]).length) byId[id] = p;
});
all = Object.values(byId);
// Apply news overrides if present (data/raw/news.json: [{player, status, impact, detail}])
const newsFile = path.join(rawDir, 'news.json');
if (fs.existsSync(newsFile)) {
  try {
    const news = JSON.parse(fs.readFileSync(newsFile, 'utf8'));
    const items = Array.isArray(news) ? news : (news.items || []);
    const idx = {}; all.forEach(p => { idx[E.normalizeName(p.name)] = p; });
    const STAT_KEYS = ['pass_yds', 'pass_td', 'pass_int', 'rush_att', 'rush_yds', 'rush_td', 'rec', 'rec_yds', 'rec_td', 'fumbles', 'proj_pts_halfppr'];
    const scale = (p, f) => { STAT_KEYS.forEach(k => { if (p[k]) p[k] = Math.round(p[k] * f * 10) / 10; }); };
    items.forEach(it => {
      // news items sometimes bundle several names ("A / B / C")
      String(it.player).split('/').map(x => x.trim()).filter(Boolean).forEach(nm => {
        const p = idx[E.normalizeName(nm)];
        if (!p) return;
        const st = String(it.status || ''), det = String(it.detail || ''), imp = String(it.impact || '');
        const short = `[${it.date || 'Aug-Sep 2026'}] ${st}${det ? ' - ' + det.slice(0, 160) : ''}`.trim();
        // Team changes reported after the projection snapshot win.
        const nt = FIX[String(it.team || '').toUpperCase()] || String(it.team || '').toUpperCase();
        if (TEAMS.has(nt) && nt !== p.team) { warnings.push(`NEWS: ${p.name} team ${p.team} -> ${nt}`); p.team = nt; }
        if (imp === 'out-season' || /^(retired|out for (the )?season)/i.test(st)) {
          p.status = 'out-season';
        } else if (nt === 'FA' || /unsigned|released|waived|not draftable|cut at/i.test(st + ' ' + imp) && !/re-signed|signed/i.test(st)) {
          p.status = 'unsigned'; scale(p, 0); p.adp = Math.max(p.adp || 300, 250);
          warnings.push(`NEWS: ${p.name} unsigned/released -> zeroed`);
        } else if (imp === 'out-weeks') {
          p.status = 'injured-short';
          scale(p, /indefinite|exempt/i.test(st + det) ? 0.55 : 0.72);
          warnings.push(`NEWS: ${p.name} out-weeks -> projection scaled`);
        } else if (/suspend/i.test(st + imp)) { p.status = 'suspended'; scale(p, 0.75); }
        else if (imp === 'questionable' || /questionable|doubtful|50-50|in doubt|pup/i.test(st)) { if (p.status === 'healthy') p.status = 'questionable'; }
        p.notes = (short + (p.notes ? ' | ' + p.notes : '')).slice(0, 400);
      });
    });
  } catch (e) { warnings.push('news.json invalid: ' + e.message); }
}
// Calibrate each position's projection curve toward typical half-PPR projection benchmarks (rank -> points), since
// the per-position files came from independent estimates. Blend 50/50 by projection rank; stat lines scale with it.
const BENCH = {
  QB: [[1, 372], [3, 350], [6, 328], [12, 295], [18, 270], [24, 245], [32, 215]],
  RB: [[1, 305], [3, 272], [6, 248], [12, 212], [18, 188], [24, 168], [30, 148], [36, 128], [48, 102], [60, 82], [75, 60]],
  WR: [[1, 282], [3, 258], [6, 238], [12, 212], [18, 196], [24, 182], [30, 170], [36, 157], [48, 138], [60, 120], [80, 95]],
  TE: [[1, 212], [3, 172], [6, 146], [12, 120], [18, 102], [24, 90], [30, 75]],
};
function benchAt(curve, rank) {
  if (rank <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) if (rank <= curve[i][0]) { const [r0, v0] = curve[i - 1], [r1, v1] = curve[i]; return v0 + (v1 - v0) * (rank - r0) / (r1 - r0); }
  return curve[curve.length - 1][1];
}
const CAL_W = 0.5;
const SCALE_KEYS = ['pass_yds', 'pass_td', 'pass_int', 'rush_att', 'rush_yds', 'rush_td', 'rec', 'rec_yds', 'rec_td', 'fumbles'];
Object.keys(BENCH).forEach(pos => {
  const list = all.filter(p => p.pos === pos && p.status !== 'out-season' && p.status !== 'unsigned' && p.proj_pts_halfppr > 0)
    .sort((a, b) => b.proj_pts_halfppr - a.proj_pts_halfppr);
  list.forEach((p, i) => {
    const target = benchAt(BENCH[pos], i + 1);
    const blended = (1 - CAL_W) * p.proj_pts_halfppr + CAL_W * target;
    const f = blended / p.proj_pts_halfppr;
    SCALE_KEYS.forEach(k => { if (p[k]) p[k] = Math.round(p[k] * f * 10) / 10; });
    p.proj_pts_halfppr = Math.round(blended * 10) / 10;
  });
});
// Out-for-season players: keep in pool (so they can be marked drafted) but zero their projection.
all.forEach(p => { if (p.status === 'out-season') { NUM.slice(3).forEach(k => { if (k !== 'adp' && k !== 'tier' && k !== 'bye') p[k] = 0; }); p.proj_pts_halfppr = 0; p.adp = Math.max(p.adp || 300, 250); } });
all.sort((a, b) => (a.adp || 300) - (b.adp || 300));

const out = { generated: new Date().toISOString(), season: 2026, scoring_basis: 'half-PPR projections; points recomputed in-app from stat lines', players: all };
fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'data', 'players.json'), JSON.stringify(out, null, 1));
let notes = {};
const sn = path.join(rawDir, 'strategy_notes.json');
if (fs.existsSync(sn)) { try { notes = JSON.parse(fs.readFileSync(sn, 'utf8')); } catch (e) { warnings.push('strategy_notes.json invalid'); } }
const js = `// Generated by scripts/build-data.js on ${out.generated}. Do not edit by hand; edit data/raw/*.json and rebuild.\n` +
  `window.PLAYER_DATA = ${JSON.stringify(out)};\n` +
  `window.STRATEGY_NOTES = ${JSON.stringify(notes)};\n`;
fs.writeFileSync(path.join(__dirname, '..', 'app', 'players.js'), js);
const counts = {}; all.forEach(p => { counts[p.pos] = (counts[p.pos] || 0) + 1; });
console.log('players:', all.length, JSON.stringify(counts));
if (warnings.length) { console.log('warnings (' + warnings.length + '):'); warnings.slice(0, 60).forEach(w => console.log(' -', w)); }
