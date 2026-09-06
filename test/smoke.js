/* Headless smoke test: loads the app from the local server, simulates picks, checks the UI updates. */
const { chromium } = require('playwright-core');
const path = require('path');
const { spawn } = require('child_process');

(async () => {
  const port = 3222;
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), String(port)], { stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 700));
  const exe = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    // reset server picks
    await page.request.delete(`http://localhost:${port}/api/picks`);
    await page.goto(`http://localhost:${port}/`);
    await page.waitForSelector('#players tbody tr');
    const rows = await page.$$eval('#players tbody tr', r => r.length);
    console.log('rows rendered:', rows);

    // draft via search + Enter
    await page.fill('#search', 'gibbs');
    await page.waitForSelector('#dropdown div[data-id]');
    await page.press('#search', 'Enter');
    await page.waitForFunction(() => window.DraftApp.state.picks.length === 1);
    console.log('pick 1 ok:', await page.evaluate(() => window.DraftApp.state.picks[0].playerId));

    // draft via table button
    await page.click('#players .draft-btn');
    await page.waitForFunction(() => window.DraftApp.state.picks.length === 2);

    // undo via ctrl+z
    await page.keyboard.press('Control+z');
    await page.waitForFunction(() => window.DraftApp.state.picks.length === 1);
    console.log('undo ok');

    // server sync push
    await page.request.post(`http://localhost:${port}/api/sync`, { data: { names: ['Bijan Robinson', "Ja'Marr Chase"] } });
    await page.waitForFunction(() => window.DraftApp.state.picks.length === 3, null, { timeout: 5000 });
    console.log('sse sync ok');

    // paste import
    await page.click('#btnSync');
    await page.fill('#pastePicks', '1.04 Team D  Puka Nacua (LAR - WR)\n1.05 Team E  Josh Allen (BUF - QB)');
    await page.click('#btnParsePicks');
    await page.waitForFunction(() => window.DraftApp.state.picks.length === 5);
    console.log('paste ok:', await page.textContent('#pasteResult'));
    await page.click('#btnSyncClose');

    // settings: parse pasted Yahoo settings
    await page.click('#btnSettings');
    await page.evaluate(() => document.querySelectorAll('#settingsModal details').forEach(d => { d.open = true; }));
    await page.fill('#settingsPaste', 'Max Teams: 12\nRoster Positions: QB, WR, WR, WR, RB, RB, TE, W/R/T, K, DEF, BN, BN, BN, BN, BN, IR\nPassing Yards 25 yards per point\nPassing Touchdowns 4\nInterceptions -1\nReceptions 1\nReception Yards 10 yards per point');
    await page.click('#btnParseSettings');
    console.log('settings parse:', await page.textContent('#parseResult'));
    await page.click('#btnSettingsSave');
    const st = await page.evaluate(() => ({ teams: window.DraftApp.state.settings.teams, bn: window.DraftApp.state.settings.roster.BN, rec: window.DraftApp.state.settings.scoring.rec, pass: window.DraftApp.state.settings.scoring.pass_yds }));
    console.log('settings applied:', JSON.stringify(st));

    // Yahoo API surface: not configured on a fresh checkout, endpoints answer sanely, modal renders the setup step
    const ys = await page.request.get(`http://localhost:${port}/api/yahoo/status`).then(r => r.json());
    if (ys.configured !== false || ys.authorized !== false || ys.league !== null) errors.push('yahoo status unexpected: ' + JSON.stringify(ys));
    const au = await page.request.get(`http://localhost:${port}/api/yahoo/auth-url`);
    if (au.status() !== 500) errors.push('auth-url should fail when unconfigured');
    const lp = await page.request.post(`http://localhost:${port}/api/yahoo/poll`);
    if (lp.status() !== 400) errors.push('poll without a league should be 400');
    await page.click('#btnSync');
    await page.waitForFunction(() => /client id/.test(document.getElementById('yahooStatus').textContent));
    const credsHidden = await page.$eval('#yahooCreds', el => el.hidden);
    const leagueHidden = await page.$eval('#yahooLeagueRow', el => el.hidden);
    if (credsHidden || !leagueHidden) errors.push('yahoo modal should show credentials step only');
    await page.click('#btnSyncClose');
    console.log('yahoo endpoints ok');

    // Yahoo picks: authoritative, pick-numbered, unknown players get placeholders, team overrides honoured
    const yr = await page.evaluate(() => {
      window.DraftApp.applyLeagueSettings({ teams: 12, myPick: 5, teamNames: ['A', 'B', 'C', 'D', 'Me', 'F', 'G', 'H', 'I', 'J', 'K', 'L'], roster: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SFLEX: 0, K: 1, DEF: 1, BN: 5 }, scoring: { rec: 1 } });
      const r = window.DraftApp.applyYahooPicks([
        { pick: 1, round: 1, name: 'Bijan Robinson', pos: 'RB', team: 'ATL', teamIdx: 0 },
        { pick: 2, round: 1, name: 'Someone Unknown', pos: 'WR', team: 'ZZZ', teamIdx: 1 },
        { pick: 3, round: 1, name: 'Baltimore', pos: 'DEF', team: 'BAL', teamIdx: 7 },
      ]);
      const st = window.DraftApp.state;
      return { r, teams: st.settings.teams, myPick: st.settings.myPick, rec: st.settings.scoring.rec, wr: st.settings.roster.WR, picks: st.picks.map(p => [p.playerId, p.teamOverride, p.source]), extra: st.extraPlayers.length };
    });
    console.log('yahoo picks:', JSON.stringify(yr));
    if (!yr.r.replaced || yr.teams !== 12 || yr.myPick !== 5 || yr.rec !== 1 || yr.wr !== 2) errors.push('league settings/picks not applied: ' + JSON.stringify(yr));
    if (yr.picks.length !== 3 || yr.picks[1][0] !== 'yahoo-someone-unknown-wr' || yr.picks[2][0] !== 'ravens-d-st-def' || yr.picks[2][1] !== 7 || yr.picks[0][1] !== undefined) errors.push('yahoo pick mapping wrong: ' + JSON.stringify(yr.picks));
    const teamsShown = await page.textContent('#board');
    if (!/Me/.test(teamsShown)) errors.push('team names from league not rendered');

    const status = await page.textContent('#status');
    console.log('status:', status.replace(/\s+/g, ' ').trim());
    const advice = await page.textContent('#advice');
    console.log('advice head:', advice.replace(/\s+/g, ' ').trim().slice(0, 200));
    await page.screenshot({ path: path.join(__dirname, '..', 'dist', 'screenshot.png'), fullPage: false });
  } catch (e) { errors.push('test: ' + e.message); }
  await browser.close();
  srv.kill();
  if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log('SMOKE OK');
})();
