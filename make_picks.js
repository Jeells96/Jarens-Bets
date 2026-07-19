#!/usr/bin/env node
/* Jaren's Bets — daily pick generation (GitHub Actions)
   Loads the two MLB apps with ?cron=picks in headless Chromium. Each app runs
   its OWN "load / refresh" flow, which fetches the latest lineups from the free
   MLB Stats API, computes today's locks, freezes already-verified matchups
   (the confirm-locks rule), and saves the picks to Firebase — so the grading
   autopilot has something to score without anyone opening the app.

   No DraftKings / odds quota is spent: the apps read DK lines from Firebase
   (filled by the separate DK pull), and each app's live-pull function is
   neutralized in picks mode. Safe to run several times across the lineup
   window — verified matchups stay locked, so repeats can't corrupt anything.

   The Key (NBA) and Gridline (NFL) are NOT here: they rebuild picks from
   history at grade time, so they need no separate generation step. */

const { chromium } = require('playwright');

const BASE = 'https://jeells96.github.io/Jarens-Bets/';
const APPS = [
  { name: 'Diamond IQ Premium', file: 'premium.html',       timeoutMin: 12 },
  { name: 'Diamond IQ Free',    file: 'diamondiqfree.html', timeoutMin: 12 },
];

(async () => {
  const browser = await chromium.launch();
  let failures = 0;

  for (const app of APPS) {
    const url = BASE + app.file + '?cron=picks';
    const t0 = Date.now();
    console.log('\n=== ' + app.name + ' (make picks) ===\n    ' + url);
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on('console', (msg) => {
      const t = msg.text();
      if (/error|warn|picks|odds|firebase|lineup/i.test(t)) console.log('    [page] ' + t.slice(0, 200));
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
  console.log('\n' + (failures ? failures + ' app(s) failed — see log above' : 'Picks generated'));
  process.exit(failures ? 1 : 0);
})();
