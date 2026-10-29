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
| `src/engine/hiringAgent.test.ts` | Tests for the hiring gates |
| `docs/adr/0001-round1-hiring-human-in-the-loop.md` | Design decision and reasoning for Round 1 |
| `src/engine/game.test.ts` | Tests that prove the engine matches the Scenario Sheet |
| `scripts/enumerate.ts` | Plays all 256 paths to check no single trick always wins |

Check it works (Node.js 22.6 or newer):

```
node --experimental-strip-types src/engine/game.test.ts
node --experimental-strip-types src/engine/hiringAgent.test.ts
node --experimental-strip-types scripts/enumerate.ts
```

When the Scenario Sheet changes: `pip install openpyxl`, then `python scripts/export_sheet.py <sheet.xlsx>`, then run the tests again.
