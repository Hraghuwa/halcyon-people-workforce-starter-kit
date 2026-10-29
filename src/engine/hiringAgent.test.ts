import assert from "node:assert/strict";
import { makeApplicants, runHiringAgent, sendOffers } from "./hiringAgent.ts";

const apps = makeApplicants();
const run = runHiringAgent(apps);
// Only under-18s are auto-rejected; nobody is dropped for a work gap or distance.
assert.ok(run.shortlist.every(a => a.age >= 18 && a.id_check === "ok"));
assert.ok(run.shortlist.some(a => a.gapMonths > 12) && run.shortlist.some(a => a.distanceKm > 20));
// The bias trap: ranking by distance alone fails the four-fifths check; pin balancing passes it.
const naive = runHiringAgent(apps, 600, 9, { overbook: 1.3, reviewCapacity: 240, balancePins: false });
assert.ok(!naive.fairness.passed && run.fairness.passed, `naive ${naive.fairness.ratio} balanced ${run.fairness.ratio}`);
// Uncertain cases go to people, within recruiter capacity.
assert.ok(run.review.length > 0 && run.review.length <= 240);
// No offer without a recruiter; a failed fairness gate needs a lead.
assert.throws(() => sendOffers(run, undefined, [run.shortlist[0].id]), /rule 3/);
const strict = naive;
assert.throws(() => sendOffers(strict, "R1", [strict.shortlist[0].id]), /Fairness/);
assert.equal(sendOffers(strict, "R1", [strict.shortlist[0].id, -1], "Lead").length, 1); // non-shortlisted id ignored
assert.equal(strict.audit.length, 1);
console.log("Hiring agent tests passed.", run.log.map(l => `\n  ${l.step.padEnd(8)} ${l.text}`).join(""));
