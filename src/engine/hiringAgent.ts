// Round 1 hiring agent: Perceive -> Plan -> Act -> Reflect, with human gates (Governance rule 3).
// The agent may shortlist and book interviews. It can never reject on judgement or send an offer:
// anything uncertain goes to a recruiter queue, and offers need a named recruiter's approval.
import { rng } from "./shiftFillAgent.ts";

export interface Applicant {
  id: number; city: number; gender: "F" | "M"; lowIncomePin: boolean; age: number;
  gapMonths: number; distanceKm: number; availableDay: number; id_check: "ok" | "mismatch" | "unreadable";
}
export interface HiringLimits { overbook: number; reviewCapacity: number; balancePins: boolean }
export const DEFAULT_HIRING_LIMITS: HiringLimits = { overbook: 1.3, reviewCapacity: 240, balancePins: true }; // 12 recruiters x 20 exceptions/day
export interface Review { id: number; reason: string }
export interface Fairness { rates: Record<string, number>; ratio: number; passed: boolean }
export interface HiringRun {
  applicants: number; vacancies: number; shortlist: Applicant[]; review: Review[]; deferred: number;
  fairness: Fairness; log: { step: string; text: string }[]; audit: string[];
}

export function makeApplicants(seed = 11, n = 8400, cities = 9) {
  const r = rng(seed);
  return Array.from({ length: n }, (_, id): Applicant => {
    const lowIncomePin = r() < 0.4, gender = r() < 0.45 ? "F" : "M";
    // Women returning to work and low-income pin codes are more likely to have gaps / longer commutes: the bias trap.
    return { id, city: Math.floor(r() * cities), gender, lowIncomePin, age: 16 + Math.floor(r() * 30),
      gapMonths: Math.floor(r() * r() * 30 * (gender === "F" ? 1.8 : 1)), distanceKm: Math.round(r() * (lowIncomePin ? 30 : 18)),
      availableDay: 1 + Math.floor(r() * 5), id_check: r() < 0.06 ? "mismatch" : r() < 0.05 ? "unreadable" : "ok" };
  });
}

const rate = (all: Applicant[], pick: (a: Applicant) => boolean, short: Set<number>) => {
  const g = all.filter(pick); return g.length ? g.filter(a => short.has(a.id)).length / g.length : 0;
};

export function runHiringAgent(apps: Applicant[], vacancies = 600, cities = 9, limits = DEFAULT_HIRING_LIMITS): HiringRun {
  const log: HiringRun["log"] = [], review: Review[] = [];
  log.push({ step: "perceive", text: `${apps.length} applications, ${vacancies} places across ${cities} cities.` });

  // PLAN: only objective rules reject. Gap and distance never exclude; they only affect rank (distance) or nothing (gap).
  const eligible: Applicant[] = [];
  for (const a of apps) {
    if (a.age < 18) continue;                                   // legal minimum: the one auto-reject
    if (a.id_check !== "ok") { review.push({ id: a.id, reason: `ID ${a.id_check}` }); continue; }
    eligible.push(a);
  }
  const queue = review.slice(0, limits.reviewCapacity), deferred = review.length - queue.length; // backpressure
  const perCity = Math.ceil(vacancies / cities * limits.overbook), shortlist: Applicant[] = [];
  const byRank = (a: Applicant, b: Applicant) => a.availableDay - b.availableDay || a.distanceKm - b.distanceKm;
  for (let c = 0; c < cities; c++) {
    const pool = eligible.filter(a => a.city === c);
    // Ranking by distance alone shuts out far-away (poorer) pin codes; balancePins gives each group a quota in proportion to its applicants.
    const groups = limits.balancePins ? [pool.filter(a => a.lowIncomePin), pool.filter(a => !a.lowIncomePin)] : [pool];
    for (const g of groups) shortlist.push(...g.sort(byRank).slice(0, Math.round(perCity * g.length / (pool.length || 1))));
  }
  log.push({ step: "plan", text: `${eligible.length} eligible, ${queue.length} sent to recruiters for ID review (${deferred} deferred: queue full).` });

  // REFLECT: selection rate per audit group (never used in ranking). Four-fifths rule: lowest/highest >= 0.8.
  const short = new Set(shortlist.map(a => a.id));
  const rates = { women: rate(eligible, a => a.gender === "F", short), men: rate(eligible, a => a.gender === "M", short),
    lowIncomePin: rate(eligible, a => a.lowIncomePin, short), otherPin: rate(eligible, a => !a.lowIncomePin, short) };
  const pair = (x: number, y: number) => Math.min(x, y) / Math.max(x, y || 1);
  const ratio = Math.min(pair(rates.women, rates.men), pair(rates.lowIncomePin, rates.otherPin));
  const fairness = { rates, ratio, passed: ratio >= 0.8 };
  log.push({ step: "reflect", text: `Shortlisted ${shortlist.length}. Fairness ratio ${ratio.toFixed(2)} -> ${fairness.passed ? "passed" : "BLOCKED: recruiter lead must sign off"}.` });
  return { applicants: apps.length, vacancies, shortlist, review: queue, deferred, fairness, log, audit: [] };
}

// ACT behind the gate: an offer goes out only with a named recruiter's approval; a failed fairness gate needs a lead's sign-off.
export function sendOffers(run: HiringRun, recruiter: string | undefined, ids: number[], fairnessSignoffBy?: string) {
  if (!recruiter) throw new Error("Governance rule 3: no offer without a recruiter's approval");
  if (!run.fairness.passed && !fairnessSignoffBy) throw new Error("Fairness gate failed: lead sign-off required");
  const ok = new Set(run.shortlist.map(a => a.id)), sent = ids.filter(id => ok.has(id));
  sent.forEach(id => run.audit.push(`offer ${id} approved by ${recruiter}${fairnessSignoffBy ? ` (fairness signed off by ${fairnessSignoffBy})` : ""}`));
  return sent;
}
