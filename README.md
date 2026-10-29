# Halcyon Basket: People and Workforce module (starter kit)

Team Pulse: Shreya Kotary, Swapnil Mathur, Harsh Raghuwanshi, Gaurav Jawalkar, Shweta Agarwal.

This folder holds the tested core of our simulation. The build guide (Word document) explains every step.

| File | What it is |
| --- | --- |
| `Halcyon_Scenario_Sheet_People_and_Workforce.xlsx` | Our filled Scenario Sheet: the source of every number |
| `scripts/export_sheet.py` | Turns the sheet into `src/data/people-workforce.json` |
| `src/data/people-workforce.json` | Rounds, choices, costs, effects, SPOT notes, surprise cards |
| `src/engine/game.ts` | Game rules: play a round, budget, board rule, company score, integration contract |
| `src/engine/shiftFillAgent.ts` | The Shift-Fill Agent (Round 2): Perceive, Plan, Act, Reflect on synthetic staff |
| `src/engine/hiringAgent.ts` | Round 1 hiring agent with three human gates (ID review, fairness sign-off, recruiter approval) |
| `simulator.html` | Playable Round 1 simulator, Recruiter and Candidate sides (built from `src/ui/`) |
| `src/ui/map.ts` | Hiring Map: where the agent's shortlist falls around a city hub, with fairness-by-distance and what-if rules |
| `src/ui/sim.test.ts` | Tests for the game logic behind the screen (run with `bun`) |
| `src/engine/hiringAgent.test.ts` | Tests for the hiring gates |
| `docs/adr/0001-round1-hiring-human-in-the-loop.md` | Design decision and reasoning for Round 1 |
| `src/engine/game.test.ts` | Tests that prove the engine matches the Scenario Sheet |
| `scripts/enumerate.ts` | Plays all 256 paths to check no single trick always wins |

Play Round 1: open `simulator.html` in a browser (rebuild with `bun scripts/build-ui.ts` after changing `src/`). It needs internet for the fonts and charts.

Each role opens with a scroll-driven briefing (skippable, replayable from Help): words resolve as you scroll and the numbers count up. The interface uses Poppins and a liquid-glass look, with objectives, relationship changes and a 3-star board review to give each play a goal.

There are two logins, with no password. **Recruiter** creates and publishes the scenario, then plays three days (choose an approach, clear the human gates, approve offers) and gets a debrief and leaderboard. **Candidate** applies (or plays a persona), chats with the screening assistant, sees why they were or were not shortlisted, and can challenge a rejection. Open the page in two tabs of the same browser to play both sides at once; data is stored in that browser only.

Check it works (Node.js 22.6 or newer):

```
node --experimental-strip-types src/engine/game.test.ts
node --experimental-strip-types src/engine/hiringAgent.test.ts
node --experimental-strip-types scripts/enumerate.ts
```

When the Scenario Sheet changes: `pip install openpyxl`, then `python scripts/export_sheet.py <sheet.xlsx>`, then run the tests again.
