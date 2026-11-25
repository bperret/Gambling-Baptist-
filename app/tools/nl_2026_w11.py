# Newsletter gleanings, week of Nov 25, 2026 (games through Week 11). Rewritten facts only:
# no defenders, no trade or waiver advice, no trivia. Lines that repeat a Late-Round note were merged away.
# Tone: "up" (green), "down" (red), "" (neutral). Run: python3 tools/nl_2026_w11.py  (rewrites the nl items in notes.json)
import json, sys
WK = 11
P = [
 ("13337", "up", "7.0 yards per touch, best among backs with 50+ touches. Last four games: 67 touches, 491 scrimmage yards, 5 TDs, the first rookie back over 400 yards in four games since Gibbs."),
 ("12527", "up", "51 catches and 507 receiving yards, both the most among backs, plus 4 receiving TDs (tied for the most)."),
 ("9487", "", "Week 11: a 37.0% target share (5th in the league) and 152 uncatchable air yards, the most of anyone."),
 ("6770", "up", "74.7% completions, ahead of the single-season record (Drew Brees, 74.4%). Leads the NFL in EPA, passing TDs, and passer rating."),
 ("13279", "up", "1.96 yards per route run, 4th among rookie receivers."),
 ("8130", "up", "Week 11: a 45.2% target share, 2nd in the league."),
 ("7525", "", "Week 11: a 57.1% target share, the league high, with 12 targets on 23 routes. Only 41 yards, and 90 of his air yards were uncatchable."),
 ("8150", "", "RB5 at 22.4 a game through Week 4, RB22 at 12.4 since. Blake Corum outscored him in 4 of the last 6."),
 ("8150", "up", "Still the bigger role: 13.5 expected fantasy points a game to Corum's 10.4. His yards before contact fell from 3.15 to 1.45; yards after contact held steady."),
 ("10213", "", "97 uncatchable air yards in Week 11, 3rd most in the league."),
 ("4046", "up", "Last four games: 1,235 passing yards, 13 TDs, no interceptions."),
 ("8183", "up", "1st in EPA per dropback in expected passing situations (+0.37). His connection with Mike Evans ranks 1st in EPA per attempt, passer rating, success rate, and completion % over expected."),
 ("6786", "up", "Week 11: a 36.4% target share, 6th in the league."),
 ("8112", "down", "80 targets and 1 or fewer receiving TDs, the most targets of anyone with that few scores."),
 ("1479", "down", "69 targets and 1 or fewer receiving TDs, 2nd most in the league."),
 ("13298", "down", "63 targets and 1 or fewer receiving TDs, 3rd most in the league."),
 ("13294", "down", "0.92 yards per route run, last of 43 receivers with 50+ targets. 57 targets and 1 or fewer receiving TDs."),
 ("2216", "up", "0.229 first downs per route run, the best season since 2021 (100+ routes). With Brock Purdy: 1.03 EPA per attempt and a 150.2 passer rating, both 1st."),
 ("3198", "up", "9 catches in 2 games with Jacoby Brissett at quarterback, after 12 in his previous 9."),
 ("9756", "", "Out and facing thumb surgery. Tai Felton is running as Minnesota's No. 2 receiver."),
 ("13296", "up", "2.08 yards per route run, 3rd among rookie receivers."),
 ("13274", "down", "1.08 yards per route run, 40th of 43 receivers with 50+ targets."),
 ("11560", "up", "3rd in EPA per dropback in expected passing situations (+0.33)."),
 ("12501", "up", "The league's best man-beater: 3.80 yards per route run vs. man (WR1), 2.27 vs. zone (WR19). The Rams, his Week 12 opponent, play man at the 3rd-highest rate (30%)."),
 ("5995", "up", "6.8 yards per touch, 2nd among backs with 50+ touches."),
 ("9500", "up", "56 yards and 5 targets a game in two weeks with Kansas City, on 5.33 yards per route run."),
 ("1466", "up", "On pace for 1,106 receiving yards. Week 11: 7 targets, the Chiefs' high."),
 ("13301", "up", "Breakout game: 11 targets, 9 catches, 121 yards, 16.7 points, with 2 catches for 66 yards on the winning drive."),
 ("8144", "up", "Week 11: 49 routes on 51 dropbacks, the most of any Saint."),
 ("12514", "down", "In 6 games with Baker Mayfield, a 17-game pace of 51 catches, 558 yards, and 3 TDs: 7.3 PPR points a game (WR71). 1.05 yards per route run, 41st of 43."),
 ("13345", "up", "Week 11: 24 carries and 5 targets. J.K. Dobbins and Cody Schrader had 1 carry each."),
 ("13968", "up", "5 field goals in one half in Week 11, the first kicker to do it since 2017."),
 ("9221", "up", "One of four players with 1,500+ scrimmage yards and 15+ scrimmage TDs through 10 games, with Emmitt Smith, Eric Dickerson, and O.J. Simpson."),
 ("9488", "up", "52% of Seattle's receiving yards, the biggest share by one player since 2016. 0.193 first downs per route run, 2nd best since 2021."),
 ("4984", "", "4th in EPA per dropback in expected passing situations (+0.24)."),
 ("7523", "up", "5th in EPA per dropback in expected passing situations (+0.22)."),
 ("13276", "up", "2.71 yards per route run, best among rookie receivers."),
 ("11586", "", "Leads all backs in EPA per carry for the 2nd straight season. Outscored Kyren Williams in 4 of the last 6 on 10.4 expected fantasy points a game to Kyren's 13.5."),
 ("13269", "up", "28.9 PPR points (QB3) without Brock Bowers in his second career start."),
 ("8228", "up", "6.4 yards per touch, 3rd among backs with 50+ touches."),
 ("11610", "down", "57 targets and 1 or fewer receiving TDs."),
 ("11834", "up", "Week 11: 46 routes on 51 dropbacks, 2nd among Saints."),
 ("11576", "up", "5.0 yards per carry (9th), 48.4% success rate (3rd), 15.6% explosive runs (2nd), and 118 rushing yards over expected."),
 ("8155", "down", "3.4 yards per carry (45th), 39.0% success rate (24th), 7.8% explosive runs (34th), and 31 rushing yards under expected."),
 ("12518", "down", "The only receiver or tight end with 35+ targets under 5 yards per target. Last four games: 22, 1, 44, and 18 yards."),
 ("11635", "up", "Week 11: a 38.1% target share, 4th in the league."),
 ("8126", "down", "1.11 yards per route run, 39th of 43 receivers with 50+ targets."),
]
T = [
 ("LAR", "", "Defenses put 8+ in the box on 76% of Rams running back runs, the most since 2013, yet the Rams have the lowest stuff rate (9.9%) and 43% of those runs gain 5+ yards. Last six opponents: 22-34-1. Next six: 34-23."),
 ("CIN", "up", "Pass rate over expected over the last 5 weeks: +16.9%, 1st by a wide margin (next best +8.4%)."),
 ("KC", "", "Pass rate over expected over the last 5 weeks: +8.4%, 2nd. Week 11 targets were spread thin: seven players with 4+, nobody above 7."),
 ("NO", "", "Pass rate over expected over the last 5 weeks: +5.1%, 3rd."),
 ("GB", "", "Pass rate over expected over the last 5 weeks: +4.3%, 5th."),
 ("TEN", "up", "Over the last three weeks: 7th in neutral pass rate (was 29th) and 10th in passing yards a game (was 31st). 28.5 points a game over the last month."),
]
path = sys.argv[1] if len(sys.argv) > 1 else "notes.json"
n = json.load(open(path))
items = [x for x in n.get("items", []) if x.get("src") != "nl"]
teams = [x for x in n.get("teams", []) if x.get("src") != "nl"]
items += [{"pid": p, "wk": WK, "tone": t, "text": s, "src": "nl"} for p, t, s in P]
teams += [{"team": k, "wk": WK, "tone": t, "text": s, "src": "nl"} for k, t, s in T]
n["items"], n["teams"] = items, teams
json.dump(n, open(path, "w"), ensure_ascii=False, indent=1)
print("nl items", len(P), "team lines", len(T))
