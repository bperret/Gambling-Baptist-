# Gambling Baptist

Sleeper export tool for the Gambling Baptist league app.

Open https://bperret.github.io/Gambling-Baptist-/ on any phone or computer, tap **Export league**, and save `league-export.json`.
The page reads only Sleeper's public league data and keeps nothing.

## Branch `app-source`
This branch also holds a backup of the league app itself, in `app/`. The live app (a Claude artifact) is the source of truth.
- `app/HANDOFF.md`: how the app is built, checked, and published, every model setting, and Benton's standing rules.
- `app/CHANGELOG.md`: shipped changes, newest first.
- `app/src/`: the source. `app/tools/`: build, sync, and data scripts. `app/checks/`: the checks to run before every publish.
