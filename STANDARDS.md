# Jaren's Bets — App Standards

Every app in this repo is a single-file HTML app backed by Firebase, graded by
GitHub Actions. They were built at different times and differ internally. This
document is the target standard: new code must follow it, and existing apps get
migrated toward it opportunistically (never as a big-bang rewrite — grades and
locked picks are live data).

## The one rule that outranks everything
**Never lie about accuracy.** A grade changes only when the real game result
changes. Verified/confirmed picks are frozen. Cron must verify its own work
(re-read what it wrote) before reporting success.

## Standard app anatomy (target for all four apps)
Every app is organized into the same named sections, in this order, each marked
with a `/* ═══ SECTION: NAME ═══ */` banner comment so anyone can navigate any
app the same way:

1. **CONFIG** — constants, thresholds, league baselines, park factors.
2. **DATA** — every network fetch (MLB/ESPN/Savant/DK), each non-fatal with a
   graceful fallback. No fetch may hard-fail the app (see ESPN gotcha below).
3. **MODEL** — pure scoring functions: inputs in, `{exp/prob, reasons, math}`
   out. No DOM access, no fetches, no Firebase.
4. **STORE** — localStorage + Firebase read/write. All bulk writes serialized
   (await each; Firestore's queued-write cap throws on fresh runners).
5. **GRADE** — turns stored picks + box scores into per-market tallies. Reads
   ONLY stored picks and real results — never recomputes a prediction at grade
   time.
6. **RENDER** — tabs/screens. Standard tab set: **Today** (picks, strongest
   first) · **Results** (success explorer) · **Settings**.
7. **CRON** — `?cron=1` (grade) and, where picks need generating, `?cron=picks`.
   Sets `window.__cronStatus` (progress) and `window.__cronDone` (true only
   after verifying the write landed).

## Standard UI behaviors (all apps)
- **Picks list**: one flat list sorted by confidence, strongest first; each row
  shows its market, confidence %, and ✓/✗ once the game is final.
- **Results explorer**: market chips + 14-day/all-time toggle + per-date rows
  that expand to show the exact picks that made that number.
- **Cloud sync**: fully automatic on open. Manual buttons may exist only as a
  "refresh now" convenience, never as the only path.
- **Every projection carries its receipts**: `reasons` chips and a `math` line
  so a paying customer can see WHY, not just a number.

## Market conventions
- Probability markets (hits, HR, winner): graded hit/miss at the lock
  threshold; tallies `{h,n}`.
- Line markets (K, BB, TB, game K, game HRs): model exp vs a line, lean
  OVER/UNDER only past the edge threshold; tallies `{w,l,p}` via `lineGrade`.
- Game-level rows use id `'g'+gamePk` so box-score lookups resolve generically.

## Cron / automation rules
- Check Firebase readiness with the SAME variable the app uses
  (`FB` in diamondiqfree.html is script-scoped — NOT `window.FB`).
- "It ran" ≠ "it worked": after grading, re-read the summary and confirm the
  day landed before setting `__cronDone` without an ERROR status.
- Idempotent by design: re-runs skip verified/graded work.

## Known gotchas (do not rebreak)
- ESPN `/teams` and `/roster` send no CORS headers — the NBA roster fetch is
  deliberately non-fatal with box-score fallback.
- Firestore queued-write cap: serialize bulk writes.
- GitHub Pages serves `main` only; scheduled workflows run from `main` only.

## Current migration status
| App | Sections banner | Sorted picks + ✓/✗ | Results explorer | Auto sync | Cron verify |
|---|---|---|---|---|---|
| nba.html | partial | ✅ | ✅ | ✅ | ✅ |
| premium.html | partial | ✅ (per market) | ✅ | ✅ | ✅ |
| diamondiqfree.html | ❌ (largest file — next up) | partial (locks sorted; ✓/✗ live in Fact Check) | ✅ (14-day) | ✅ | ✅ |
| nfl.html | partial | ✅ | ✅ | ✅ | ✅ |
| hockey.html | ✅ (built to standard) | ✅ | ✅ | ✅ | ✅ |
