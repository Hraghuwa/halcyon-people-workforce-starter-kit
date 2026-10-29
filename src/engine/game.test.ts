import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newGame, playRound, availability, netScore, companyScore, moduleTurn, type Scenario, type ChoiceId } from "./game.ts";
import { makeWorld, runShiftFillAgent } from "./shiftFillAgent.ts";

const s: Scenario = JSON.parse(readFileSync(new URL("../data/people-workforce.json", import.meta.url), "utf8"));
const play = (ids: ChoiceId[], budget = 999, surprise = false) => {
  let g = newGame(s);
  for (const id of ids) { const a = availability(s, g, budget).find(x => x.choice.id === id)!; assert.equal(a.locked, "", `${id} locked: ${a.locked}`); g = playRound(s, g, id, undefined, surprise); }
  return g;
};

// 1. Net scores match the Scenario Sheet.
const nets = s.rounds.map(r => r.choices.map(c => netScore(c.effects)));
assert.deepEqual(nets, [[0,4,7,-4],[0,4,9,-4],[0,-2,-7,-19],[0,6,-1,-7]]);
// 2. Round 3: the person path is at least as good as every AI choice.
assert.ok(Math.max(...nets[2].slice(1)) <= 0);
// 3. All agentic: Morale 55 -> 31, Risk 40 -> 70 (as stated in the guide).
const all = play(["agentic","agentic","agentic","agentic"]);
assert.equal(all.measures.morale, 31); assert.equal(all.measures.risk, 70); assert.equal(all.budgetUsed, 115); assert.equal(all.dataUsed, 4);
// 4. Best plan: 32 units, net +22.
const best = play(["agent","agent","person","genai"]);
const net = (g: ReturnType<typeof newGame>) => g.history.reduce((a, h) => a + netScore(h.deltas), 0);
assert.equal(best.budgetUsed, 32); assert.equal(net(best), 22);
// 5. Within the equal share (16.7 units) the best is Gen AI / Gen AI / person / Gen AI = 15 units, net +14.
const share = play(["genai","genai","person","genai"], 16.7); assert.equal(share.budgetUsed, 15); assert.equal(net(share), 14);
// 6. Budget lock works: after Round 1 agent (15 units) the Round 2 agent (12) is locked at a 16.7 budget.
let g = playRound(s, newGame(s), "agent");
assert.notEqual(availability(s, g, 16.7).find(x => x.choice.id === "agent")!.locked, "");
// 7. Loose limits carry burnout into Round 4.
g = newGame(s); g = playRound(s, g, "person"); g = playRound(s, g, "agent", { maxOvertime: 14, minRest: 10, autoConfirm: true, crossStore: true });
assert.deepEqual(g.carry, { revenue: 0, trust: 0, morale: -3, risk: 3 });
g = playRound(s, g, "person"); g = playRound(s, g, "genai");
assert.equal(g.history.at(-1)!.deltas.morale, 1);
// 7b. Round 1 hiring result flows into the score: overruling a failed fairness gate adds Risk 3 and Trust -2.
g = playRound(s, newGame(s), "agent", undefined, false, { now: { revenue: 0, trust: -2, morale: 0, risk: 3 }, carry: { revenue: 0, trust: 0, morale: 1, risk: 0 } });
assert.equal(g.history[0].deltas.risk, 6); assert.equal(g.history[0].deltas.trust, 0); assert.equal(g.carry.morale, 1);
// 8. Integration contract publishes plain numbers.
const t = moduleTurn(s, newGame(s), "agent");
assert.equal(t.publish.staffingCoverage, 90); assert.equal(t.publish.costUnits, 15);
console.log("All engine tests passed. Company score, best plan:", companyScore(best.measures), "| all agentic:", companyScore(all.measures));

// Agent moment: fill rate under different limits.
const w = makeWorld(7);
for (const L of [{maxOvertime:6,minRest:12,autoConfirm:false,crossStore:false},{maxOvertime:10,minRest:12,autoConfirm:false,crossStore:false},{maxOvertime:14,minRest:10,autoConfirm:true,crossStore:true}] as const) {
  const run = runShiftFillAgent(w, L);
  console.log(JSON.stringify(L), "fill", Math.round(run.fillRate*100)+"%", "escalated", run.escalated, "breaches", run.ruleBreaches, "top20%", Math.round(run.topFifthShare*100)+"%");
}
runShiftFillAgent(w, {maxOvertime:10,minRest:12,autoConfirm:false,crossStore:false}).log.forEach(l => console.log(" ", l.step.padEnd(9), l.text));
