# Pick 7 draft strategy — Yahoo half-PPR, 2026

Companion to the Draft Command app (`dist/draft-command.html`). The app does the live math; this doc is the plan you
walk in with and the fallback if the screen goes dark.

## Read this first: what the numbers are built on

* Projections, tiers and ADP for 271 players were compiled on Sept 6, 2026 from model knowledge through June 2026, then
  patched with a 97-item August/September 2026 news sweep (team changes, injuries, depth-chart decisions, cuts) that
  *was* verified by web search. Live ADP sites were blocked while this was built, so **treat ADP as tiers, not exact
  slots** and sort the Yahoo player list by Yahoo's own ADP during the draft.
* Per-position projection curves were calibrated to standard half-PPR projection benchmarks so RB, WR, QB and TE are
  comparable. Kicker and defense projections are discounted in the value math on purpose.
* Bye weeks were not verifiable for every player and may show blank; check the Yahoo player card if a bye matters to you.
* Yahoo default roster is **QB, WR, WR, RB, RB, TE, W/R/T, K, DEF, 6 BN** (15 rounds), half-PPR, 4-pt pass TD, 60-second
  clock. If your league uses 3 WR or 12 teams, switch the preset in Settings; the plans below cover both sizes.

## The pick-7 decision tree (both league sizes)

The consensus top of the board is Gibbs, Bijan Robinson, Ja'Marr Chase, Jaxon Smith-Njigba, Puka Nacua, Jonathan Taylor,
then McCaffrey, Achane, Jefferson, St. Brown. At 7 you get one of the last four in almost every room.

1. Any of Gibbs / Bijan / Chase / Taylor slides: take him.
2. JSN or Nacua available: take the WR. Both are 25-year-old target hogs; in a 2-WR + flex lineup an elite WR still starts every week.
3. Otherwise **De'Von Achane** over **Christian McCaffrey** in half-PPR (age 30, touch history; CMC is the safer floor if Miami's QB play worries you).
4. Fallback: Jefferson or St. Brown over Saquon Barkley.

Do not take Lamb, Barkley or Jeanty at 7; equal value comes back at 14 (10-team) or 18 (12-team).

## Value-based drafting rules the app enforces

* Take the player with the biggest edge over the replacement-level starter at his position (VORP), adjusted for what
  you can *expect* to be left at your next pick (VONA) and what your roster still needs.
* Leave rounds 1 to 4 with at least two of RB tiers 1-3 (Gibbs/Bijan/Taylor/CMC/Achane/Saquon; Jeanty/Cook/Jacobs*/Henry;
  Hampton/Irving/Kyren/Henderson/Chase Brown/Judkins/Hall/Walker). RB value collapses after ~pick 40 into a committee dead zone.
* WR 10-30 is flat; WR 44-70 is flat and deep. That is why RB-RB-WR-WR or RB-WR-RB-WR both work from 7.
* QB: in a 10-team, wait until rounds 8-9 (Stafford/Dak/Love/Caleb/Herbert/Nix/Baker/Goff all project within ~30 pts).
  Only Allen/Lamar/Daniels/Maye/Hurts at or after their ADP (picks 20-36) is a defensible early QB. In a 12-team,
  Burrow/Daniels around pick 66 or one of the round-8 group at 90.
* TE: McBride/Bowers at 14 or 18 are legitimate if the RB/WR on the board is a tier below. Otherwise the value tier is
  Warren/Fannin/LaPorta**/Ferguson/Loveland at picks 70-80. If three TEs go before your round-7 pick, take one immediately.
* K in the last round, DEF in the second-to-last. Never earlier. The app suppresses both until then.
* Positional runs: a QB run at 30-45 is a gift; keep taking RB/WR. An RB run in rounds 2-3 means pivot to Collins/BTJ/
  A.J. Brown/Pickens. A TE run in rounds 6-8 means pre-empt with Warren or Fannin one pick early.

\* Josh Jacobs is on the Commissioner's Exempt List (out indefinitely as of Sept 6): treat as a round-8+ stash, not a starter.
\*\* Sam LaPorta is coming off back surgery with a hip issue in camp; verify his Week 1 status in the room.

## News that changes the board (verified Aug 4 to Sept 5, 2026)

* **Out for season / gone:** Jayden Higgins (HOU WR, ACL), Ricky Pearsall (SF WR, knee), Nick Chubb (retired),
  Brandon Aiyuk (still not with SF). Jaydon Blue, Jarquez Hunter, Dameon Pierce, Zamir White cut and unsigned.
* **Multi-week:** Josh Jacobs (exempt list), Alvin Kamara (MCL, 4-6 wks, Etienne is the Saints' lead back), James Conner
  (IR, 4 games; Tyler Allgeier likely Week 1 starter in ARI), Zach Charbonnet (PUP, 4 games), Isiah Pacheco (IR, now DET;
  Jacob Saylors is the Gibbs handcuff), Jordyn Tyson (NO WR, IR), Christian Kirk and Tank Dell (IR-return).
* **Questionable for Week 1:** Ashton Jeanty (ankle, not practicing Sept 1; Mike Washington Jr. is the handcuff),
  Jeremiyah Love (ARI, high ankle, "50-50"), TreVeyon Henderson, Breece Hall, Kenneth Walker (now KC), George Kittle (groin),
  Patrick Mahomes and Michael Penix (2025 ACLs), Ja'Marr Chase (hyperextended knee, expected fine).
* **Depth-chart calls:** Kirk Cousins starts in LV over Fernando Mendoza; Kyler Murray starts in MIN over J.J. McCarthy;
  Deshaun Watson starts in CLE; Malik Willis starts in MIA (Tua traded to ATL, where the job is unsettled);
  Rhamondre Stevenson listed RB1 in NE over Henderson; MarShawn Lloyd is the Packers' lead back while Jacobs is out;
  Woody Marks is near-even with David Montgomery in HOU; Javonte Williams is the unquestioned DAL RB1;
  Jordan Mason is pushing Aaron Jones in MIN; Jacory Croskey-Merritt leads WAS with Rachaad White behind;
  Cam Skattebo fully recovered (NYG RB1); Brock Bowers fully healthy; Stefon Diggs signed with WAS as the WR2;
  Jaylen Warren RB1 in PIT with Rico Dowdle behind; Chuba Hubbard (hamstring) shares with Jonathon Brooks in CAR.
* **Rookies with real roles:** Jadarian Price (SEA RB, lead with Charbonnet out), Emmett Johnson (KC RB2),
  Jonah Coleman (DEN goal-line), Carnell Tate (TEN WR starter), KC Concepcion (CLE WR starter), Makai Lemon (PHI slot).

## Round-by-round: 10-team (default 2 WR or 3 WR) — Round-by-round: 10-team Yahoo default (QB, WR3, RB2, TE, W/R/T, K, DEF, 6 BN; 15 rds)

Picks: 7, 14, 27, 34, 47, 54, 67, 74, 87, 94, 107, 114, 127, 134, 147. Goal after R6: 3 RB + 3 WR (or 2/4), no QB/TE unless elite value falls. Default is Hero-RB/Robust-RB from 7; Zero-RB only if two WR1s land at 7 and 14.

- **R1 #7:** per above.
- **R2 #14 (opposite position):** after an RB: London (15), Collins (16), Lamb (11) if he slides, A.J. Brown (22, now NE with Drake Maye), Brian Thomas Jr. (24). After a WR: Saquon (12), James Cook (17), Kenneth Walker III (KC, ~26 — Super Bowl MVP, clear lead back), Jeanty (21, ankle sprain but expected Week 1). **Do not take Josh Jacobs** — Commissioner's Exempt list, likely ~6 games; he is an R7-8 stash now.
- **R3 #27 (RB/WR; elite TE ok):** Omarion Hampton (23), Bucky Irving (25, full go), Kyren Williams (28), Chase Brown (29), Quinshon Judkins (32); George Pickens (26), Ladd McConkey (30), Tetairoa McMillan (31), Tee Higgins (33); Trey McBride (20)/Brock Bowers (22, 100% healthy, Cousins QB) if either falls.
- **R4 #34 (RB/WR; QB run hits here — ignore):** Breece Hall (38, groin fine), Rashee Rice (35, no suspension), Emeka Egbuka (37, turf toe day-to-day), DeVonta Smith (40, PHI WR1 with Brown gone), Travis Etienne (44, NO lead back with Kamara out 4-6 wks), Garrett Wilson (42), TreVeyon Henderson (45, ankle — Week 1 in danger; Stevenson RB1). Exception: Drake Maye/Jalen Hurts here only if you already hold 2 RB + 1 WR.
- **R5 #47 (WR3/RB3):** Marvin Harrison Jr. (43, Brissett QB), Jaylen Waddle (now DEN, 50), Rome Odunze (48, CHI WR1 after DJ Moore trade), Zay Flowers (49), Courtland Sutton (52), DK Metcalf (54), Javonte Williams (46, locked DAL RB1), Cam Skattebo (52, fully recovered).
- **R6 #54 (RB depth or TE):** RJ Harvey (58 — now RB2 behind J.K. Dobbins, dock him), Dobbins (60), Jeremiyah Love (ARI #3 pick, 60 — high-ankle sprain, 50-50 Week 1, Allgeier co-lead), DJ Moore (BUF WR1, 55), Chris Olave (56, target hog with Tyson on IR), George Kittle (55 — Achilles in Jan, trending to play; TE-needy only).
- **R7 #67 (QB or TE tier 2 or WR):** Joe Burrow (40 — gone; if not, take him), Bo Nix (55), Caleb Williams (60), Justin Herbert (65), Baker Mayfield (70); WR Jameson Williams (64), Jordan Addison (66), Terry McLaurin (58); TE Colston Loveland (47 — usually gone), Tyler Warren (52), Sam LaPorta (60, back at practice), Jake Ferguson (72).
- **R8 #74 (fill TE / RB4):** Harold Fannin Jr. (80), Tucker Kraft (85, Week 1 snap count); RB Woody Marks (70, near-even split with David Montgomery in HOU — undervalued), Montgomery (65), Jonathon Brooks (77 Yahoo, CAR committee with Hubbard), MarShawn Lloyd (83, GB starter while Jacobs is out), Jacory Croskey-Merritt (62), D'Andre Swift (66, Monangai week-to-week).
- **R9 #87 (QB if open):** Dak Prescott (75), Jordan Love (80), Brock Purdy (85), Matthew Stafford (90), Kyler Murray (95), Jared Goff (100). Also Josh Jacobs stash (~75-90) if you have RB depth; Rhamondre Stevenson (85, NE RB1 if Henderson sits).
- **R10 #94 (WR depth/bye cover):** Stefon Diggs (WAS WR2, 95), Khalil Shakir (94), Chris Godwin (97), Mike Evans (SF WR1, 80 — groin, Week 1 not guaranteed), Deebo Samuel (SF WR2, 100), Jayden Reed (103), Matthew Golden (81).
- **R11 #107 (handcuff/upside RB):** Mike Washington Jr. (LV, ~110, Jeanty handcuff), Tyler Allgeier (ARI, ~100, likely Week 1 starter), Jadarian Price (SEA 1st-rd rookie, ~90, lead role with Charbonnet on PUP), Emmett Johnson (KC RB2, ~125), Jordan Mason (MIN 1A, 100), Rico Dowdle (PIT RB2, 95), Kimani Vidal, Ray Davis, Blake Corum.
- **R12 #114 (upside WR):** Makai Lemon (PHI slot, #20 pick), Carnell Tate (TEN rookie starter; Cam Ward is shaky), Luther Burden III, Troy Franklin, Tre Harris, Wan'Dale Robinson (TEN), Marvin Mims, Josh Downs, Jack Bech, Xavier Worthy (68 — take if he slides; Mahomes on track for Week 1).
- **R13 #127 (TE2/QB2 optional or RB5):** Oronde Gadsden II (LAC — Njoku signed there, some competition), Mason Taylor, Hunter Henry (NE, Maye), Isaiah Likely (NYG); QB Jaxson Dart (115, rushing floor), Sam Darnold (110); RB Jacob Saylors (Gibbs handcuff with Pacheco on IR), Brian Robinson Jr. (Bijan handcuff), Chris Rodriguez Jr./Bhayshul Tuten (JAX co-starters), Ollie Gordon II/Jaylen Wright (Achane), Dylan Sampson.
- **R14 #134 (DEF):** Seahawks, Texans, Broncos, Eagles, Steelers, Vikings, Patriots.
- **R15 #147 (K):** Brandon Aubrey, Jake Bates, Cameron Dicker, Chris Boswell, Harrison Butker, Wil Lutz.

## Round-by-round: 12-team — Round-by-round: 12-team

Picks: 7, 18, 31, 42, 55, 66, 79, 90, 103, 114, 127, 138, 151, 162, 175. The 11/13-pick gaps erase whole tiers between turns — take the last man in a tier over "best available" in a deep tier.

- **R1 #7:** same.
- **R2 #18 (opposite position):** RB Cook (17), Jeanty (21), Walker (26), Hampton (23); WR Collins (16), London (15), A.J. Brown (22), BTJ (24); McBride (20)/Bowers (22) acceptable if the RB/WR tier is gone. Skip Jacobs, skip Derrick Henry (19; age 32, new BAL staff) unless RB2 with two WRs already.
- **R3 #31:** Irving (25), Kyren (28), Chase Brown (29), Judkins (32); Pickens (26), McConkey (30), McMillan (31), Higgins (33), Rice (35).
- **R4 #42 (ignore QB run):** Hall (38), Egbuka (37), DeVonta Smith (40), Etienne (44), G. Wilson (42), MHJ (43), Javonte (46), Henderson (45) only with a healthy RB3 plan.
- **R5 #55:** Odunze (48), Flowers (49), Waddle (50), Sutton (52), Skattebo (52), Metcalf (54), DJ Moore (55), Kittle (55), Olave (56).
- **R6 #66 (QB value or RB/TE):** Burrow (40) gone; Nix (55), Caleb (60), Herbert (65) are the 12-team QB value; else Harvey (58), Dobbins (60), Love (60), Montgomery (65), McLaurin (58), Jameson Williams (64), Addison (66), LaPorta (60), Warren (52).
- **R7 #79:** TE if none: Ferguson (72), Fannin (80), Kraft (85); RB Marks (70), Brooks (77), Lloyd (83), JCM (62), Swift (66); WR Evans (80), Golden (81).
- **R8 #90 (QB if none):** Dak (75), Love (80), Purdy (85), Stafford (90), Kyler (95), Goff (100); or Jacobs stash, Stevenson (85), Price (90).
- **R9 #103:** WR depth: Diggs (95), Shakir (94), Godwin (97), Deebo (100), Reed (103), Meyers (106), Ridley (109).
- **R10 #114:** Handcuffs: Washington Jr., Allgeier, Emmett Johnson, Mason, Dowdle, Vidal, Ray Davis, Corum, Saylors.
- **R11 #127:** Upside WR: Lemon, Tate, Burden, Franklin, Tre Harris, Wan'Dale, Mims, Downs, Bech, Worthy if there.
- **R12 #138:** TE2/QB2/RB5: Gadsden, Mason Taylor, Henry, Likely; Dart, Darnold, Trevor Lawrence; Rodriguez/Tuten, Ollie Gordon, Sampson, Brian Robinson Jr.
- **R13 #151:** Last flyer: Jordyn Tyson (NO, IR-return Week 5) stash, Cyrus Allen (KC), Elic Ayomanor, Jonah Coleman (DEN goal line). Never Tyreek Hill (unsigned, rehabbing) or Travis Hunter (playing CB, backup WR).
- **R14 #162 (DEF):** Seahawks, Texans, Broncos, Eagles, Steelers, Vikings.
- **R15 #175 (K):** Aubrey, Bates, Dicker, Boswell, Butker.

## Tier cliffs, QB/TE timing, dead zone, runs (detail) — Tier cliffs, QB/TE timing, dead zone, runs

- **RB tiers:** T1 Bijan/Gibbs/Taylor/CMC/Achane/Saquon (gone by ~12). T2 Cook/Jeanty/Walker/Hampton/Irving/Kyren/Chase Brown/Judkins (gone by ~33) — this is the cliff; leave R3 with at least 2 of T1-T2. T3 Hall/Etienne/Javonte/Henderson/Skattebo (38-52). **Dead zone ~55-85:** Harvey/Dobbins (split), Love (ankle, Allgeier), Montgomery/Marks (split), Hubbard/Brooks (split), Swift/Monangai (split), Lloyd (fill-in), JCM/Rachaad White, Warren/Dowdle, Tuten/Rodriguez — nearly every backfield is a committee. Buy WRs there and take two of the committee backs late where the price is right (Marks, Lloyd, Stevenson, Allgeier).
- **WR tiers:** T1 Chase/JSN/Nacua/Jefferson/ARSB/Lamb (by 12). T2 Nabers/London/Collins/AJB/BTJ/Pickens (by 26). T3 McConkey/McMillan/Higgins/Rice/Egbuka/DeVonta Smith/G. Wilson (by 42). WR 43-70 is flat and deep (MHJ, Odunze, Flowers, Waddle, Sutton, Metcalf, Moore, Olave, McLaurin) — the reason RB-heavy starts work.
- **QB:** Allen (~20 on Yahoo), Lamar (24), Daniels (28, Diggs added), Maye (32, now with A.J. Brown), Hurts (36) go R2-4. Burrow (40), Mahomes (50, on track for Week 1), Nix (55), Caleb (60), Herbert (65), Baker (70) R5-7. Dak/Love/Purdy/Stafford/Kyler/Goff 75-100 (R8-10). 1-QB 10-team: wait to R8-9 unless Burrow reaches 54. 12-team: Nix/Caleb/Herbert at 66 or the R8 group at 90.
- **TE:** McBride/Bowers 20-22 (R2). Kittle 55 (Achilles risk). Loveland 47, Warren 52, LaPorta 60, Ferguson 72 (R5-7 — the value tier). Fannin 80, Kraft 85 (R8). Then Gadsden/Andrews/Goedert/Hockenson/Henry/Mason Taylor 100-140. Trigger: if 3 TEs go before your R7 pick, take one immediately.
- **Runs:** QB run 20-45 — don't chase; take the T2 RB/T3 WR that falls. RB run in R2-3 — pivot to Collins/AJB/BTJ/Pickens/McConkey. TE run R5-7 — pre-empt with Warren/LaPorta one pick early if two go in a row. Yahoo rooms draft QBs and famous vets earlier than ECR, pushing sophomores (Egbuka, McMillan, Marks, Judkins, Loveland, Gadsden) to you.

## Avoid at ADP, handcuffs, sleepers — Avoid at ADP / sleepers and handcuffs

**Avoid (at price):** Josh Jacobs at any pre-R7 price (exempt list). Nabers at 14 (ACL, Week 1 not committed). Achane at 7 (Willis). Henderson at 45 (ankle; Stevenson listed RB1). Harvey at 58 (RB2 behind Dobbins, Jonah Coleman taking goal line). Love before R6 (50-50 Week 1, Allgeier co-lead). Derrick Henry at 19 (32, new staff). Alvin Kamara (MCL, out ~a month, 31). Kittle before R6 (Achilles, 32). Davante Adams (33; Nacua suspension would help him, but TD regression). Cam Ward/Carnell Tate/Ridley (Ward's preseason was ugly). Jerry Jeudy (Deshaun Watson starting). Travis Hunter (primarily CB). Tyreek Hill (unsigned). Mike Evans before R8 (groin; Week 1 in Australia unsure). Mendoza (backup). Rashod Bateman (6-game suspension risk).

**Handcuffs (R10+):** Mike Washington Jr. (Jeanty), Emmett Johnson (Walker), Jacob Saylors (Gibbs), Brian Robinson Jr. (Bijan), Isaac Guerendo (CMC), Ollie Gordon II/Jaylen Wright (Achane), Tank Bigsby (Saquon), Ray Davis (Cook), Kimani Vidal (Hampton), Blake Corum (Kyren), Tahj Brooks (Chase Brown), Dylan Sampson (Judkins), Malik Davis (Javonte), Kenny Gainwell (Irving), Najee Harris/Tyrone Tracy (Skattebo), Rachaad White (JCM), Braelon Allen (Hall), DJ Giddens (Taylor).

**Sleepers:** RB Woody Marks (HOU split, was outproducing the vets), MarShawn Lloyd (GB lead until Jacobs returns), Rhamondre Stevenson (NE RB1 now), Tyler Allgeier (ARI Week 1 lead), Jadarian Price (SEA), Jordan Mason (MIN), Jonathon Brooks (CAR). WR DeVonta Smith (PHI WR1), Rome Odunze (CHI WR1), Makai Lemon (PHI slot, 20% target share possible), Stefon Diggs (WAS), Deebo (SF), Matthew Golden, Troy Franklin, Xavier Worthy if he slides, Cyrus Allen (KC deep flier). TE Oronde Gadsden II, Hunter Henry (Maye + Brown pull coverage), Chig Okonkwo (WAS). QB Jaxson Dart (rushing), Kyler Murray (Jefferson/Addison/Hockenson at QB18 price), Sam Darnold.

## Yahoo-specific notes — Yahoo-specific notes

- **Yahoo ADP** is generated only from Yahoo drafts and anchored to Yahoo's default pre-rank list, so it lags expert consensus and news: QBs (Allen ~20, Lamar/Daniels/Maye R3), TEs (McBride/Bowers R2), and name vets (Henry, Adams, Kamara, Jacobs before the exempt-list news, Evans) go earlier than on FantasyPros/Sleeper; late-August risers (Lloyd, Brooks ~77, Washington Jr., Stevenson, Allgeier, Price) still sit below their real value. Exploit: let others pay for QB/TE, buy sophomores and camp risers 5-15 picks under ECR.
- **Injury tags:** Yahoo shows Q/O/IR/PUP/SUSP tags on the board. Verify before clicking: Nabers, Henderson, Monangai, Love, Egbuka, Evans, Kittle, LaPorta, Kraft, Hubbard, Shakir, Keon Coleman, Jacobs (Exempt), Kamara, Charbonnet (PUP), Tyson/Conner/Kirk/Dell (IR).
- **Autopick:** with no queue, Yahoo autodrafts from your Pre-Draft Rankings, then its default rankings, with no smart positional logic beyond roster limits. Before the draft set a pre-rank list (re-order at least the top 80; move the avoid list and K/DEF to the bottom) and pre-queue 3-4 targets each round; if you disconnect, autopick fires instantly when the clock expires.
- **Timer:** Yahoo live drafts default to 90 seconds per pick (commissioner-adjustable, 30s-3min). 10 teams x 15 rounds = 150 picks; to finish in about 90 minutes the room needs ~30-40s picks, so the queue is essential. The board shows Yahoo ADP and Yahoo rank — sort by ADP, not "Rank."
- **Scoring:** Yahoo default is 0.5 PPR, 4-pt pass TD, 25 pass yds/pt, 10 rush/rec yds/pt: QB values are compressed (another reason to wait) and rushing-heavy RBs (Taylor, Cook, Walker, Judkins) gain a little on satellite backs.

## Sources
Verified Sept 2026 news (retrieved by search this session):
- https://sports.yahoo.com/fantasy/article/nfl-training-camp-injury-report-tracking-the-latest-news-updates-for-2026-fantasy-football-163938278.html
- https://sports.yahoo.com/fantasy/article/2026-fantasy-football-marshawn-lloyd-treveyon-henderson-among-biggest-adp-risers-fallers-as-of-sept-1-142718983.html
- https://sports.yahoo.com/fantasy/article/2026-fantasy-football-mike-washington-jr-cam-ward-among-biggest-adp-risers-fallers-as-of-august-25-143159599.html
- https://www.fantasypros.com/2026/09/14-fantasy-football-adp-risers-fallers-2026/
- https://www.fantasypros.com/2026/09/20-fantasy-football-injuries-to-monitor-2026/
- https://www.fantasypoints.com/nfl/articles/2026/nfl-preseason-injury-news-fantasy-football-impact
- https://www.espn.com/nfl/story/_/id/49774523/packers-rb-josh-jacobs-placed-commission-exempt-list
- https://www.foxnews.com/outkick-sports/nfl-conduct-policy-review-puka-nacua-continues-drives-fantasy-football-managers-nuts
- https://www.nbcsports.com/fantasy/football/player-news/2026-09-02/kubiak-optimistic-jeanty-will-play-week-1
- https://www.nfl.com/news/raiders-name-kirk-cousins-starting-fernando-mendoza-officially-backup
- https://www.profootballrumors.com/2026/09/cardinals-rb-jeremiyah-love-50-50-for-week-1
- https://www.cbssports.com/nfl/news/malik-nabers-injury-status-giants-wr-shares-honest-assessment-of-progress-week-1-availability/
- https://985thesportshub.com/2026/09/02/treveyon-henderson-injury-update-patriots/
- https://sports.yahoo.com/articles/eagles-trade-j-brown-patriots-204243114.html
- https://www.nfl.com/news/dolphins-trading-wr-jaylen-waddle-to-broncos-for-draft-picks-including-2026-first-rounder
- https://www.profootballnetwork.com/kenneth-walker-chiefs-foot-injury-depth-week-1-2026/
- https://www.nfl.com/news/vikings-name-kyler-murray-starting-week-1-quarterback-for-2026-season
- https://sports.yahoo.com/articles/travis-etienne-signs-saints-why-180134856.html
- https://www.cbssports.com/nfl/news/alvin-kamara-injury-saints-mcl-sprain-running-back-options/
- https://www.nbcsports.com/fantasy/football/player-news/2026-07-23/david-montgomery-to-lead-texans-backfield-split
- https://www.si.com/onsi/fantasy/nfl/denver-broncos-depth-chart-rj-harvey-rb5-jk-dobbins-rb1
- https://www.si.com/onsi/fantasy/nfl/6-fantasy-football-preseason-adp-risers-jonathon-brooks-shoots-up-the-rankings
- https://www.espn.com/nfl/story/_/id/49631705/49ers-george-kittle-eyes-return-practice-opener-australia
- https://www.si.com/nfl/every-starting-nfl-quarterback-2026-season-updated-weekly
- https://www.directv.com/insider/fantasy-football-qb-rankings/
Reference ADP/Yahoo pages (not fetched live; verify current numbers there):
- https://www.fantasypros.com/nfl/adp/half-point-ppr-overall.php
- https://football.fantasysports.yahoo.com/f1/draftanalysis
- https://help.yahoo.com/kb/fantasy-football/SLN6455.html (Yahoo draft timer/autopick)
