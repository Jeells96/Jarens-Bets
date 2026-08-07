#!/usr/bin/env node
/* Jaren's Bets — daily health check (GitHub Actions)
   Reads each app's live summary doc straight from Firestore and FAILS the
   workflow (GitHub then emails the owner) if any record has gone stale.
   "It ran" is never trusted — this checks the data the members actually see.
   It also checks the reverse: that every scheduled workflow is still firing,
   so a run that never starts can't pass for a quiet day. */

const FS = 'https://firestore.googleapis.com/v1/projects/';
const MLB = { p: 'mlb-bets-d196c', k: 'AIzaSyAm8TgK3Hl5ndWmqpYlBJs-u64JbeIg2W0' };
const NFL = { p: 'nflbets-45561', k: 'AIzaSyAznP57admgAtnJqnMu7uJ6WZYpYjrIP3g' };

const now = new Date();
const daysAgo = (iso) => (now - new Date(iso)) / 86400000;
const inWindow = (fromMD, toMD) => {
  // month-day window that may wrap the new year, e.g. Oct 1 → Jul 5
  const md = (now.getUTCMonth() + 1) * 100 + now.getUTCDate();
  const [f, t] = [fromMD, toMD];
  return f <= t ? (md >= f && md <= t) : (md >= f || md <= t);
};

async function getDoc(cfg, path){
  const r = await fetch(FS + cfg.p + '/databases/(default)/documents/' + path + '?key=' + cfg.k, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' reading ' + path);
  return r.json();
}
const failures = [];
const ok = (name, msg) => console.log('  OK   ' + name + ' — ' + msg);
const bad = (name, msg) => { failures.push(name); console.log('  FAIL ' + name + ' — ' + msg); };

/* ── Did the automation actually run? ───────────────────────────────────────
   The checks above ask whether the DATA is fresh. This asks whether the jobs
   ever started. On 2026-08-06 every workflow was queued and then cancelled
   without a runner ever being assigned — nothing ran for fourteen hours and
   nothing said so. A stall is now as loud as a stale record. */
const fs = require('fs');
const path = require('path');
const WF_DIR = '.github/workflows';

// hours between fires, for the cron shapes this repo actually uses
function cronHours(expr){
  const f = String(expr).trim().split(/\s+/);
  if (f.length !== 5) return null;
  const [min, hour, dom, , dow] = f;
  if (dow !== '*') return 168;              // weekly
  if (dom !== '*') return null;             // monthly-ish — not worth policing
  const mins = min.split(',').length;
  if (hour === '*') return 1 / mins;
  const every = /^\*\/(\d+)$/.exec(hour);
  if (every) return Number(every[1]) / mins;
  if (/^\d+(,\d+)*$/.test(hour)) return 24 / (mins * hour.split(',').length);
  return null;
}

async function checkWorkflowsRan(){
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo){
    console.log('  SKIP workflow stall check — no GITHUB_TOKEN/GITHUB_REPOSITORY');
    return;
  }
  let files;
  try { files = fs.readdirSync(WF_DIR).filter(f => /\.ya?ml$/.test(f)); }
  catch (e){ bad('workflow stall check', 'cannot read ' + WF_DIR + ': ' + e.message); return; }

  for (const file of files){
    const src = fs.readFileSync(path.join(WF_DIR, file), 'utf8');
    const m = /^\s*-\s*cron:\s*["']([^"']+)["']/m.exec(src);
    if (!m) continue;                        // no schedule — nothing to stall
    const hrs = cronHours(m[1]);
    if (hrs == null) continue;
    if (file === 'health.yml') continue;      // this run IS its own proof

    const url = 'https://api.github.com/repos/' + repo + '/actions/workflows/' +
                encodeURIComponent(file) + '/runs?per_page=1';
    try {
      const r = await fetch(url, { headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const runs = (await r.json()).workflow_runs || [];
      if (!runs.length){ bad(file, 'has a schedule but has never run'); continue; }
      const last = runs[0];
      const gapH = (now - new Date(last.created_at)) / 3600000;
      const limit = Math.max(hrs * 3, 1.5);   // GitHub drops the odd cron tick
      const when = last.created_at + ' (' + gapH.toFixed(1) + 'h ago, ' +
                   (last.conclusion || last.status) + ')';
      if (gapH > limit) bad(file, 'last run ' + when + ' — expected one every ' + hrs + 'h');
      else ok(file, 'last run ' + when);
    } catch (e){ bad(file, 'could not read its runs: ' + e.message); }
  }
}

(async () => {
  console.log('Health check ' + now.toISOString() + '\n');

  // MLB (Premium + Free share the summary): newest graded day within 2 days.
  try {
    const j = await getDoc(MLB, 'fable_settings/summary');
    const days = Object.keys(((j.fields || {}).days || {}).mapValue?.fields || {}).sort();
    const newest = days[days.length - 1];
    if (!newest) bad('MLB summary', 'no graded days at all');
    else if (daysAgo(newest + 'T12:00:00Z') > 2.5) bad('MLB summary', 'newest graded day is ' + newest);
    else ok('MLB summary', 'newest graded day ' + newest);
  } catch (e){ bad('MLB summary', e.message); }

  // The Key (NBA): allTime doc rewritten every grading run, year-round.
  try {
    const j = await getDoc(NFL, 'nba/allTime');
    const t = j.fields?.t?.stringValue;
    if (!t) bad('NBA allTime', 'missing timestamp');
    else if (daysAgo(t) > 2) bad('NBA allTime', 'last write ' + t);
    else ok('NBA allTime', 'last write ' + t);
  } catch (e){ bad('NBA allTime', e.message); }

  // IceLine (NHL): same pattern.
  try {
    const j = await getDoc(NFL, 'nhl/allTime');
    const t = j.fields?.t?.stringValue;
    if (!t) bad('NHL allTime', 'missing timestamp');
    else if (daysAgo(t) > 2) bad('NHL allTime', 'last write ' + t);
    else ok('NHL allTime', 'last write ' + t);
  } catch (e){ bad('NHL allTime', e.message); }

  // Gridline (NFL): weekly cadence; in season expect fresh writes. Offseason
  // the fingerprint memo skips unchanged writes, so only require the docs to
  // exist. Season window: Sep 1 → Feb 20.
  try {
    const r = await fetch(FS + NFL.p + '/databases/(default)/documents/accuracy?key=' + NFL.k + '&pageSize=300&mask.fieldPaths=updatedAt');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const docs = (await r.json()).documents || [];
    const weekly = docs.filter(d => /_W\d+$/.test(d.name));
    if (!weekly.length){ bad('NFL accuracy', 'no weekly docs'); }
    else if (inWindow(901, 220)){
      const newest = Math.max(...weekly.map(d => +(d.fields?.updatedAt?.integerValue || d.fields?.updatedAt?.doubleValue || 0)));
      if (daysAgo(new Date(newest).toISOString()) > 8) bad('NFL accuracy', 'newest weekly write ' + new Date(newest).toISOString());
      else ok('NFL accuracy', 'in-season, newest write ' + new Date(newest).toISOString());
    } else ok('NFL accuracy', weekly.length + ' weekly docs present (offseason)');
  } catch (e){ bad('NFL accuracy', e.message); }

  console.log('');
  await checkWorkflowsRan();

  console.log('');
  if (failures.length){
    console.log('UNHEALTHY: ' + failures.join(', '));
    process.exit(1);
  }
  console.log('All records healthy');
})();
