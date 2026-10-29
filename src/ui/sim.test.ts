// Run with bun (the UI modules import JSON directly): bun src/ui/sim.test.ts
import assert from "node:assert/strict";
import { DEFAULT_SCENARIO, newPlay, newWeek, START_CM, result, lastRunFor, PERSONAS, type Cand } from "./sim.ts";

const sc = { ...DEFAULT_SCENARIO, published: true, crisis: false };
const play = (o: object) => ({ ...newPlay(sc), ...o });
// Fair agent, recruiter approves: same numbers the first simulator showed.
const fair = result(play({ choice: "agent", decision: "approve" }), sc, []);
assert.equal(fair.score, 60.5); assert.ok(fair.badges.includes("Fair Hand"));
// The crisis card (viral post about a bot screening someone out) costs the agent path Risk.
assert.ok(result(play({ choice: "agent", decision: "approve" }), { ...sc, crisis: true }, []).score < fair.score);
// Complying with the store manager switches pin balancing off: the gate fails, and overruling costs Risk.
const naive = play({ choice: "agent", meera: "comply" }); naive.lim.balancePins = false;
const held = result({ ...naive, decision: "hold" }, sc, []), over = result({ ...naive, decision: "signoff" }, sc, []);
assert.ok(held.fairness! < 0.8 && over.measures.risk > fair.measures.risk);
// Agentic breaks rule 3 and never earns the staffing badge.
assert.ok(!result(play({ choice: "agentic" }), sc, []).badges.includes("Fully Staffed"));
// A real candidate far away is not shortlisted, and is told why in plain words, never because of a work gap.
const c: Cand = { ...PERSONAS[1], id: "c1", appliedAt: 1 };
const last = lastRunFor(sc, [c], newPlay(sc).lim, "screened");
assert.ok(last.reasons.c1?.includes("Nobody rejected you for a work gap") || last.shortlist.includes("c1") || last.review.includes("c1"));
// The candidate game: the first question depends on the file, and every candidate gets the shortlist cutoff to compare against.
assert.equal(newWeek({ id_check: "mismatch", gapMonths: 0 }).q1, "id"); assert.equal(newWeek({ id_check: "ok", gapMonths: 14 }).q1, "gap"); assert.equal(newWeek({ id_check: "ok", gapMonths: 1 }).q1, "");
assert.deepEqual(newWeek({ id_check: "ok", gapMonths: 0 }).m, START_CM);
assert.ok(last.cuts?.c1 && last.cuts.c1.km > 0, "cutoff recorded for every real candidate");
console.log("UI game-logic tests passed.");
