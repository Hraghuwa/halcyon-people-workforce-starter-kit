# Halcyon Basket: People & Workforce Simulation Platform

**Team Pulse:** Shreya Kotary, Harsh Raghuwanshi, Swapnil Mathur, Gaurav Jawalkar, Shweta Agarwal.  
**Interactive 2D Platformer Engine & Candidate Career Run Lead:** Harsh Raghuwanshi ([@Hraghuwa](https://github.com/Hraghuwa))

---

## 🌟 Overview & Purpose

**Halcyon Basket** is an enterprise-grade simulation exploring ethical AI, workforce logistics, and algorithmic hiring fairness during a high-stakes retail crisis.

In Round 1, an upcoming Diwali/festival flash sale drives an **+80% order surge**. Stores across 9 Indian metropolitan cities urgently require **600 temporary pickers, packers, and leads by Day 4**. In just 48 hours, **8,400 job applications** flood the system. Human recruiters can only evaluate ~60 CVs/day each (720 CVs/day across 12 recruiters), creating a massive operational bottleneck. 

This platform allows stakeholders to experience this hiring pipeline from **both perspectives simultaneously** through real-time two-way reactive state:

1. **The Recruiter (Enterprise AI & Workforce Management)**: Configure AI screening limits, manage ID mismatch queues, navigate the four-fifths fairness rule (disparate impact audit), and make human-in-the-loop hiring decisions while monitoring company performance metrics (Revenue, Customer Trust, Employee Morale, Risk Exposure).
2. **The Candidate ("Career Run" 60fps 2D Platformer & "Candidate's Week")**: Built by **Harsh Raghuwanshi**, candidates physically jump, sprint, collect skills, converse with NPCs, and make branching career decisions across a 5-stage Mario-style side-scrolling platformer. Every jump, skill badge collected, and career choice updates their real application file on the recruiter's desk in real time.

---

## 🎮 Dual-Perspective Experience

```
       ┌──────────────────────────────────────────────────────────┐
       │                HALCYON SHARED STORE                      │
       │    (localStorage 'halcyon.v1' / In-Memory Data Bus)      │
       └────────────────────────────┬─────────────────────────────┘
                                    │ Real-time 2-way sync
            ┌───────────────────────┴───────────────────────┐
            ▼                                               ▼
┌───────────────────────────────┐               ┌───────────────────────────────┐
│        RECRUITER DESK         │               │     CANDIDATE "CAREER RUN"    │
│  - Scenario Configuration     │               │  - 60 FPS 2D Side-Scroller    │
│  - Hiring Agent Automation    │               │  - 5 Branching Stages         │
│  - 3 Human-in-the-Loop Gates  │               │  - ATS Keywords & Skills      │
│  - Distance & Pin Fairness Map│               │  - NPC Dialogue & Negotiations│
│  - Company Score & Outcomes   │               │  - Real-time Recruiter View   │
└───────────────────────────────┘               └───────────────────────────────┘
```

You can open `simulator.html` in **two side-by-side browser tabs**:
- Tab 1: `simulator.html#recruiter`
- Tab 2: `simulator.html#candidate`

Actions taken by the candidate in Career Run (e.g., verifying ID, collecting high-fit badges, countering offers) immediately alter candidate telemetry, interview scores, and status pins in the Recruiter's Hiring Map!

---

## 🕹️ Candidate Game: "Career Run" (Architecture & Game Logic)

Designed and implemented by **Harsh Raghuwanshi** ([`src/ui/careerrun.ts`](src/ui/careerrun.ts) & [`docs/adr/0002-candidate-career-run-platformer.md`](docs/adr/0002-candidate-career-run-platformer.md)).

### 1. 60 FPS Platformer Physics & Engine Mechanics
- **Deterministic 60 Hz Physics (`dt = 1/60`)**: Smooth sub-pixel integration with variable jump height, gravity acceleration, responsive air control, and wall collisions.
- **Juice & Feel**:
  - **8-frame Coyote Time**: Allows jumping right after walking off a ledge.
  - **8-frame Jump Buffering**: Queues jump commands pressed right before hitting the ground.
  - **Dynamic Double-Jump (`Keyword Boost`)**: Unlocked upon collecting ATS keyword power-ups or activating Mentor Ghost mode.
  - **Moving Platforms & Spring Pads**: Vertically and horizontally oscillating lifts carry player momentum. Spring pads (`^`) launch the player into high-altitude bonus routes.
  - **`★ STAR` Story Projectiles (`KeyQ` / Action Button)**: Fired to stun curveball interview questions and defeat bureaucratic obstacle bots.
- **Zero-Allocation Optimization**:
  - Reusable object pools for particles, floating text tags, projectiles, and boss orbs (no garbage collection stutter).
  - Offscreen procedural sprite cache (`buildSprites()`) and pre-rendered 4-layer parallax backdrops per level.
  - Viewport frustum culling maintaining **`0.2ms - 0.4ms` frame times at locked 60 FPS**.

### 2. The 5 Pipeline Worlds

| Stage | Name | Hiring Concept & Game Mechanics | Choice Gate (Branching Paths) | Boss Encounter |
| :---: | :--- | :--- | :--- | :--- |
| **0** | **Halcyon Career Hub** | Overworld roadmap with dynamic spline routes connecting all 5 stages. | Path selection & Route Map review | Hub overview |
| **1** | **Job Board Plains** | Sifting through 8,400 applicants: jump on genuine Emerald Job Posts, avoid Clickbait Pits, hit `?` power-up blocks to extract ATS keywords. | **L1 Choice**: Tailored CV (opens High Skybridge) vs. Employee Referral (Warp Pipe) vs. Mass Easy-Apply (Low Road). | **The ATS Gate** (3 HP laser scanner + Override Switch) |
| **2** | **Screening Caves** | Bioluminescent cavern testing truthfulness: moving ID scan sliders, bounce pads, and the *Honest Bridge* constructed from Stage 1 choices. | **L2 Choice**: Verify ID at Human Desk (Trust & Fairness boost) vs. Request 4/5ths Audit vs. Fast-Track Bot. | **The Gatekeeper** (Manual Review Barrier) |
| **3** | **Interview Castle** | 3-floor citadel testing domain readiness (Floor 1: HR Fit, Floor 2: WMS Pick Trial, Floor 3: Panel Prep). Fire STAR projectiles at Curveball Questions. | **L3 Choice**: Live WMS Floor Trial + STAR Story vs. Peer Co-Sign vs. Rehearsed Script. | **The 3-Interviewer Panel** (HR, Tech, and Ops interviewers) |
| **4** | **Offer Summit** | Golden-hour mountain ascent with moving Market Cloud lifts. Evaluate base benchmarks (₹185/hr), festival bonuses (+₹20/hr), and lead tiers. | **L4 Choice**: Counter-offer with Market Data (₹215/hr) vs. Accept Day-1 Bonus (₹195/hr) vs. Walk Away. | **Closing Deadline Clock** (3 HP countdown boss) |
| **5** | **Results Pavilion** | Playable victory pavilion with Stage Monuments and an interactive **Full Branching Journey Tree** with 1-click Choice Replay. | Replay any gate or switch directly to Recruiter Live Map. | Celebration & Reflection |

### 3. Candidate Metrics & Dynamic Consequence Preview
Candidate status is measured across 4 live dimensions:
- 💡 **Skills** (0–100): Boosted by collecting badges, jumping on matching job roles, and executing STAR interview trials.
- 🤝 **Trust** (0–100): Earned through transparent background disclosures and human desk ID verification.
- ⚡ **Stamina** (0–100): Consumed by rush sprints, hazard collisions, or stress traps; replenished by resting and shields.
- ⚖️ **Fairness** (0–100): Reflects adherence to unbiased hiring standards and pin-code diversity.

Before locking in any decision at a stage's **Branching Choice Gate**, an interactive glass modal previews the exact mathematical deltas on Skills, Trust, Stamina, and Fairness, while altering the physical geometry of the level ahead!

---

## 🏢 Recruiter Game: Human-in-the-Loop Governance & AI Logic

Governed by **Governance Rule 3** and defined in [`docs/adr/0001-round1-hiring-human-in-the-loop.md`](docs/adr/0001-round1-hiring-human-in-the-loop.md).

### 1. The 3 Human-in-the-Loop Gates

```
8,400 Applicants
       │
  [PERCEIVE]  Count applications and city vacancies
       │
    [PLAN]    Auto-reject ONLY legal under-18 violations
              ID mismatch/unreadable ──> RECRUITER REVIEW QUEUE   [Gate 1: Human ID Check]
              Rank by Availability & Distance
              Apply Per-City Quotas (balancePins)
       │
   [REFLECT]  Audit selection rates by gender and pin-code group
              If lowest/highest ratio < 0.8 ──> LEAD SIGN-OFF     [Gate 2: Four-Fifths Fairness]
       │
     [ACT]    sendOffers() ──> RECRUITER FORMAL APPROVAL          [Gate 3: Recruiter Approval]
              Audit trail logged with timestamp and author
```

1. **Gate 1 (Human ID Review Queue)**:
   - Candidates with name spelling mismatches or blurry photos are not auto-rejected. They are queued for human review.
   - Recruiter review capacity is strictly capped (12 recruiters × 20 CVs/day = 240/day max).
2. **Gate 2 (Four-Fifths Fairness Sign-off)**:
   - Computes selection parity across pin codes and demographics.
   - If disparate impact falls below **0.80**, algorithmic offer dispatch is physically blocked until a workforce lead signs off (incurring corporate risk).
3. **Gate 3 (Recruiter Formal Sign-off)**:
   - Automated algorithms are barred from releasing binding employment contracts without explicit human recruiter confirmation.

### 2. Live Hiring Map ([`src/ui/map.ts`](src/ui/map.ts))
An interactive multi-ring visualizer displaying applicants centered around metropolitan hub coordinates:
- **Layer 1: Who Applied**: Density of all 8,400 synthetic candidates.
- **Layer 2: Shortlist**: Candidates selected based on current ranking parameters.
- **Layer 3: Fairness by Distance**: Demonstrates how distance-only filtering systematically discriminates against peripheral, lower-income pin codes.
- **"What-If" Simulation Toggles**:
  - *Reserve places for every pin-code group* (re-establishes demographic parity to ≥ 0.90 ratio).
  - *Check IDs only for shortlist* (prevents 773 unmanageable ID cases from swamping recruiters).

---

## 📂 Repository File Structure

```
.
├── Halcyon_Scenario_Sheet_People_and_Workforce.xlsx  # Baseline master spreadsheet data
├── README.md                                         # Platform architecture and documentation
├── docs/
│   └── adr/
│       ├── 0001-round1-hiring-human-in-the-loop.md   # Architectural Decision: 3 Human Gates
│       └── 0002-candidate-career-run-platformer.md   # Architectural Decision: Career Run Platformer
├── scripts/
│   ├── build-ui.ts                                   # Bundles TypeScript + HTML into simulator.html
│   ├── enumerate.ts                                  # Monte Carlo run of 256 policy paths
│   └── export_sheet.py                               # Converts Excel sheet to JSON
├── simulator.html                                    # Standalone playable simulator application
└── src/
    ├── data/
    │   └── people-workforce.json                     # Seeded scenario data, metrics, and cards
    ├── engine/
    │   ├── game.ts                                   # Core game rules, scoring, and metrics engine
    │   ├── game.test.ts                              # Engine validation tests
    │   ├── hiringAgent.ts                            # Perceive-Plan-Act-Reflect hiring automation
    │   ├── hiringAgent.test.ts                       # Unit tests for the 3 human gates
    │   └── shiftFillAgent.ts                         # Round 2 shift scheduling engine
    └── ui/
        ├── candidate.ts                              # Candidate game UI controller
        ├── candgame.ts                               # The Candidate's Week narrative game
        ├── careerrun.ts                              # 60fps 2D Platformer Engine & Levels (by Harsh Raghuwanshi)
        ├── main.ts                                   # Application router & role switcher
        ├── map.ts                                    # Interactive radial Hiring Map canvas
        ├── recruiter.ts                              # Recruiter dashboard & 3-day scenario play
        ├── sim.ts                                    # Shared simulation state models & initializers
        ├── sim.test.ts                               # State management & Career Run tests
        ├── store.ts                                  # Persistent store & localStorage synchronization
        ├── template.html                             # Base liquid-glass styling & responsive layouts
        └── ui.ts                                     # Glass UI components, icons, and rendering helpers
```

---

## 🚀 Getting Started & Local Setup

### Prerequisites
- [Bun](https://bun.sh/) (recommended) or [Node.js](https://nodejs.org/) (v22.6+ with experimental strip types)
- Python 3 (optional, for running local static HTTP server or re-exporting Excel sheets)

### Running the Simulator

1. **Option A: Direct File Open**
   Simply open `simulator.html` in any modern web browser:
   ```bash
   open simulator.html
   ```

2. **Option B: Local Web Server (Recommended for multi-tab testing)**
   ```bash
   python3 -m http.server 8791
   ```
   Open two browser tabs side-by-side:
   - **Candidate Career Run:** `http://localhost:8791/simulator.html#candidate`
   - **Recruiter Hiring Desk:** `http://localhost:8791/simulator.html#recruiter`

### Building from Source

When modifying TypeScript files in `src/`:
```bash
# Rebuild the standalone simulator.html
bun scripts/build-ui.ts
```

### Running Test Suites

Verify engine integrity, algorithmic hiring gates, and game logic:
```bash
# Run all test suites
bun test

# Run individual test files
bun src/ui/sim.test.ts
bun src/engine/hiringAgent.test.ts
bun src/engine/game.test.ts

# Enumerate 256 policy permutations
bun scripts/enumerate.ts
```

---

## ⌨️ Controls & Shortcuts in Career Run

| Input | Action |
| :--- | :--- |
| **`◀` / `▶`** or **`A` / `D`** | Move Left / Right |
| **`Space`** or **`▲`** or **`W`** | Jump / Double Jump (with Keyword Boost) |
| **`Q`** | Fire `★ STAR` Story Projectile (stuns interview obstacles) |
| **`E`** | Interact with NPCs / Enter Choice Gates / Inspect Monuments |
| **`ESC`** / **Route Map** | Open Route Map / Checkpoint Jump |
| **Toggle Recruiter's View** | Open live split-view telemetry panel inside the platformer |
| **Ghost Mentor Toggle** | Enable predictive jump arc visualizer and assistance |

---

## 📜 License

Academic & simulation starter kit created for the Halcyon Basket workforce initiative. Built by Team Pulse (Harsh Raghuwanshi, Shreya Kotary, Swapnil Mathur, Gaurav Jawalkar, Shweta Agarwal).
