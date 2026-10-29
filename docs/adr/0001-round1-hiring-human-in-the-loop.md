# ADR-0001: Round 1 hiring runs as an agent behind human gates

**Status:** Proposed
**Date:** 2026-10-29
**Deciders:** Team Pulse (Shreya Kotary, Swapnil Mathur, Harsh Raghuwanshi, Gaurav Jawalkar, Shweta Agarwal)

## Context

Round 1 (days 1-3): the festival promo forecasts +80% orders. Stores need 600 temp pickers and packers across 9 cities by Day 4. 8,400 applications arrive in two days. 12 recruiters screen about 60 CVs a day each, so 720 a day. Time-to-hire is 6 days, and 45% of last festival's temps quit within 30 days.

Governance rule 3 says no AI on hiring without a human checkpoint. The sheet's own warning is that criteria like "gap in work history" or "distance" can quietly exclude women returning to work and poorer areas.

Before this ADR the engine only modelled Round 1 as four rows of numbers (`game.ts`). The Shift-Fill Agent existed only for Round 2. Nothing showed where the human sits in the hiring flow, and nothing checked fairness.

## Decision

Add `src/engine/hiringAgent.ts`: a Perceive, Plan, Act, Reflect agent whose Act step is physically gated by people.

```
8,400 applications
      |
 PERCEIVE  count applicants and vacancies per city
      |
 PLAN      auto-reject ONLY under-18        (the one legal rule)
           ID mismatch/unreadable ----------> RECRUITER REVIEW QUEUE   [gate 1]
           rank by availability, then distance
           per-city quota, split by pin-code group (balancePins)
      |
 REFLECT   selection rate by gender and pin code
           ratio < 0.8 (four-fifths rule) --> LEAD SIGN-OFF REQUIRED    [gate 2]
      |
 ACT       sendOffers() ----------------------> NAMED RECRUITER APPROVES [gate 3]
           every offer written to an audit log
```

Rules built into the code, not left to policy:

1. **Only objective rules reject.** Work gap and distance never exclude anyone. Distance only affects rank. Anything uncertain goes to a person.
2. **No offer without a recruiter.** `sendOffers()` throws without a named approver (Governance rule 3).
3. **Fairness gate.** Selection rates by gender and pin-code group are computed every run. If the lowest-to-highest ratio is under 0.8, offers cannot go out without a lead's sign-off.
4. **Recruiter capacity is a hard limit.** The review queue is capped (default 240 a day, 12 recruiters x 20). Overflow is reported as `deferred`, not silently dropped or auto-decided.
5. **Audit trail.** Each offer records who approved it, and who signed off the fairness gate if it failed.

## Options Considered

### Option A: Recruiters only (baseline)
| Dimension | Assessment |
|---|---|
| Complexity | Low |
| Cost | 0 units |
| Scalability | Poor: 720 CVs a day against 8,400 applications |
| Risk | Lowest, but only about 45% of places filled by Day 3 |

### Option B: Gen AI assists, recruiters decide
Writes local-language ads and summarises applications. Humans still shortlist.
**Pros:** cheap (5 units), no new risk. **Cons:** recruiters remain the bottleneck.

### Option C: Agent acts, human approves (chosen)
| Dimension | Assessment |
|---|---|
| Complexity | Medium |
| Cost | 15 units, 10 if it goes wrong |
| Scalability | Screens all 8,400, time-to-hire 6 days to 2 |
| Risk | Medium, controlled by the three gates |

### Option D: Agentic, no approver
Fastest (600 offers by Day 2) but breaks Governance rule 3, costs 30 units, and a single biased-hiring story is a legal and public risk. Rejected.

## Trade-off Analysis

The gates cost speed, and they are cheap next to the failure they prevent. Running the synthetic data (seeded, 8,400 applicants) showed two real problems:

- **Ranking by distance alone fails fairness.** The selection-rate ratio was **0.63**, and the gate blocks it. Reserving places per pin-code group lifts it to **0.90**. It costs about 1 point of 30-day retention (64% to 63%), a trade-off the player can see.
- **Checking every ID first swamps recruiters.** That gives 773 ID cases against capacity of 240. Ranking first and checking IDs only for the shortlist gives **79 cases**, which fits. Put the expensive human step after the cheap filter.
- **Overruling a failed gate is possible but costly.** A lead can sign off, and the game then adds Risk +3 and Trust -2. Holding offers costs Revenue instead.

## Consequences

- **Easier:** explaining to the board where a human decides; showing the player the three gates working; testing fairness (it is a unit test).
- **Harder:** the agent is slower than agentic, and approval and review work lands on 12 people.
- **Revisit:**
  - The 0.8 threshold and the audit groups (add age bands?).
  - Whether `balancePins` hides a different unfairness inside a group.
  - Real ID-check error rates (6% mismatch and 5% unreadable are assumptions).
  - The 45% early-quit rate: ranking by distance and availability is a guess at retention, so test it in the 2-city pilot.

## Action Items

1. [x] `hiringAgent.ts` with the three gates, and `hiringAgent.test.ts`.
2. [x] Hiring settings feed the Round 1 score through `hiringModifiers` and `playRound`.
3. [ ] Fill sheet tab **5 Agent moment** for Round 1 (it is blank in `Halcyon_Scenario_Sheet_People_and_Workforce_Round1.xlsx`) using the flow above, and tab **4 Productivity** (unit: applications screened per recruiter-day; baseline 60; the counter-measure is fairness and the ID-review backlog).
4. [ ] Pilot plan in the sheet: 2 cities for 24 hours, measuring time-to-hire, show-up rate and shortlist make-up.
5. [x] `simulator.html` shows the gates: ID queue, fairness bars, approval buttons.
6. [ ] Decide who the "lead" is and how sign-off is recorded.
