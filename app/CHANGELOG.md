# Changelog

Shipped changes to the Gambling Baptist app, newest first. Dates are when the change went live. Details live in `HANDOFF.md`; this file says what changed and why.
History before Nov 18, 2026 was not logged here; see `git log` on `app-source` and the dated rules in `HANDOFF.md`.

## 2026-11-25
- **Gleanings** (replaces Testimonies). One pool of outside player notes, never credited, filtered to rosters. Page in the More sheet and top tabs (`#glean`) with chips Your team, This week's opponent, Whole league (saved as `gb-glscope`); starters first, then bench; an "Around your teams" block for NFL team notes. Home tile "Your Gleanings" (3 notes from your roster, rotating with Did You Know; 2 league-wide notes when no one is picked). Player card section "Gleanings" with his NFL team's note. Green or red left border for tone; Late-Round tags kept; numbers bold; "Wk N" on each line.
- `notes.json` is now `{season, items, teams}` with `src` per line (`lr` Late-Round, `nl` newsletter; never shown). The old `{week, notes}` shape still loads.
- First newsletter load (games through Week 11): 47 player notes, 6 team notes (`tools/nl_2026_w11.py`). Lines that repeated a Late-Round note were merged away (Josh Allen's no-rush game, DJ Moore's full-time split, Olave's target share, Tyson's routes, Downs's route share, Rodgers's air yards). No defenders, no trade or waiver advice, no trivia.
- New check: `checks/glean.js`.
- Did You Know rotated (`DYK_SEED` 63).

## 2026-11-24
- **Week 12 export** (Sleeper rolled to Week 12, exported 1:23 pm CT). Sleeper's own Week 11 scores match the ones copied in on Nov 23 for all 12 teams. Adds 4 late Week 11 moves and 8 Week 12 pickups, Week 12 projections, and two injury changes (Adam Randall Out, Denzel Boston Questionable). `dykBump` carried over (29).
- **Testimonies:** Week 11 Late-Round dump loaded, 42 notes on rostered players (10 New Calling, 11 Back Pew, 3 Manna, 5 Fasting, 13 untagged). Replaces the Week 9 set. Every number checked against the PDF text.
- Did You Know rotated (`DYK_SEED` 62).

## 2026-11-23
- **Week 11 final export** loaded by the commissioner through the drop zone (Did You Know bumped by the drop zone). Week 11 sits in `live` until Sleeper rolls to Week 12.
- **Week 11 scored as final** (Benton's call, before Sleeper rolled the week): the final `live` rows copied into `matchups["11"]` and `last_scored_leg` set to 11, so standings, odds, recap, and everything else run through Week 11. The next export replaces this with Sleeper's own Week 11.
- **Commissioner's call:** Brock Bowers back Week 12.
- `checks/exodus_review.py`: the calls regex now reads the multi-line `EX_CALLS` block.
- `checks/vigil_fixture.py` needs usage data for the last scored week, so run it on an export where the in-progress week is not yet scored.
- **Backup sync:** live source pulled to `src/`. It carries the Nov 22 calls that were live but not on this branch: Davante Adams back Week 15 (was 14), Josh Jacobs back Week 13 (was 12). `DYK_SEED` 60.

## 2026-11-20
- **Handcuff table additions:** Perine 13 with Chase Brown out, Singletary 12 with Skattebo out, and Green Bay with Jacobs out: Kaleb Johnson 11, Lloyd 8.5. All four are free agents now; they are in the table so a pickup before the playoffs counts.
- **RB handcuffs in the roster engine.** When a lead back is out (random injury, a call, or no game), his handcuff plays to a reviewed "lead out" number for that week, whoever owns either man. Unrostered leads are in the injury draw. Denver and Arizona have role changes from Week 13. Table locked for the season (`HANDCUFFS`, `HC_NORM`); rebuilt each year around Week 11 with Benton's review. Rule for drafting it: RB2 +30%, RB3 +17% of the lead's points. Effect: title odds moved under 0.6 points for every team.
- **Commissioner's call:** Davante Adams back Week 14 (was 13, same night).
- **Commissioner's calls for every rostered injured player** (Walker 12, Jacobs 12, Wan'Dale Robinson 14, Harvey 13, Kincaid 12, Love 13, Croskey-Merritt 11, Omar Cooper 13, A.J. Brown 14, Addison 14, McGowan 13; Puka, Aiyuk, Maye out for the season).
- **Bench before waiver fill-ins.** A hurt starter's slot goes to the best healthy rostered player who can play it; the waiver-level fill-in plays only when nobody on the roster can.
- **Roster engine.** Standings odds, What's at Stake, The Promised Land, and Exodus title odds now play the rest of the season from today's rosters, with random injuries at NFL rates (`INJ_RATE`, nflverse 2023-2025), current injuries finishing their absence, and waiver fill-ins (`FILL_IN`). One shared run feeds the playoff field, injuries, and title odds. Game leans in The Promised Land come from the same runs. League scale about 0.96 on regular-season means.
- **Checks:** `checks/engine_check.js` (injury rates, absence lengths, lineups, fill-ins, handcuffs). `checks/exodus_recheck.py` now reads the multi-line `EX_CALLS` block (its regex had broken when the calls list grew to several lines) and recomputes handcuff weeks.

## 2026-11-19
- **Pair correlations** for the Monday Night Vigil and Exodus title odds (`CORR`, `corrSampler`, `CORR_LIFT`), replacing the single team factor of 0.27. League data blended with published priors. Checks: `checks/corr_calib.py`, `checks/corr_check.js`.

## 2026-11-18
- The Promised Land: Randomize quick path.
- Trades: a trade with no games since shows "no games yet."
- Week 11 trade values (Reddit and FantasyPros ECR, 50/50). Maye out for the season.
- Exodus: Achane and Henderson out for the season; the review lists injured teammates behind adjustments.
- Pew Chart: Exodus at the bottom; title odds note explains per-run seeding.
- Exodus: commissioner's calls and teammate context.
