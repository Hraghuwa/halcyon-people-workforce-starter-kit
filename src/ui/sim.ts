// Game logic for the Round 1 "Hiring Floor": scenario, candidates, the three-day play, cases, results. No DOM here.
import data from "../data/people-workforce.json";
import { newGame, playRound, companyScore, netScore, type Scenario, type ChoiceId, type Measures } from "../engine/game.ts";
import { makeApplicants, runHiringAgent, simulateOutcome, hiringModifiers, sendOffers, PERSON_BASELINE,
  DEFAULT_HIRING_LIMITS, type Applicant, type HiringLimits, type HiringRun } from "../engine/hiringAgent.ts";

export const S = data as unknown as Scenario, R1 = S.rounds[0], START = S.shared.start;
export const CITIES = ["Mumbai", "Pune", "Delhi", "Bengaluru", "Hyderabad", "Chennai", "Kolkata", "Ahmedabad", "Jaipur"];
export type MK = keyof Measures;
export const MKS: MK[] = ["revenue", "trust", "morale", "risk"];
export const MN: Record<MK, string> = { revenue: "Revenue", trust: "Customer Trust", morale: "Employee Morale", risk: "Risk Exposure" };
export type Decision = "" | "approve" | "signoff" | "hold";
export const clamp = (v: number) => Math.max(0, Math.min(100, v));

// ---------- scenario (made by the recruiter) and candidates (people who apply) ----------
export interface ScenarioCfg { title: string; vacancies: number; cities: number; applications: number; recruiters: number; crisis: boolean; published: boolean; by: string }
export const DEFAULT_SCENARIO: ScenarioCfg = { title: R1.title, vacancies: 600, cities: 9, applications: 8400, recruiters: 12, crisis: true, published: false, by: "" };

export interface Cand {
  id: string; name: string; city: number; gender: "F" | "M"; lowIncomePin: boolean; age: number; gapMonths: number;
  distanceKm: number; availableDay: number; id_check: Applicant["id_check"]; story: string; appliedAt: number;
  challenge?: { text: string; resolution?: "reinstated" | "upheld" | "ignored" };
}
export const PERSONAS: Omit<Cand, "id" | "appliedAt">[] = [
  { name: "Priya Nair", city: 1, gender: "F", lowIncomePin: false, age: 29, gapMonths: 14, distanceKm: 6, availableDay: 2, id_check: "ok", story: "Back after a 14-month career break to care for family. Fast and careful, and wants steady shifts." },
  { name: "Imran Qureshi", city: 2, gender: "M", lowIncomePin: true, age: 24, gapMonths: 2, distanceKm: 24, availableDay: 1, id_check: "mismatch", story: "Delivery rider living far from the store. His ID says Mohd, his application says Mohammad." },
  { name: "Anita Rao", city: 3, gender: "F", lowIncomePin: true, age: 19, gapMonths: 0, distanceKm: 11, availableDay: 3, id_check: "unreadable", story: "First job. Her ID photo was blurry on a cheap phone, and she can start from Day 3." },
];

// ---------- the three-day play ----------
export interface Play {
  day: 1 | 2 | 3 | 4; step: number; choice: ChoiceId | ""; lim: HiringLimits; decision: Decision; confirm: boolean;
  id?: string; meera?: string; challenge?: string; saved: boolean; started: number; log: string[];
}
export const newPlay = (sc: ScenarioCfg): Play => ({ day: 1, step: 0, choice: "", decision: "", confirm: false, saved: false, started: Date.now(), log: [],
  lim: { ...DEFAULT_HIRING_LIMITS, reviewCapacity: Math.min(12, sc.recruiters) * 20 } });

export interface LastRun { stage: "screened" | "offers" | "held"; shortlist: string[]; review: string[]; reasons: Record<string, string>; at: number; vacancies: number }
export interface RunRec { id: string; name: string; score: number; fairness: number; fill: number; stay: number; choice: string; badges: string[]; at: number; sample?: boolean }

// ---------- cases: first-person role-play moments ----------
export type Fx = Partial<Measures>;
export interface Opt { key: string; label: string; fx: Fx; npc?: { meera?: number; anil?: number }; note: string }
export const CASES: Record<"id" | "meera" | "challenge", Opt[]> = {
  id: [
    { key: "desk", label: "Send it to the ID desk and verify at joining", fx: { trust: 1 }, npc: { anil: 5 }, note: "He keeps his place and a person checks his papers. Slower for you, fair to him." },
    { key: "reject", label: "Reject: the names do not match", fx: { trust: -1, risk: 2 }, npc: { anil: -6 }, note: "A spelling mismatch costs a good picker, and this is the exclusion pattern regulators notice." },
    { key: "accept", label: "Accept it without checking", fx: { revenue: 1, risk: 3 }, npc: { anil: -8 }, note: "Fast, but an unchecked ID is exactly the legal risk the sheet warns about." },
  ],
  meera: [
    { key: "comply", label: "Fine. Take the nearest 600.", fx: { revenue: 1, trust: -1, risk: 2 }, npc: { meera: 8, anil: -6 }, note: "This switches off pin-code balancing, so the fairness gate will probably block your offers." },
    { key: "refuse", label: "Not at the cost of fairness.", fx: {}, npc: { meera: -8, anil: 6 }, note: "Meera is unhappy. Dr. Rao notices you held the line." },
    { key: "compromise", label: "I will widen the shortlist and keep the quotas.", fx: { revenue: 1 }, npc: { meera: 3, anil: 3 }, note: "More names on the list covers no-shows without dropping the fairness quota." },
  ],
  challenge: [
    { key: "reinstate", label: "Review the file myself and reinstate", fx: { trust: 2, risk: -1, morale: 1 }, npc: { anil: 8 }, note: "A person looked, and the applicant gets a real answer." },
    { key: "uphold", label: "Uphold it, and send a written reason", fx: {}, npc: { anil: 2 }, note: "The decision stands, but the applicant is told why." },
    { key: "ignore", label: "Ignore it. We have no time.", fx: { trust: -2, risk: 2 }, npc: { anil: -10 }, note: "A challenged rejection must stay with a person. This is how a post goes viral." },
  ],
};

// ---------- pool, runs, results ----------
const poolCache = new Map<string, Applicant[]>();
const REAL = 1_000_000;
export function buildPool(sc: ScenarioCfg, cands: Cand[]) {
  const k = sc.applications + ":" + sc.cities; let base = poolCache.get(k);
  if (!base) { base = makeApplicants(11, sc.applications, sc.cities); poolCache.set(k, base); }
  const real = cands.filter(c => c.city < sc.cities).map((c, i): Applicant => ({ id: REAL + i, city: c.city, gender: c.gender, lowIncomePin: c.lowIncomePin,
    age: c.age, gapMonths: c.gapMonths, distanceKm: c.distanceKm, availableDay: c.availableDay, id_check: c.id_check }));
  const realMap = new Map<number, Cand>(); cands.filter(c => c.city < sc.cities).forEach((c, i) => realMap.set(REAL + i, c));
  return { pool: [...base, ...real], realMap };
}

const runCache = new Map<string, { run: HiringRun; out: ReturnType<typeof simulateOutcome> }>();
export function evalRun(sc: ScenarioCfg, cands: Cand[], lim: HiringLimits) {
  const k = JSON.stringify([sc.applications, sc.cities, sc.vacancies, cands.map(c => [c.id, c.availableDay, c.city, c.distanceKm]), lim]);
  let v = runCache.get(k);
  if (!v) { const run = runHiringAgent(buildPool(sc, cands).pool, sc.vacancies, sc.cities, lim); v = { run, out: simulateOutcome(run, sc.cities) }; runCache.set(k, v); if (runCache.size > 60) runCache.clear(); }
  return v;
}

// Plain-language reason a real candidate was or was not shortlisted (the candidate sees this).
export function lastRunFor(sc: ScenarioCfg, cands: Cand[], lim: HiringLimits, stage: LastRun["stage"]): LastRun {
  const { run } = evalRun(sc, cands, lim), { realMap } = buildPool(sc, cands);
  const sl = new Set(run.shortlist.map(a => a.id)), rv = new Set(run.review.map(r => r.id)), reasons: Record<string, string> = {};
  realMap.forEach((c, id) => {
    if (sl.has(id) || rv.has(id)) return;
    const mates = run.shortlist.filter(a => a.city === c.city && (!lim.balancePins || a.lowIncomePin === c.lowIncomePin));
    const day = mates.length ? Math.max(...mates.map(a => a.availableDay)) : 0, km = mates.length ? Math.max(...mates.map(a => a.distanceKm)) : 0;
    reasons[c.id] = `In ${CITIES[c.city]} the agent shortlisted ${mates.length} people in your group. They could start by Day ${day} and lived within ${km} km. You could start on Day ${c.availableDay} and live ${c.distanceKm} km away. Nobody rejected you for a work gap.`;
  });
  const idOf = (ids: Set<number>) => [...ids].map(i => realMap.get(i)?.id).filter((x): x is string => !!x);
  return { stage, shortlist: idOf(sl), review: idOf(rv), reasons, at: Date.now(), vacancies: sc.vacancies };
}

export function funnel(p: Play, sc: ScenarioCfg, cands: Cand[]) {
  const n = sc.applications + cands.length, v = sc.vacancies, c = R1.choices.find(x => x.id === p.choice) ?? R1.choices[2];
  const arr = [Math.round(n * 0.45), n, n, n];
  let screened: number[], shortlisted: number[], offers: number[], filled: number[];
  if (p.choice === "agent") {
    const { run, out } = evalRun(sc, cands, p.lim), sl = run.shortlist.length, sent = p.decision === "hold" ? 0 : p.day >= 3 && p.decision ? sl : 0;
    screened = arr; shortlisted = [Math.round(sl * .4), sl, sl, sl]; offers = [0, 0, sent, sent]; filled = [0, 0, 0, p.decision && p.decision !== "hold" ? out.filled : 0];
  } else {
    const cap = (p.choice === "genai" ? 1.4 : p.choice === "agentic" ? 20 : 1) * sc.recruiters * 60, fill = Math.round(v * c.staffingCoverage / 100);
    screened = [cap, cap * 2, cap * 3, cap * 4].map(x => Math.min(x, n)); shortlisted = screened.map(x => Math.round(x * 0.12));
    offers = [0, Math.round(fill * .4), fill, fill]; filled = [0, 0, 0, fill];
  }
  return { days: ["Day 1", "Day 2", "Day 3", "Day 4"], applications: arr, screened, shortlisted, offers, filled };
}

export function badges(p: Play, fairPassed: boolean | null, fill: number): string[] {
  const b: string[] = [];
  if (p.choice === "agent" && fairPassed && p.decision === "approve") b.push("Fair Hand");
  if (p.meera === "refuse" || p.meera === "compromise") b.push("Held the Line");
  if (p.challenge === "reinstate") b.push("Open Door");
  if (p.choice && p.choice !== "agentic" && p.choice !== "person") b.push("Human in Charge");
  if (fill >= 0.95 && p.choice !== "agentic") b.push("Fully Staffed");
  return b;
}

export function result(p: Play, sc: ScenarioCfg, cands: Cand[]) {
  const base = newGame(S), choice = p.choice as ChoiceId;
  let g, run: HiringRun | undefined, out: ReturnType<typeof simulateOutcome> | undefined, d: Decision = "";
  if (choice === "agent") {
    ({ run, out } = evalRun(sc, cands, p.lim));
    d = p.decision || (run.fairness.passed ? "approve" : "hold");
    if (d !== "hold") sendOffers({ ...run, audit: [] }, "recruiter", run.shortlist.map(a => a.id), d === "signoff" ? "HR Lead" : undefined);
    g = playRound(S, base, "agent", undefined, sc.crisis, hiringModifiers(run, out, d === "signoff"));
  } else g = playRound(S, base, choice, undefined, sc.crisis);
  const extra: Measures = { revenue: 0, trust: 0, morale: 0, risk: 0 };
  (["id", "meera", "challenge"] as const).forEach(k => { const o = CASES[k].find(x => x.key === p[k]); if (o) MKS.forEach(m => extra[m] += o.fx[m] ?? 0); });
  const h = g.history[0], deltas = {} as Measures, measures = {} as Measures;
  MKS.forEach(m => { measures[m] = clamp(g.measures[m] + extra[m]); deltas[m] = measures[m] - START[m]; });
  const br = S.shared.boardRule, board = measures.trust < br.trustBelow || measures.morale < br.moraleBelow || measures.risk > br.riskAbove;
  const fill = out ? out.fillRate : (R1.choices.find(x => x.id === choice)?.staffingCoverage ?? 0) / 100;
  const stay = out ? out.stay30 : PERSON_BASELINE.stay30;
  return { measures, deltas, extra, board, score: companyScore(measures), net: MKS.reduce((a, m) => a + (m === "risk" ? -deltas[m] : deltas[m]), 0), run, out, d, fill, stay,
    note: h.note, fairness: run?.fairness.ratio ?? null, badges: badges(p, run?.fairness.passed ?? null, fill) };
}
export { netScore, companyScore };
