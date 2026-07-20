#!/usr/bin/env node
/* Jaren's Bets — grading autopilot (GitHub Actions)
   Loads each live app page with ?cron=1 in headless Chromium. Every app has a
   cron branch that runs its OWN grading + Firebase push (no model duplication,
   so the hub's numbers can never drift from what the apps show), then sets
   window.__cronDone = true with a human-readable window.__cronStatus.

   All four runs are idempotent — already-graded days/weeks are skipped, and
   re-grading recomputes identical results — so any cadence is safe. */

const { chromium } = require('playwright');

const BASE = 'https://jeells96.github.io/Jarens-Bets/';
const ALL = {
  // Keyed so each app can run in its OWN workflow: node grade_cron.js <key>
  nba:     { name: 'The Key (NBA)',       file: 'nba.html',           timeoutMin: 50 },
  premium: { name: 'Diamond IQ Premium',  file: 'premium.html',       timeoutMin: 12 },
  free:    { name: 'Diamond IQ Free',      file: 'diamondiqfree.html', timeoutMin: 15 },
  nfl:     { name: 'Gridline (NFL)',       file: 'nfl.html',           timeoutMin: 20 },
  hockey:  { name: 'Icing (NHL)',        file: 'hockey.html',        timeoutMin: 45 },
};
const key = (process.argv[2] || process.env.APP || '').toLowerCase();
if (key && !ALL[key]) { console.log('Unknown app "' + key + '" — use one of: ' + Object.keys(ALL).join(', ')); process.exit(1); }
const APPS = key ? [ALL[key]] : Object.values(ALL); // one app, or all when no key

(async () => {
  const browser = await chromium.launch();
  let failures = 0;

  for (const app of APPS) {
    const url = BASE + app.file + '?cron=1';
    const t0 = Date.now();
    console.log('\n=== ' + app.name + ' ===\n    ' + url);
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('console', (msg) => {
      const t = msg.text();
      if (/error|warn|cron|grade|firebase|espn|probe|http|record|seed|built|build|mirror|picks|lineup|\[nba\]|\[diq\]|\[page\]/i.test(t)) console.log('    [page] ' + t.slice(0, 220));
    });
    page.on('pageerror', (err) => console.log('    [pageerror] ' + String(err).slice(0, 200)));

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      // Poll status while waiting so the Action log shows progress.
      const deadline = Date.now() + app.timeoutMin * 60_000;
      let lastStatus = '';
      while (Date.now() < deadline) {
        const done = await page.evaluate(() => window.__cronDone === true).catch(() => false);
        const status = await page.evaluate(() => String(window.__cronStatus || '')).catch(() => '');
        if (status && status !== lastStatus) { console.log('    ' + status); lastStatus = status; }
        if (done) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
      const done = await page.evaluate(() => window.__cronDone === true).catch(() => false);
      const status = await page.evaluate(() => String(window.__cronStatus || '')).catch(() => '');
      const mins = ((Date.now() - t0) / 60000).toFixed(1);
      if (!done) {
        failures++;
        console.log('    TIMEOUT after ' + mins + ' min (last status: ' + (status || 'none') + ')');
      } else if (/ERROR/i.test(status)) {
        failures++;
        console.log('    FAILED in ' + mins + ' min: ' + status);
      } else {
        console.log('    OK in ' + mins + ' min: ' + status);
      }
    } catch (e) {
      failures++;
      console.log('    FAILED to load: ' + e.message);
    } finally {
      await context.close();
    }
  }

  await browser.close();
  console.log('\n' + (failures ? failures + ' app(s) failed — see log above' : 'All apps graded'));
  process.exit(failures ? 1 : 0);
})();
