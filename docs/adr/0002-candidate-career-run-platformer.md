# ADR-0002: Candidate "Career Run" 2D Side-Scrolling Platformer with Live Recruiter Synchronization

**Status:** Accepted
**Date:** 2026-11-03
**Author:** Harsh Raghuwanshi (`@Hraghuwa`) — Team Pulse (Shreya Kotary, Swapnil Mathur, Harsh Raghuwanshi, Gaurav Jawalkar, Shweta Agarwal)

## Context

In Round 1 of the Halcyon Basket People & Workforce Simulator, 8,400 candidates apply for 600 festival roles across 9 cities in 48 hours. While ADR-0001 established the three human-in-the-loop gates on the Recruiter side (`hiringAgent.ts`) and "The Candidate's Week" (`candgame.ts`) modelled the applicant's four-day wait as a card-based narrative, we wanted candidates to *physically experience* the hiring funnel as an interactive, 60fps Mario-style 2D side-scrolling platformer (**Career Run**) where platforming skill, exploration, and branching decisions directly shape their real application file on the Recruiter's desk.

## Decision

Implement `src/ui/careerrun.ts` and extend `Cand` in `src/ui/sim.ts` with `CareerRunState`, bundled directly into the self-contained `simulator.html`.

### 1. Five-Stage Pipeline World & Hub Overworld

```
                    [Halcyon Career Hub Overworld]
                                  |
  Stage 1: Job Board Plains   --->Choice Gate 1 (Tailored / Referral / Mass-Apply)---> Boss: The ATS Gate
                                  |
  Stage 2: Screening Caves    --->Choice Gate 2 (Human ID Desk / 4/5ths Audit / Bot)--> Boss: The Gatekeeper
                                  |
  Stage 3: Interview Castle   --->Choice Gate 3 (STAR + Floor Trial / Peer / Script)--> Boss: 3-Interviewer Panel
                                  |
  Stage 4: Offer Summit       --->Choice Gate 4 (Negotiate ₹215 / Fast ₹195 / Walk)---> Boss: Deadline Clock
                                  |
  Stage 5: Results Pavilion   --->Interactive Trophy Stage + Full 4-Stage Branching Journey Tree
```

### 2. Core Platformer Engine (`src/ui/careerrun.ts`)

- **Fixed-Timestep 60 Hz Physics (`DT = 1/60`)**: Variable jump height, double-jump (`Keyword Boost`), 8-frame coyote time, 8-frame jump buffering, moving horizontal/vertical platforms (`G.movers`), spring bounce pads (`^`), warp pipes (`P`), and `★ STAR` story projectiles (`KeyQ`).
- **Zero Per-Frame Allocations & Offscreen Caching**:
  - Pre-allocated pools for particles (`PARTICLES`), floating text (`FLOATS`), enemies (`ENEMIES`), boss obstacles (`ORBS`), and projectiles (`PROJECTILES`).
  - Offscreen-cached procedural character/tile sprites (`buildSprites()`) and 4-layer parallax backgrounds (`getBgCache()`) across all 6 world palettes (`WORLDS[0..5]`).
  - Viewport frustum culling (`c0..c1` visible tile columns), sustaining `60 FPS` (`0.2ms–0.4ms` frame time).

### 3. Branching Choice Architecture & Carry-Forward State

Each stage features a **Branching Choice Moment** modal that previews consequences on `Skills`, `Trust`, `Stamina`, and `Fairness` before committing, physically alters the level's tile map (`High-Road Skybridge`, `Express Warp Pipe`, or `Crowded Lower Road`), and carries forward into subsequent levels:
- **Stage 1 (`L1_CHOICE`)**: Tailored application with ATS keywords vs. Employee Referral vs. Mass Easy-Apply. Honest/Tailored choices construct the `✓ Stage 1 Honest Bridge` in Stage 2.
- **Stage 2 (`L2_CHOICE`)**: Verify ID at the Human Desk (Gate 1) vs. Request Four-Fifths Fairness Audit (Gate 2) vs. Fast-Track Bot.
- **Stage 3 (`L3_CHOICE`)**: Live WMS Floor Trial + `★ STAR` Story vs. Peer Co-Sign vs. Rehearsed Script.
- **Stage 4 (`L4_CHOICE`)**: Counter-Offer with Market Data & Badges (`₹215/hr` Lead Picker track) vs. Day-1 Express Acceptance (`₹195/hr`) vs. Walk Away with Dignity.

### 4. Two-Way Live Recruiter Synchronization

Every action in `careerrun.ts` invokes `syncToRecruiter(c)`, which updates `db.cands`, recalculates `db.last = lastRunFor(...)`, and persists to `localStorage` (`halcyon.v1`):
- **In-Game Recruiter's View Panel**: Toggleable live telemetry showing ID Gate 1 status, Fairness Gate 2 four-fifths ratio (`0.90 Passed`), Panel Score (`92%`), Offer Status (`₹185/hr pending` -> `₹215/hr negotiated`), Applied Roles, ATS Keywords, and NPC relationship meters (`Dr. Anil Rao`, `Meera Shah`).
- **Hiring Map (`src/ui/map.ts`) & Recruiter Dashboard (`src/ui/recruiter.ts`)**: Candidate pins and case files reflect the candidate's Career Run progress, badges, and negotiated offer live across browser tabs.
