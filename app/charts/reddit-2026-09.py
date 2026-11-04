#!/usr/bin/env python3
"""Week 9, 2026: Reddit Market Adjusted Trade Value chart (u/PeakedinHighSkool, 4 point, 1QB, 1.0 PPR, updated 11/03/26).
Transcribed from the screenshot. Each line is pos|value|name. Writes week.json."""
import json
ROWS = """
RB|75.5|Jahmyr Gibbs
RB|72|Kenneth Walker
RB|70|Bijan Robinson
RB|61|Christian McCaffrey
RB|60.5|James Cook
RB|56.5|Jonathan Taylor
RB|55|Kyren Williams
RB|52|Javonte Williams
RB|51.5|Chuba Hubbard
RB|47.5|D'Andre Swift
RB|42.5|Bucky Irving
RB|38|Derrick Henry
RB|37|Jaylen Warren
RB|36.5|Josh Jacobs
RB|34|Ashton Jeanty
RB|34|Bhayshul Tuten
RB|33.5|Chase Brown
RB|27|Breece Hall
RB|26|Rhamondre Stevenson
RB|22.5|Tony Pollard
RB|21.5|Quinshon Judkins
RB|19|Ollie Gordon
RB|17|Saquon Barkley
RB|16.5|Jonah Coleman
RB|14|Braelon Allen
RB|13.5|Travis Etienne
RB|13.5|Cam Skattebo
RB|12.5|Blake Corum
RB|12.5|Kyle Monangai
RB|11.5|Jeremiyah Love
RB|10.5|Aaron Jones
RB|10.5|Omarion Hampton
RB|8.5|Woody Marks
RB|8|Zach Charbonnet
RB|7.5|Rachaad White
RB|6|Rico Dowdle
RB|4.5|Jordan Mason
RB|3|David Montgomery
RB|2|Jadarian Price
RB|1.5|Tyler Allgeier
WR|72|Jaxon Smith-Njigba
WR|70|Puka Nacua
WR|64.5|Ja'Marr Chase
WR|63.5|CeeDee Lamb
WR|62.5|Amon-Ra St. Brown
WR|61.5|Malik Nabers
WR|47.5|Chris Olave
WR|46.5|Christian Watson
WR|46|Tee Higgins
WR|40.5|Drake London
WR|38|Justin Jefferson
WR|37|Matthew Golden
WR|34|Zay Flowers
WR|33|Parker Washington
WR|32|Nico Collins
WR|32|Tetairoa McMillan
WR|27.5|Garrett Wilson
WR|27|Luther Burden
WR|26.5|George Pickens
WR|25|Mike Evans
WR|24.5|Jameson Williams
WR|24|Rashee Rice
WR|23.5|Michael Wilson
WR|22.5|DeVonta Smith
WR|22|A.J. Brown
WR|21|Emeka Egbuka
WR|20.5|Carnell Tate
WR|19.5|D.J. Moore
WR|18|Stefon Diggs
WR|17.5|Jalen Coker
WR|15.5|Ladd McConkey
WR|14.5|Jaylen Waddle
WR|13.5|DK Metcalf
WR|13.5|Rome Odunze
WR|13.5|Denzel Boston
WR|12.5|Omar Cooper Jr.
WR|12|Jordyn Tyson
WR|11.5|KC Concepcion
WR|11|Germie Bernard
WR|10.5|Tre Tucker
WR|9.5|Makai Lemon
WR|9|Deebo Samuel
WR|9|Khalil Shakir
WR|8.5|Josh Downs
WR|8|Jakobi Meyers
WR|7.5|Jordan Addison
WR|7|Keenan Allen
WR|6.5|Wan'Dale Robinson
WR|6.5|Davante Adams
WR|5.5|Devaughn Vele
WR|4.5|Caleb Douglas
WR|3.5|Marvin Harrison Jr.
WR|3|Antonio Williams
WR|2.5|Malik Washington
TE|49|Brock Bowers
TE|32|Trey McBride
TE|24.5|George Kittle
TE|21|Isaiah Likely
TE|20|Colston Loveland
TE|15.5|Tucker Kraft
TE|13|Sam LaPorta
TE|10|Tyler Warren
TE|7.5|Travis Kelce
TE|7.5|Dalton Kincaid
TE|6|Harold Fannin
TE|5.5|Kyle Pitts
TE|5.5|Brenton Strange
TE|4.5|Dallas Goedert
TE|4|T.J. Hockenson
QB|50|Josh Allen
QB|33|Joe Burrow
QB|25|Drake Maye
QB|18|Brock Purdy
QB|13.5|Trevor Lawrence
QB|13.5|Caleb Williams
QB|11|Jayden Daniels
QB|11|Jared Goff
QB|10|Jordan Love
QB|10|Dak Prescott
QB|10|Patrick Mahomes
QB|8.5|Matthew Stafford
QB|7.5|C.J. Stroud
QB|5|Tyler Shough
QB|3|Bryce Young
QB|1|Kirk Cousins
"""
rows = []
for ln in ROWS.strip().splitlines():
    pos, v, n = ln.split("|")
    rows.append({"name": n, "pos": pos, "team": "", "v": float(v)})
wk = {"season": "2026", "week": 9, "loaded": "2026-11-04", "sources": {"reddit": {"name": "Reddit Trade Values", "w": 0.25, "rows": rows}}}
json.dump(wk, open("week.json", "w"), indent=0)
print(len(rows), "rows")
