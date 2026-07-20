#!/usr/bin/env node
/* Jaren's Bets — daily health check (GitHub Actions)
   Reads each app's live summary doc straight from Firestore and FAILS the
   workflow (GitHub then emails the owner) if any record has gone stale.
   "It ran" is never trusted — this checks the data the members actually see. */

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
  if (failures.length){
    console.log('UNHEALTHY: ' + failures.join(', '));
    process.exit(1);
  }
  console.log('All records healthy');
})();
