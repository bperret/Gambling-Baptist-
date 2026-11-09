# Gambling Baptist app: session handoff

Benton does not handle zip files or attachments for this app. Do not ask for them.
The live app is the source of truth. This branch holds a backup of the source, the tools, the checks, and these notes.

## Start-up steps for Claude
1. `add_repo` bperret/Gambling-Baptist- with push access. Clone it and check out branch `app-source`. `main` holds the export page and stays as it is.
2. Run `Artifact read` on the app, with `path` for `index.html`, `data.json`, `values.json`, and `notes.json`. Also read it without `path`, or the publish is refused. Copy them into `app/`, with `index.html` as `app/live.html`.
3. From `app/`, run `python3 tools/sync.py`. This writes the live source to `src/`. If `src/` differs from the branch, the live page wins.
4. Before a publish, read `data.json` again. The commissioner can publish from the in-app drop zone at any time. If live is newer, use the live file.
5. After a publish, commit `app/src` and any notes to `app-source`, and push. Never send a zip.

## What exists
- **The app** (one artifact, "Anyone with the link," league members open it from GroupMe): https://claude.ai/artifact/6s6aBtqinFDfWT6L7iUyi2
  - Publish with `file_path` set to the absolute path of `app/index.html`, files `{"data.json": ..., "values.json": ..., "notes.json": ...}` as absolute paths, and that `url`.
  - Capabilities `{artifact: {}, user: {}}` are stored, so omit `capabilities`.
  - The live page carries its own source in `<script id="gb-src">` (JSON with `reset`, `shell`, `app`). `tools/build.py` keeps it current.
- **Sleeper export page:** https://bperret.github.io/Gambling-Baptist-/ (branch `main`). League members never use it.
  - It produces format `ffbc-sleeper-v3`: seasons with full `scoring_settings`, players, `injuries`, and `projections` (current season weeks 1 to now, scored with league settings, plus a `check` match rate, plus `games`: this week's team, opponent, and date).
  - `live` (added Nov 9): this week in progress. `rows` (lineups, starters_points, players_points), `teams` (`{opp, date, left}`; `left` means no player on that team has a stat line with games played this week), `pteam` (stat-line team per player), `statsOk`, `at`.
  - Claude's workspace cannot reach Sleeper. The commissioner runs the export on his phone.
- **League:** Sleeper league ID 1384696142750564352, 12 teams, 3 seasons (2024 to 2026). Scoring: 1-point PPR, plus (since 2025) 0.5 per rushing or receiving first down and 0.25 per passing first down. Slots: QB, RB, RB, WR, WR, TE, FLEX (W/R/T), K, DEF. Six teams make the playoffs, with points for as the tiebreaker.

## Build
- **Source:** `src/shell.html` (CSS and markup) and `src/app.js` (the league engine, trade values, and all views, joined into one file). The old split files (`ui.js`, `compute.js`, and the others) are retired.
- **Commands, from `app/`:** `python3 tools/build.py` builds `index.html`. `python3 tools/build.py --publish` also rotates Did You Know. Use it right before every publish.
- **Checks, before every publish.** Put `playwright` in the module path (it is preinstalled). Make a folder `sim`, run `python3 checks/hook.py index.html sim/index.html`, and copy `data.json` and `values.json` into `sim`.
  - `node checks/tiles.js sim`: 12 award tiles every week, full rows at 2, 3, and 4 columns.
  - `node checks/trends.js sim`, then `python3 checks/trends_recheck.py`: recomputes every Mover from raw data, with no app code.
  - `node checks/sermon.js sim 2026`: every week, no missing values, the two-line limit, no back-to-back repeats.
  - `node checks/views.js sim sim`: views at 360, 390, and 768 widths, light and dark, no errors or sideways scrolling.
  - `node checks/vigil.js sim sim` on fixture data (see Monday Night Vigil).
  - `node checks/plans.js sim`, then `python3 checks/gates.py data.json`: rechecks the sermon gates and Week 8 facts from raw data.
  - Recompute any new math independently before you call it done.
  - The older test scripts (`test4` to `test11`, `pubtest`, `mt-ui`, `g2`) were not recovered. Write a new check when work touches the drop zone, multi-team trades, or Spiritual Gifts.

## Weekly routine
The commissioner sends the export JSON (or uses the drop zone), the Reddit trade value chart screenshot, and the FantasyPros ROS ECR CSV (PPR, overall).
1. Transcribe the chart into a new week object: `{season, week, loaded, sources: {reddit: {name, w, rows}}}`. Each row is `{name, pos, team, v}`. Copy the last week in `values.json` for the format.
2. Copy `charts/reddit-2026-09.py` for the new week, run it, then run `python3 tools/ecr.py ecr.csv week.json`.
3. Append the week to `values.json` under `weeks`. Keep every week, because history drives Risers and Fallers and the trends.
4. Report unmatched names, and add aliases to `TV_ALIAS` in `src/app.js`.
5. If he pastes the Late-Round player notes, replace `notes.json` with the new week: `{season, week, source, notes: [{pid, tag, text}]}`. Keep rostered players only, rewrite each note, and report names that do not match. Tags: `call` New Calling (green), `pew` Back Pew (red), `manna` Manna, `fast` Fasting (neutral), or none. Label points "Standard PPR points." Expected Fantasy Points stay separate from Workload points. No small-sample or missing-context filters.
6. Run the checks, run `build.py --publish`, publish, and commit.

## Model settings (do not change without being asked)
- **Trade value blend (Benton's rule, updated Nov 4):** FantasyPros ECR and the Reddit Market Adjusted chart (u/PeakedinHighSkool) at equal weight. Reddit replaced RotoBaller, Kyle Menton, and Fantasy Spew in Week 9. Equal shares still apply: a source with no file this week takes no weight, and the rest split it evenly.
  - Never carry a prior week's file forward. Once the new week's files start arriving, use only those, even if some are missing.
  - Weeks 7 and 8 stay as loaded. A replaced file overwrites that week's sources.
  - Neither source has points per game, so lineup impact uses league points per game. Injury flags in trade ideas come from Sleeper: Questionable, Doubtful, Out, IR, PUP, Sus, NA, DNR, COV.
  - Ranks are computed within each source, with ties averaged. A player a source leaves out gets rank = that source's length + 1. The blend is a weighted average of ranks, re-ranked 1 to N. Value curve: `100*exp(-0.03605*(rank-1)^0.8665)`. K and DEF appear on the chart (ECR only) but are excluded from trade ideas.
- **Tiers:** The Pulpit 85+, Deacon Board 70+, Choir Loft 58+, Front Pews 42+, Revival Tent 28+, Back Pews 20+, Mustard Seeds 13+, The Nursery 8+, Fellowship Hall Leftovers below 8.
- **Trade math:** each value raised to the 1.5 power, plus roster-spot credit `tvAdj(10)` per extra player received by the other side. Labels: fair within 10%, leans within 30%, robbery beyond. Lineup impact uses chart points per game, falling back to league points per game.
- **Trade ideas:** up to 3 per member. Fair, both lineups improve by at least 0.5, top 8 healthy players worth 8+, no K or DEF. This week's pickups are allowed.
- **Multi-team (Covered Dish Deals):** the user picks 3 to 6 teams. Each deal is a single loop. Two-for-one is allowed up to 4 teams. Every team must be within 10% on value and gain at least 0.5. Fallbacks: the closest fair deal, then the closest-on-value deal labeled with its gap. The builder allows 2 to 12 teams. No "Copy for GroupMe" button.
- **Uneven trades:** a warning, plus "throw in the player he would cut anyway," the lowest-value non-K/DEF player on the roster.
- **Reversed trades:** a mirror-image trade within 48 hours is ignored and hidden everywhere.
- **Power Rankings:** Acts = 50% all-play, 25% points per game, 25% last 3 weeks. Revelation = 60% roster value, 25% points per game, 15% last 3 weeks. Roster value is the best lineup by adjusted value, plus bench weights 50, 35, 25, and 15%.
- **Spiritual Gifts:** played weeks use actual starter points. "This week" uses projections, with players on bye and players listed Out, Doubtful, IR, PUP, Sus, NA, DNR, or COV sitting. "Rest of season" uses trade value. Top 3 green, bottom 3 red.
- **What's at Stake:** 10,000 playoff simulations split by this week's result. The game of the week is the biggest combined swing.
- **Draft (The Sower):** current season gap = trade value now minus the curve value at the pick. Past seasons use position rank, drafted vs. finished. Grades are curved by z-score, A+ to F.
- **Weighed on the Scales:** each 2026 trade rescored with current values. Still even (10% or less), Leaning (30% or less), Spoiled like manna (beyond).
- Playoff and toilet bowl games share one "With postseason" filter. Toilet bowl games count in Elo, rivalries, and everything else.
- **Current rosters:** the latest scored week's rosters, then every move from that week on, replayed in time order. Trades made after that week's lineups locked sit in the same week, so a filter of later weeks only misses them.
- **The Laborers:** no quarterbacks anywhere: no QB fit, player card block, or Luck of the draw share. Their carries and targets still count in team totals.
- **Trends (`wTrends`):** last 3 team games against earlier games, current team only, pooled shares. Bars: target share 5 points, rush share 10. Each side needs 2 games, and the window carrying the move needs 4 touches a game. Rush share is the headline for backs, target share for the rest; backs can move on either. Snap share never triggers a Mover.
- **Early exit:** one isolated game under half his median snaps, when that median is 50% or more and he has 4+ games. Back-to-back low games stay in. It leaves his trend only.
- **Filling In:** risers only. A teammate with 12%+ of that work in earlier games missed 2 of the last 3 team games. For rush share the teammate must be a back. Status reads now with a team, back in a week, Sleeper's status, or "out of the lineup."
- **With and without (`wWithout`):** a teammate with 15%+ share, 2 games on each side, a rise of at least the bar for the other man, and he sat the latest game or is listed unavailable. Up to 3 lines a team.
- **QB splits (`wQbSplits`):** Team by team only, not Movers. Starter is the most pass attempts. A game where a second QB throws 10+ is left out. One full game qualifies a QB. Up to 3 QBs by games, always keeping the latest starter, in start order. Top 3 receivers by targets with at least 1 game under two QBs.
- **Monday Night Vigil (`vigil()`, tab `#vigil`):** Monday only, in the viewer's time zone, and only for an export taken that same day. It closes at midnight. The commissioner can preview it on other days. It uses no Sleeper win odds.
  - Replays: 10,000 per matchup, from a fitted curve per player (Benton, Nov 9: replaying only his own games had no tails).
    - Mean: his 2026 average in league scoring, blended with this week's projection at 3 games' weight. Spread: his own SD, blended with position CV times mean at 4 games' weight, times 1.4. CV and dud rate are re-measured each export (players with 4+ games and a starter's average); `VG_FALLBACK` holds the Nov 9 values.
    - QB, RB, WR, TE: lognormal (right skew) plus a dud chance at the position's rate (games under a quarter of the player's mean), drawn uniform from 0 to a quarter of the mean. K and DEF: normal, no dud; DEF can go negative.
    - Team factor: rho 0.27 for QB, WR, TE and 0.07 for RB, K (measured teammate correlations). Opposing teams are independent.
    - Leave-one-out calibration on 1,751 starter games: 10.7% beat the 90th percentile, 1.8% the 97.5th, 1.0% the 99th. Own-games-only replays put 8% above their 99th. Recheck with `checks/vigil_calib.py` if the constants change.
  - Categories: Literally Impossible, when the trailing team has nobody left. Miracle Territory, when the trailer wins 1% or less of replays. Everything else is live. The game of the night is the live game with the biggest playoff swing from What's at Stake.
  - Chart: quantile dot plot, 50 dots. Same sides as the card header: trailer left, leader right. x is the leader's final edge, so comebacks sit left of the line. The page is centered (`main[data-view="vigil"]`).
  - Keys (`vgKeys`), in order: the need, with a normal-night figure. The path: the trailer's players with the biggest rise in the replays he wins, averages vs. usual. The leader's lever: the top riser held under his median, comebacks then (one man vs. nobody: that player's record under the exact number). Shared-team tug of war, naming which play helps whom (both need points from a team; a touchdown vs. a field goal by the other man's kicker). A defense facing the other man's players. Own script: a kicker plus the defense facing that kicker's team. Kicker duel.
  - Never write a line where both men "want" the same team to score (Benton: reads as nonsense). Name the specific play that helps each man.
  - Every category always shows: Still in the balance, Miracle Territory, Literally Impossible, each with a line when no game fits.
  - Explainer: the "How the replays work" info button sits under the page heading (`.vg-info`), in plain language. There is no explainer at the bottom.
  - Lineup confession: a starter with 0 who was on bye or listed Out, Doubtful, IR, PUP, Sus, NA, DNR, or COV (not Questionable), and a bench player who already played and scored 5+ that fits the slot directly or through one flex shuffle. One per man per page.
  - Nav: the tab and a pulsing dot show on Mondays (6-slot bottom bar). The Weekly Recap (renamed from Tuesday Recap) pulses on Tuesdays. Both pulse all day, even after the page is opened (Benton's call).
  - Test data: `python3 checks/vigil_fixture.py data.json sim/data.json`, then `node checks/vigil.js sim sim` (Monday, Tuesday, Wednesday, and stale-Monday clocks; 360, 390, and 768 widths; both themes).
- **Recap awards:** always 12 tiles, by `recapTiles`. Priority: top and low score, blowout, close, tough, lucky, top player, upset, bad beat, regret, the two Prophecy tiles, Asleep, bench, then fill tiles (Good and Faithful, Armor of God, Best Foot Forward, Still Small Voice, Revival Meeting).
- **Sermon:** `sermonBook()` plans every week in order, so past weeks never change. Bank lines rotate through every option before repeating.
  - Score: percentile against league history, plus 40 for a league record, 12 for a season high or low, 4 to 10 for a streak, and 14 for a standings change.
  - Memory: story type used last week minus 18, two weeks ago minus 8. Each team minus 5 a line last week, to a limit of 10.
  - Lead: minus 25 for the same lead type, minus 15 for the same lead team, minus 12 for low, asleep, or regret. The commissioner can lead once in any four weeks.
  - Gates: blowout 25 or more, close 10 or less, tough at or above the week's median, lucky below it, regret 8 or more, asleep 15 or more, low at or below 90% of the season average.
  - News stories: dropped player scoring 20 or more for another team, projection miss of 15 or more (a zero never counts, since he likely did not play), Elo climb in the top 15% (never leads, and is dropped if the man already has a story), and a series skid of 3 or more ending.
  - Benediction: the newest sermon only, from the game of the week in What's at Stake.
  - Formats rotate each week: sermon, bulletin, business meeting minutes, numbered points. No ordinance-themed frames.
  - Card: 7 lines at most, 5 on Home with first names. Two lines a team, one negative line a man, two stories a category. Top player runs only at the 85th percentile or better, or to reach 4 lines. Titles for negative stories never name the man.

## Standing rules from Benton
- **Did You Know:** rotate it on every refresh or change.
- **Theme:** some Baptist flair, nothing inflammatory, no references to the church by name. The league name is "Gambling Baptist."
- **No Sleeper repeats:** build nothing Sleeper already shows.
- **No buy or sell signals.** Injuries are flagged. Use nicknames from the `NICK` map.
- **Brainstorm first:** when he asks for thoughts or a brainstorm, discuss before building. Build when he says build, implement, or run it.
- **Reply style:** direct and concise, no flattery. Push back when warranted. Never end with a question. Cite sources for product or capability claims, or say "not certain, let me check." No em dashes, plain technical English.

## Open items
- **Thread for later:** Benton sent a long screenshot of a text thread on Nov 9 and said it is for later. It is saved at `app/inbox/2026-11-09-thread-for-later.jpg`. Ask what he wants done with it before acting.
- **Testimonies:** live with the full Week 8 dump. Team-only notes and players off rosters are left out. Rosters come from the latest scored week, as in the app.
- No 2026 trade has involved three or more teams, so multi-team scoring has only been tested on a made-up trade.
