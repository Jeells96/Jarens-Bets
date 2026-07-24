#!/usr/bin/env node
/* Jaren's Bets — weekly Model Lab autopilot (GitHub Actions)
   Loads each app with ?lab=1 in headless Chromium. Every app's lab branch
   re-learns from the latest stored season (forward-tested: weights/calibration
   are chosen on older games and judged only on games they never saw),
   publishes {ns}/labReport, and — for bet types the Board marked AUTO —
   applies the tuned version when it passes the forward test or reverts to
   default when it doesn't. Manual (non-auto) choices are never touched.
   All results render only inside the Board's PIN-gated Model Lab tab. */

const { chromium } = require('playwright');

const BASE = 'https://jeells96.github.io/Jarens-Bets/';
const APPS = [
  { name: "Pete's Picks (NASCAR)",  file: 'nascar.html',  timeoutMin: 20 },
  { name: 'Diamond IQ Premium',     file: 'premium.html', timeoutMin: 15 },
  { name: 'Gridline (NFL)',         file: 'nfl.html',     timeoutMin: 10 },
  { name: 'The Key (NBA)',          file: 'nba.html',     timeoutMin: 45 },
  { name: 'Icing (NHL)',            file: 'hockey.html',  timeoutMin: 45 },
];

(async () => {
  const browser = await chromium.launch();
  let failures = 0;

  for (const app of APPS) {
    const url = BASE + app.file + '?lab=1';
    const t0 = Date.now();
    console.log('\n=== ' + app.name + ' (Model Lab) ===\n    ' + url);
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('console', (msg) => {
      const t = msg.text();
      if (/lab|error|warn|fail|auto|forward|weight|calib|rating|firebase/i.test(t)) console.log('    [page] ' + t.slice(0, 220));
    });
    page.on('pageerror', (err) => console.log('    [pageerror] ' + String(err).slice(0, 200)));

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
      const deadline = Date.now() + app.timeoutMin * 60_000;
      let lastStatus = '';
      while (Date.now() < deadline) {
        const done = await page.evaluate(() => window.__labDone === true).catch(() => false);
        const status = await page.evaluate(() => String(window.__labStatus || '')).catch(() => '');
        if (status && status !== lastStatus) { console.log('    ' + status); lastStatus = status; }
        if (done) break;
        await new Promise((r) => setTimeout(r, 3000));
      }
      const done = await page.evaluate(() => window.__labDone === true).catch(() => false);
      const status = await page.evaluate(() => String(window.__labStatus || '')).catch(() => '');
      const mins = ((Date.now() - t0) / 60000).toFixed(1);
      if (!done) {
        failures++;
        console.log('    TIMEOUT after ' + mins + ' min (last status: ' + (status || 'none') + ')');
      } else if (/ERROR/.test(status)) {
        // A lab error (e.g. "not enough stored games yet" in the offseason) is
        // reported but doesn't fail the whole run — the other sports still learn.
        console.log('    SKIPPED/ERROR in ' + mins + ' min — ' + status);
      } else {
        console.log('    DONE in ' + mins + ' min — ' + status);
      }
    } catch (e) {
      failures++;
      console.log('    FAILED: ' + String(e).slice(0, 300));
    }
    await context.close();
  }

  await browser.close();
  process.exit(failures ? 1 : 0);
})();
