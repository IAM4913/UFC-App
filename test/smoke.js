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
    page.on('console', m => { if (m.type() === 'error' && !/ERR_TUNNEL|fonts\.g|net::ERR/.test(m.text())) errors.push('console: ' + m.text()); });
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

    // chat panel present; server reports not-ready without a key
    await page.waitForFunction(() => /Local server found|Connected|Chat needs/.test(document.getElementById('chatStatus').textContent), null, { timeout: 8000 });
    console.log('chat status:', await page.textContent('#chatStatus'));
    const ctx = await page.evaluate(() => window.DraftChat.buildContext());
    console.log('chat context chars:', ctx.length, '| has recs:', /ENGINE TOP RECOMMENDATIONS/.test(ctx));
    const status = await page.textContent('#status');
    console.log('status:', status.replace(/\s+/g, ' ').trim());
    const advice = await page.textContent('#advice');
    console.log('advice head:', advice.replace(/\s+/g, ' ').trim().slice(0, 200));
    await page.evaluate(() => { document.querySelector('.tablewrap').scrollLeft = 0; });
    await page.screenshot({ path: path.join(__dirname, '..', 'dist', 'screenshot.png'), fullPage: false });
  } catch (e) { errors.push('test: ' + e.message); }
  await browser.close();
  srv.kill();
  if (errors.length) { console.error('ERRORS:\n' + errors.join('\n')); process.exit(1); }
  console.log('SMOKE OK');
})();
