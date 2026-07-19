#!/usr/bin/env node
/* Jaren's Bets — scheduled DK pulls (GitHub Actions)
   Loads Premium (MLB props) and Gridline (NFL odds) with ?cron=dk. Each page
   reads the Board's settings doc (app_settings/dk_auto) and pulls ONLY if its
   toggle is on and the current Eastern hour is in its configured list — so
   this workflow can run hourly while API quota is spent exactly on Jaren's
   schedule. A skipped hour reports "skipped", not failure. */

const { chromium } = require('playwright');

const BASE = 'https://jeells96.github.io/Jarens-Bets/';
const APPS = [
  { name: 'Diamond IQ Premium (MLB props)', file: 'premium.html', timeoutMin: 8 },
  { name: 'Gridline (NFL odds)',            file: 'nfl.html',     timeoutMin: 8 },
];

(async () => {
  const browser = await chromium.launch();
  let failures = 0;

  for (const app of APPS) {
    const url = BASE + app.file + '?cron=dk';
    const t0 = Date.now();
    console.log('\n=== ' + app.name + ' (DK pull) ===\n    ' + url);
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('console', (msg) => {
      const t = msg.text();
      if (/error|warn|fail|dk|odds|quota|firebase|pull|props|skip/i.test(t)) console.log('    [page] ' + t.slice(0, 220));
    });
    page.on('pageerror', (err) => console.log('    [pageerror] ' + String(err).slice(0, 200)));

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90_000 });
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
      if (!done) { failures++; console.log('    TIMEOUT after ' + mins + ' min (last: ' + (status || 'none') + ')'); }
      else if (/ERROR/i.test(status)) { failures++; console.log('    FAILED in ' + mins + ' min: ' + status); }
      else { console.log('    OK in ' + mins + ' min: ' + status); }
    } catch (e) {
      failures++;
      console.log('    FAILED to load: ' + e.message);
    } finally {
      await context.close();
    }
  }

  await browser.close();
  console.log('\n' + (failures ? failures + ' app(s) failed — see log above' : 'DK pull sweep complete'));
  process.exit(failures ? 1 : 0);
})();
