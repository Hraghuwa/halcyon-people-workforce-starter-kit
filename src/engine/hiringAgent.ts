// Round 1 hiring agent: Perceive -> Plan -> Act -> Reflect, with human gates (Governance rule 3).
// The agent may shortlist and book interviews. It can never reject on judgement or send an offer:
// anything uncertain goes to a recruiter queue, and offers need a named recruiter's approval.
import { rng } from "./shiftFillAgent.ts";

export interface Applicant {
  id: number; city: number; gender: "F" | "M"; lowIncomePin: boolean; age: number;
  gapMonths: number; distanceKm: number; availableDay: number; id_check: "ok" | "mismatch" | "unreadable";
}
export interface HiringLimits {
  overbook: number;        // shortlist this many times the places, to cover no-shows
  reviewCapacity: number;  // ID cases recruiters can review per day (12 recruiters x 20)
  balancePins: boolean;    // reserve places for each pin-code group in proportion to its applicants
  idFirst: boolean;        // true: check every ID before ranking (slow). false: rank first, check only the shortlist
}
export const DEFAULT_HIRING_LIMITS: HiringLimits = { overbook: 1.3, reviewCapacity: 240, balancePins: true, idFirst: false };
export interface Review { id: number; reason: string }
export interface Fairness { rates: Record<string, number>; ratio: number; passed: boolean }
export interface HiringRun {
  applicants: number; vacancies: number; shortlist: Applicant[]; review: Review[]; deferred: number;
  idCases: number; fairness: Fairness; log: { step: string; text: string }[]; audit: string[];
}

export function makeApplicants(seed = 11, n = 8400, cities = 9) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, id): Applicant => {
    const lowIncomePin = r() < 0.4, gender = r() < 0.45 ? "F" : "M";
    // Women returning to work and low-income pin codes are more likely to have gaps / longer commutes / ID paperwork problems.
    const idBad = r() < (lowIncomePin ? 0.15 : 0.07);
    return { id, city: Math.floor(r() * cities), gender, lowIncomePin, age: 16 + Math.floor(r() * 30),
      gapMonths: Math.floor(r() * r() * 30 * (gender === "F" ? 1.8 : 1)), distanceKm: Math.round(r() * (lowIncomePin ? 30 : 18)),
      availableDay: 1 + Math.floor(r() * 5), id_check: idBad ? (r() < 0.55 ? "mismatch" : "unreadable") : "ok" };
  });
}

// Assumption (tune in the pilot): long commutes and late starts raise the chance a temp quits within 30 days. Mean is about 45%.
export const quitProb = (a: Applicant) => Math.min(0.8, 0.3 + 0.012 * a.distanceKm + (a.availableDay > 3 ? 0.05 : 0));

const rate = (all: Applicant[], pick: (a: Applicant) => boolean, short: Set<number>) => {
  const g = all.filter(pick); return g.length ? g.filter(a => short.has(a.id)).length / g.length : 0;
};

export function runHiringAgent(apps: Applicant[], vacancies = 600, cities = 9, limits = DEFAULT_HIRING_LIMITS): HiringRun {
  const log: HiringRun["log"] = [];
  log.push({ step: "perceive", text: `${apps.length} applications, ${vacancies} places across ${cities} cities.` });

  // PLAN: only objective rules reject. Gap and distance never exclude; distance only affects rank.
  const adults = apps.filter(a => a.age >= 18);                 // legal minimum: the one auto-reject
  const idBad = (a: Applicant) => a.id_check !== "ok";
  const pool = limits.idFirst ? adults.filter(a => !idBad(a)) : adults;
  const perCity = Math.ceil(vacancies / cities * limits.overbook), ranked: Applicant[] = [];
  const byRank = (a: Applicant, b: Applicant) => a.availableDay - b.availableDay || a.distanceKm - b.distanceKm;
  for (let c = 0; c < cities; c++) {
    const inCity = pool.filter(a => a.city === c);
    // Ranking by distance alone shuts out far-away (poorer) pin codes; balancePins gives each group a quota in proportion to its applicants.
    const groups = limits.balancePins ? [inCity.filter(a => a.lowIncomePin), inCity.filter(a => !a.lowIncomePin)] : [inCity];
    for (const g of groups) ranked.push(...g.sort(byRank).slice(0, Math.round(perCity * g.length / (inCity.length || 1))));
  }
  // ID problems among the ranked go to recruiters. With idFirst this is every applicant; otherwise only the shortlist.
  const idCasesAll = (limits.idFirst ? adults.filter(idBad) : ranked.filter(idBad));
  const review: Review[] = idCasesAll.slice(0, limits.reviewCapacity).map(a => ({ id: a.id, reason: `ID ${a.id_check}` }));
  const deferred = idCasesAll.length - review.length;
  const shortlist = ranked.filter(a => !idBad(a));
  log.push({ step: "plan", text: `${pool.length} ranked, ${shortlist.length} shortlisted with clear ID. ${idCasesAll.length} ID cases for recruiters (${deferred} wait: queue full).` });

  // REFLECT: selection rate per audit group (never used in ranking). Four-fifths rule: lowest/highest >= 0.8.
  const short = new Set(shortlist.map(a => a.id));
  const rates = { women: rate(adults, a => a.gender === "F", short), men: rate(adults, a => a.gender === "M", short),
    lowIncomePin: rate(adults, a => a.lowIncomePin, short), otherPin: rate(adults, a => !a.lowIncomePin, short) };
  const pair = (x: number, y: number) => Math.min(x, y) / Math.max(x, y || 1);
  const ratio = Math.min(pair(rates.women, rates.men), pair(rates.lowIncomePin, rates.otherPin));
  const fairness = { rates, ratio, passed: ratio >= 0.8 };
  log.push({ step: "reflect", text: `Shortlisted ${shortlist.length}. Fairness ratio ${ratio.toFixed(2)} -> ${fairness.passed ? "passed" : "BLOCKED: recruiter lead must sign off"}.` });
  return { applicants: apps.length, vacancies, shortlist, review, deferred, idCases: idCasesAll.length, fairness, log, audit: [] };
}

// ACT behind the gate: an offer goes out only with a named recruiter's approval; a failed fairness gate needs a lead's sign-off.
export function sendOffers(run: HiringRun, recruiter: string | undefined, ids: number[], fairnessSignoffBy?: string) {
  if (!recruiter) throw new Error("Governance rule 3: no offer without a recruiter's approval");
  if (!run.fairness.passed && !fairnessSignoffBy) throw new Error("Fairness gate failed: lead sign-off required");
  const ok = new Set(run.shortlist.map(a => a.id)), sent = ids.filter(id => ok.has(id));
  sent.forEach(id => run.audit.push(`offer ${id} approved by ${recruiter}${fairnessSignoffBy ? ` (fairness signed off by ${fairnessSignoffBy})` : ""}`));
  return sent;
}

// What happens after the offers: who shows up, how many places are filled, how many stay 30 days.
export function simulateOutcome(run: HiringRun, cities = 9, seed = 3, showUp = 0.85) {
  const r = rng(seed), perCityPlaces = Math.ceil(run.vacancies / cities), hires: Applicant[] = [];
  for (let c = 0; c < cities; c++) hires.push(...run.shortlist.filter(a => a.city === c && r() < showUp).slice(0, perCityPlaces));
  const filled = Math.min(run.vacancies, hires.length);
  const stay = hires.length ? hires.reduce((s, a) => s + 1 - quitProb(a), 0) / hires.length : 0;
  return { filled, fillRate: filled / run.vacancies, stay30: stay, stayers: Math.round(filled * stay) };
}

// Baseline from the sheet: recruiters alone fill about 45% by Day 3; last festival 45% quit within 30 days.
export const PERSON_BASELINE = { fillRate: 0.45, stay30: 0.55 };

// How the player's settings change the Round 1 score (points, same scale as the Scenario Sheet).
export function hiringModifiers(run: HiringRun, out: ReturnType<typeof simulateOutcome>, signedOffFailedGate: boolean) {
  const now = { revenue: 0, trust: 0, morale: 0, risk: 0 }, carry = { revenue: 0, trust: 0, morale: 0, risk: 0 };
  if (!run.fairness.passed) signedOffFailedGate ? (now.risk += 3, now.trust -= 2) : (now.revenue -= 2);   // overruling the gate, or losing time holding offers
  if (run.deferred > 0) now.morale -= 1;                                                                   // recruiters swamped by ID cases
  if (out.fillRate < 0.9) now.revenue -= 1;                                                                // under-staffed festival
  const churn = Math.round((out.stay30 - PERSON_BASELINE.stay30) * 10);                                    // each +10 points of retention
  carry.morale += Math.max(-3, Math.min(3, churn));                                                        // felt by store teams in Round 4
  return { now, carry };
}
