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
  - It produces format `ffbc-sleeper-v3`: seasons with full `scoring_settings`, players, `injuries`, and `projections` (current season weeks 1 to now, scored with league settings, plus a `check` match rate).
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
  - `node checks/plans.js sim`, then `python3 checks/gates.py data.json`: rechecks the sermon gates and Week 8 facts from raw data.
  - Recompute any new math independently before you call it done.
  - The older test scripts (`test4` to `test11`, `pubtest`, `mt-ui`, `g2`) were not recovered. Write a new check when work touches the drop zone, multi-team trades, or Spiritual Gifts.

## Weekly routine
The commissioner sends the export JSON (or uses the drop zone), a Kyle Menton chart screenshot, the FantasyPros ROS ECR CSV (PPR, overall), and either a Fantasy Spew chart or a RotoBaller CSV.
1. Transcribe the charts into a new week object: `{season, week, loaded, sources: {spew: {name, w, rows}, menton: {name, w, rows}}}`. Each row is `{name, pos, team, v, ppg, inj}`. Copy the last week in `values.json` for the format.
2. Run `python3 tools/rotoballer.py roto.csv week.json` if there is a RotoBaller file, then `python3 tools/ecr.py ecr.csv week.json`. `charts/w2026-09.py` is the transcription pattern, and it records the chart's trend column as a check against last week.
3. Append the week to `values.json` under `weeks`. Keep every week, because history drives Risers and Fallers and the trends.
4. Report unmatched names, and add aliases to `TV_ALIAS` in `src/app.js`.
5. If he pastes the Late-Round player notes, replace `notes.json` with the new week: `{season, week, source, notes: [{pid, tag, text}]}`. Keep rostered players only, rewrite each note, and report names that do not match. Tags: `call` New Calling (green), `pew` Back Pew (red), `manna` Manna, `fast` Fasting (neutral), or none. Label points "Standard PPR points." Expected Fantasy Points stay separate from Workload points. No small-sample or missing-context filters.
6. Run the checks, run `build.py --publish`, publish, and commit.

## Model settings (do not change without being asked)
- **Trade value blend (Benton's rule, Nov 3):** four sources at 25% each: FantasyPros ECR, Kyle Menton, Fantasy Spew, RotoBaller. A source with no file this week takes no weight at all, and the rest split it evenly, so three sources are one third each.
  - Never carry a prior week's file forward. Once the new week's files start arriving, use only those, even if some are missing. Each new file gets the same equal share.
  - Weeks 7 and 8 stay as loaded. Week 9 has ECR, Menton, and RotoBaller with no Spew.
  - RotoBaller must be the rest-of-season file. `tools/rotoballer.py` refuses a file with no bye team, which is the one-week file.
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
- **The Laborers:** no quarterbacks anywhere: no QB fit, player card block, or Luck of the draw share. Their carries and targets still count in team totals.
- **Trends (`wTrends`):** last 3 team games against earlier games, current team only, pooled shares. Bars: target share 5 points, rush share 10. Each side needs 2 games, and the window carrying the move needs 4 touches a game. Rush share is the headline for backs, target share for the rest; backs can move on either. Snap share never triggers a Mover.
- **Early exit:** one isolated game under half his median snaps, when that median is 50% or more and he has 4+ games. Back-to-back low games stay in. It leaves his trend only.
- **Filling In:** risers only. A teammate with 12%+ of that work in earlier games missed 2 of the last 3 team games. For rush share the teammate must be a back. Status reads now with a team, back in a week, Sleeper's status, or "out of the lineup."
- **With and without (`wWithout`):** a teammate with 15%+ share, 2 games on each side, a rise of at least the bar for the other man, and he sat the latest game or is listed unavailable. Up to 3 lines a team.
- **QB splits (`wQbSplits`):** Team by team only, not Movers. Starter is the most pass attempts. A game where a second QB throws 10+ is left out. One full game qualifies a QB. Up to 3 QBs by games, always keeping the latest starter, in start order. Top 3 receivers by targets with at least 1 game under two QBs.
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
- **Testimonies:** live with the full Week 8 dump. Team-only notes and players off rosters are left out. Rosters come from the latest scored week, as in the app.
- No 2026 trade has involved three or more teams, so multi-team scoring has only been tested on a made-up trade.
