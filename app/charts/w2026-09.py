#!/usr/bin/env python3
"""Week 9, 2026: Kyle Menton chart, transcribed from the screenshot. name|pos|value|FPG|injured|chart trend. Writes week.json."""
import json
ROWS = """
Jahmyr Gibbs|RB|80|28.3||0
Christian McCaffrey|RB|70|20.7||0
James Cook|RB|68.5|19.1||0
Kenneth Walker|RB|67|22.9||-7.5
Bijan Robinson|RB|65.5|19.2||-5.5
Chuba Hubbard|RB|60|19.0||4
D'Andre Swift|RB|59|19.1||4
Josh Jacobs|RB|58|21.7||1
Jonathan Taylor|RB|56|18.4||-7.5
Bucky Irving|RB|55|16.7||4.5
Jaylen Warren|RB|53.5|17.7||1.5
Bhayshul Tuten|RB|52|16.9|1|8
Kyren Williams|RB|48|19.0||-12
Javonte Williams|RB|46|17.2||-4.5
Chase Brown|RB|45|13.3||5
Derrick Henry|RB|44|17.2||-9.5
Ashton Jeanty|RB|42|16.5||-17
Tony Pollard|RB|40|14.6||18
Breece Hall|RB|37|14.2|1|-6
Braelon Allen|RB|31.5|12.5||20
Saquon Barkley|RB|30.5|8.4|1|-6.5
Ollie Gordon|RB|28|10.3||-2.5
Rhamondre Stevenson|RB|26.5|12.5||1.5
Cam Skattebo|RB|26|10.2||-1
Jonah Coleman|RB|25|11.0||12
Blake Corum|RB|24|10.4||6
Quinshon Judkins|RB|20|12.4||-6
Tyler Allgeier|RB|17|10.5||11.5
Rico Dowdle|RB|15|8.9||NEW
Kyle Monangai|RB|14.5|14.8|1|-2.5
Jeremiyah Love|RB|13.5|8.9|1|-21
Rachaad White|RB|13|10.5||8
Aaron Jones|RB|12.5|11.5||4.5
Zach Charbonnet|RB|12|5.9||0
Alvin Kamara|RB|11|11.0||-1.5
Dylan Sampson|RB|10|11.8||2.5
Emmett Johnson|RB|9.5|7.3||6.5
Jadarian Price|RB|9|5.4||NEW
Woody Marks|RB|8.5|8.9|1|-1
Omarion Hampton|RB|7.5|9.2||-13.5
Chris Rodriguez Jr.|RB|7|6.2||2.5
Kaelon Black|RB|6.5|4.5||-0.5
Travis Etienne|RB|6|10.3|1|-4
Jordan Mason|RB|4.5|6.9||-10
David Montgomery|RB|4|9.1|1|-2
Brian Robinson Jr.|RB|3|8.9|1|-1
RJ Harvey|RB|2.5|11.2||-11.5
Kimani Vidal|RB|2|5.6||0
JK Dobbins|RB|1.5|7.4||-5
TreVeyon Henderson|RB|1|5.8||-1.5
Jaxon Smith-Njigba|WR|80|27.5||0
Puka Nacua|WR|78|23.1||0
Ja'Marr Chase|WR|74|18.3||4
CeeDee Lamb|WR|72|21.0||-4
Amon-Ra St. Brown|WR|68.5|20.1||-3.5
Malik Nabers|WR|67|17.2||0
Tee Higgins|WR|61|19.9||4
Chris Olave|WR|57|17.8||-2
Christian Watson|WR|56|18.5||5.5
Drake London|WR|55|13.7||-10.5
Matthew Golden|WR|52|16.4||8
Justin Jefferson|WR|48|14.4||-11
Luther Burden|WR|47|14.6||3
Garrett Wilson|WR|46|14.2||3
Nico Collins|WR|45|15.2||-1
Zay Flowers|WR|44|17.5||-25.5
DJ Moore|WR|42|10.8||16.5
Mike Evans|WR|40|14.8|1|5.5
Jameson Williams|WR|38.5|14.4||0
Parker Washington|WR|37|13.6||-17
Tetairoa McMillan|WR|34.5|15.7||-1
Rashee Rice|WR|33.5|11.3||6
Michael Wilson|WR|32.5|13.6|1|14.5
George Pickens|WR|31.5|13.0||-13.5
Jalen Coker|WR|30|13.4||-7
Carnell Tate|WR|29.5|11.3|1|0
DeVonta Smith|WR|28.5|17.3|1|-11.5
Stefon Diggs|WR|20|13.7||-4
AJ Brown|WR|19|6.4|1|-29
Ladd McConkey|WR|18|8.6||-5
Jaylen Waddle|WR|17|9.9||4
Rome Odunze|WR|16|9.2||2.5
Emeka Egbuka|WR|15|11.9|1|-7
KC Concepcion|WR|12.5|8.8||-1.5
Jordyn Tyson|WR|12||1|-0.5
Wan'Dale Robinson|WR|11.5|9.8||0
Adonai Mitchell|WR|11|12.1||NEW
Germie Bernard|WR|10|8.4||-4.5
Keenan Allen|WR|9.5|10.6||1
DK Metcalf|WR|9|9.7||-16
Ryan Flournoy|WR|8.5|9.6||NEW
Tre Tucker|WR|8|12.5||-9
Devaughn Vele|WR|7.5|12.3||-2.5
Makai Lemon|WR|7|7.7||NEW
Josh Downs|WR|6.5|8.7||-0.5
Omar Cooper Jr.|WR|6|12.2||-9
Demario Douglas|WR|5.5|10.3||4
Khalil Shakir|WR|4.5|9.6||-1.5
Malik Washington|WR|4|10.4||1.5
Denzel Boston|WR|3.5|10.9||-4
Caleb Douglas|WR|3|11.9||-5
Antonio Williams|WR|2.5|7.8||-0.5
Jakobi Meyers|WR|2|9.3||-9
Jordan Addison|WR|1.5|8.2||-4
Xavier Worthy|WR|1|8.0||-8
Brock Bowers|TE|65.5|20.8||4.5
Trey McBride|TE|60|18.8||0
George Kittle|TE|48|15.1||0
Colston Loveland|TE|40|9.4||-2
Tucker Kraft|TE|33.5|11.1||3.5
Isaiah Likely|TE|32.5|16.1||0
Sam LaPorta|TE|26.5|12.3||-2
Dalton Kincaid|TE|25.5|11.4||3.5
Harold Fannin|TE|20|11.5||11
Tyler Warren|TE|18|12.6||-8
Kyle Pitts|TE|14|8.2||-5
Travis Kelce|TE|13.5|11.7||-1
TJ Hockenson|TE|13|11.2|1|0
Mike Gesicki|TE|10|11.0||NEW
Dallas Goedert|TE|9.5|10.7||-5.5
Brenton Strange|TE|9|9.6||-0.5
Hunter Henry|TE|8|9.2||0
Terrance Ferguson|TE|7.5|6.4|1|0.5
Michael Mayer|TE|7|9.6||1.5
Pat Freiermuth|TE|6|9.9||2
Chig Okonkwo|TE|3|6.8||-7
Mason Taylor|TE|2|7.4||-2.5
Gunnar Helm|TE|1.5|4.6||NEW
Josh Allen|QB|53.5|27.7||1.5
Joe Burrow|QB|42|25.2||10.5
Drake Maye|QB|33.5|21.4||-2
Caleb Williams|QB|29|19.7||2.5
Jayden Daniels|QB|28.5|20.1||-6
Brock Purdy|QB|27.5|21.4||0.5
Patrick Mahomes|QB|26.5|18.5||0
Kirk Cousins|QB|24|20.6||NEW
Trevor Lawrence|QB|22|19.8||1
Jordan Love|QB|21|19.5||3
Jared Goff|QB|18|20.6||-2
Dak Prescott|QB|17|19.1||0
Tyler Shough|QB|15|19.3||0
CJ Stroud|QB|14.5|18.8||1
Matthew Stafford|QB|9|17.5||-5.5
Bryce Young|QB|7.5|18.9||-6.5
Bo Nix|QB|6.5|15.0||0
Malik Willis|QB|3.5|15.6||-2.5
"""
P = json.load(open("data.json"))["players"]
team = {v[0]: v[2] for v in P.values()}
rows, trend = [], {}
for ln in ROWS.strip().splitlines():
    n, pos, v, ppg, inj, tr = ln.split("|")
    rows.append({"name": n, "pos": pos, "team": "", "v": float(v), "ppg": float(ppg) if ppg else None, "inj": bool(inj)})
    trend[n] = tr
json.dump(trend, open("charts/w2026-09.trend.json", "w"))
wk = {"season": "2026", "week": 9, "loaded": "2026-11-03", "sources": {"menton": {"name": "Kyle Menton", "w": 0.25, "rows": rows}}}
json.dump(wk, open("week.json", "w"), indent=0)
print(len(rows), "rows")
