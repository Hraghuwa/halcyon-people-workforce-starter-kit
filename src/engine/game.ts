// Halcyon Basket: People and Workforce module. Pure game logic, no UI.
// Every number comes from src/data/people-workforce.json (exported from the Scenario Sheet).

export type Measure = "revenue" | "trust" | "morale" | "risk";
export type Measures = Record<Measure, number>;
export type ChoiceId = "person" | "genai" | "agent" | "agentic";

export interface Choice {
  id: ChoiceId; label: string; delegation: string; whatItDoes: string;
  cost: number; costIfWrong: number; dataPoints: number; humanCheckpoint: string;
  effects: Measures; why: string; staffingCoverage: number;
}
export interface Round {
  round: number; days: string; title: string; brief: string;
  spot: { signal: string; pattern: string; orchestrate: string; testTrust: string; verdict: string };
  personStaysInCharge: string; choices: Choice[];
  surprise?: { text: string; effects: Partial<Record<ChoiceId, { now?: Measures; carry?: Measures }>> };
}
export interface Scenario {
  module: string; function: string;
  shared: { start: Measures; boardRule: { trustBelow: number; moraleBelow: number; riskAbove: number };
            teamBudgetUnits: number; dataAllowancePoints: number };
  rounds: Round[];
}

// Limits the player sets for the Shift-Fill Agent (Round 2, agent choice only).
export interface AgentLimits { maxOvertime: 6 | 10 | 14; minRest: 10 | 12; autoConfirm: boolean; crossStore: boolean }
export const DEFAULT_LIMITS: AgentLimits = { maxOvertime: 10, minRest: 12, autoConfirm: false, crossStore: false };

// How loosening or tightening the limits changes the result. Immediate = this round; carry = added in Round 4.
export function limitModifiers(l: AgentLimits) {
  const now: Measures = { revenue: 0, trust: 0, morale: 0, risk: 0 };
  const carry: Measures = { revenue: 0, trust: 0, morale: 0, risk: 0 };
  if (l.maxOvertime === 14) { now.revenue += 1; carry.morale -= 2; carry.risk += 1; }
  if (l.maxOvertime === 6) { now.revenue -= 1; now.morale += 1; }
  if (l.minRest === 10) { now.revenue += 1; carry.morale -= 1; carry.risk += 2; }
  if (l.autoConfirm) { now.risk += 1; }
  if (l.crossStore) { now.revenue += 1; now.morale -= 1; }
  return { now, carry };
}

export interface RoundResult {
  round: number; choice: ChoiceId; deltas: Measures; after: Measures;
  cost: number; dataPoints: number; staffingCoverage: number; boardSteppedIn: boolean; note: string[];
}
export interface GameState {
  measures: Measures; round: number; budgetUsed: number; dataUsed: number;
  carry: Measures; history: RoundResult[]; finished: boolean;
}

const MEASURES: Measure[] = ["revenue", "trust", "morale", "risk"];
const clamp = (v: number) => Math.max(0, Math.min(100, v));

export function newGame(s: Scenario): GameState {
  return { measures: { ...s.shared.start }, round: 1, budgetUsed: 0, dataUsed: 0,
           carry: { revenue: 0, trust: 0, morale: 0, risk: 0 }, history: [], finished: false };
}

export function netScore(e: Measures) { return e.revenue + e.trust + e.morale - e.risk; }

// Which choices the player may pick now, and why a choice is locked.
export function availability(s: Scenario, g: GameState, budget = s.shared.teamBudgetUnits) {
  const r = s.rounds.find(x => x.round === g.round)!;
  const riskPause = g.measures.risk > s.shared.boardRule.riskAbove; // Governance rule 5
  return r.choices.map(c => {
    let locked = "";
    if (c.id !== "person" && riskPause) locked = "Risk is above 75: new AI deployments are paused";
    else if (g.budgetUsed + c.cost > budget + 1e-9) locked = "Not enough AI budget left";
    else if (g.dataUsed + c.dataPoints > s.shared.dataAllowancePoints) locked = "Customer-data allowance used up";
    return { choice: c, net: netScore(c.effects), locked };
  });
}

export function playRound(s: Scenario, g: GameState, choiceId: ChoiceId,
                          limits: AgentLimits = DEFAULT_LIMITS, surprise = false): GameState {
  if (g.finished) throw new Error("Game is over");
  const r = s.rounds.find(x => x.round === g.round)!;
  const c = r.choices.find(x => x.id === choiceId)!;
  const deltas: Measures = { ...c.effects };
  const note: string[] = [];
  const carry = { ...g.carry };

  if (g.round === 2 && choiceId === "agent") {
    const m = limitModifiers(limits);
    MEASURES.forEach(k => { deltas[k] += m.now[k]; carry[k] += m.carry[k]; });
    if (MEASURES.some(k => m.carry[k] !== 0)) note.push("Loose agent limits: extra burnout carried into Round 4");
  }
  // Optional surprise card: hits only the choices listed for it in the data file.
  const hit = surprise ? r.surprise?.effects[choiceId] : undefined;
  if (surprise && r.surprise) note.push(`Surprise: ${r.surprise.text}`);
  if (hit) MEASURES.forEach(k => { deltas[k] += hit.now?.[k] ?? 0; carry[k] += hit.carry?.[k] ?? 0; });
  if (g.round === 4) {
    MEASURES.forEach(k => { deltas[k] += carry[k]; carry[k] = 0; });
  }

  const after = { ...g.measures };
  MEASURES.forEach(k => { after[k] = clamp(after[k] + deltas[k]); });
  const b = s.shared.boardRule;
  const boardSteppedIn = after.trust < b.trustBelow || after.morale < b.moraleBelow || after.risk > b.riskAbove;
  if (boardSteppedIn) note.push("The board steps in");

  const result: RoundResult = { round: g.round, choice: choiceId, deltas, after, cost: c.cost,
    dataPoints: c.dataPoints, staffingCoverage: c.staffingCoverage, boardSteppedIn, note };
  return { measures: after, round: g.round + 1, budgetUsed: g.budgetUsed + c.cost,
    dataUsed: g.dataUsed + c.dataPoints, carry, history: [...g.history, result],
    finished: g.round === s.rounds.length };
}

// Company score shown on the leaderboard: equal weights, Risk counted as (100 - Risk).
export function companyScore(m: Measures) {
  return Math.round(0.25 * (m.revenue + m.trust + m.morale + (100 - m.risk)) * 10) / 10;
}

// The contract for the integration group: one call per round, plain numbers out.
export function moduleTurn(s: Scenario, g: GameState, choiceId: ChoiceId, limits?: AgentLimits) {
  const next = playRound(s, g, choiceId, limits);
  const last = next.history.at(-1)!;
  return { next, publish: { module: s.module, round: last.round, choice: last.choice,
    deltas: last.deltas, costUnits: last.cost, customerDataPoints: last.dataPoints,
    staffingCoverage: last.staffingCoverage } };
}
