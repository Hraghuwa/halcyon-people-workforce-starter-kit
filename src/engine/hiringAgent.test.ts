import assert from "node:assert/strict";
import { makeApplicants, runHiringAgent, sendOffers, simulateOutcome, hiringModifiers, DEFAULT_HIRING_LIMITS as D } from "./hiringAgent.ts";

const apps = makeApplicants();
const run = runHiringAgent(apps);
// Only under-18s are auto-rejected; nobody is dropped for a work gap.
assert.ok(run.shortlist.every(a => a.age >= 18 && a.id_check === "ok"));
assert.ok(run.shortlist.some(a => a.gapMonths > 12));
// The bias trap: ranking by distance alone fails the four-fifths check; pin balancing passes it.
const naive = runHiringAgent(apps, 600, 9, { ...D, balancePins: false });
assert.ok(!naive.fairness.passed && run.fairness.passed, `naive ${naive.fairness.ratio} balanced ${run.fairness.ratio}`);
// The queue trap: checking every ID first swamps recruiters; checking only the shortlist fits their capacity.
const idFirst = runHiringAgent(apps, 600, 9, { ...D, idFirst: true });
assert.ok(idFirst.deferred > 0 && run.deferred === 0 && run.idCases < idFirst.idCases / 5);
// Retention: shortlisting beats the 55% baseline, and balancing costs only a little of it.
const o = simulateOutcome(run), on = simulateOutcome(naive);
assert.ok(o.stay30 > 0.55 && on.stay30 - o.stay30 < 0.03 && o.fillRate >= 0.9);
// Overruling a failed fairness gate costs Risk and Trust; holding offers costs Revenue.
assert.equal(hiringModifiers(naive, on, true).now.risk, 3);
assert.equal(hiringModifiers(naive, on, false).now.revenue, -2 + (on.fillRate < 0.9 ? -1 : 0));
// No offer without a recruiter; a failed fairness gate needs a lead.
assert.throws(() => sendOffers(run, undefined, [run.shortlist[0].id]), /rule 3/);
assert.throws(() => sendOffers(naive, "R1", [naive.shortlist[0].id]), /Fairness/);
assert.equal(sendOffers(naive, "R1", [naive.shortlist[0].id, -1], "Lead").length, 1); // non-shortlisted id ignored
assert.equal(naive.audit.length, 1);
console.log("Hiring agent tests passed.", run.log.map(l => `\n  ${l.step.padEnd(8)} ${l.text}`).join(""));
