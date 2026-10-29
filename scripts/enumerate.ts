import { readFileSync } from "node:fs";
import { newGame, playRound, availability, netScore, companyScore, type Scenario, type ChoiceId } from "../src/engine/game.ts";
const s: Scenario = JSON.parse(readFileSync(new URL("../src/data/people-workforce.json", import.meta.url), "utf8"));
const ids: ChoiceId[] = ["person", "genai", "agent", "agentic"];
// Plays all 4 x 4 x 4 x 4 = 256 paths and ranks them by company score. Shows whether one path always wins.
for (const budget of [999, s.shared.teamBudgetUnits]) {
  const res: { path: string; score: number; net: number; units: number; board: boolean }[] = [];
  for (let n = 0; n < 256; n++) {
    const path = [0, 1, 2, 3].map(i => ids.at((n >> (2 * i)) & 3)!);
    let g = newGame(s), ok = true;
    for (const id of path) {
      if (availability(s, g, budget).find(x => x.choice.id === id)!.locked) { ok = false; break; }
      g = playRound(s, g, id);
    }
    if (!ok) continue;
    res.push({ path: path.join(" / "), score: companyScore(g.measures),
      net: g.history.reduce((a, h) => a + netScore(h.deltas), 0), units: g.budgetUsed,
      board: g.history.some(h => h.boardSteppedIn) });
  }
  res.sort((a, b) => b.score - a.score);
  console.log(`Budget ${budget}: ${res.length} playable paths; board steps in on ${res.filter(r => r.board).length}`);
  console.log(" Top 3:", res.slice(0, 3));
  console.log(" Worst:", res.at(-1));
}
