// The Shift-Fill Agent (Round 2 agent moment): Perceive -> Plan -> Act -> Reflect on synthetic staff data.
// Rule-based and seeded, so the same game always shows the same run. No AI service is needed.
import type { AgentLimits } from "./game.ts";

export interface Staff {
  id: number; name: string; store: number; hoursLast7: number; restSinceLast: number;
  extraThisFortnight: number; coldChain: boolean; newJoiner: boolean; nightOk: boolean;
  available: boolean; acceptRate: number; offersToday: number; declines: number;
}
export interface Shift { id: number; store: number; slot: "morning" | "evening" | "night"; coldChain: boolean }
export interface LogLine { step: "perceive" | "plan" | "act" | "reflect" | "escalate"; text: string }
export interface AgentRun {
  filled: number; open: number; fillRate: number; escalated: number; ruleBreaches: number;
  topFifthShare: number; offersSent: number; log: LogLine[];
}

// Small seeded random number generator (mulberry32) so runs are repeatable.
export function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const NAMES = ["A. Khan", "P. Rao", "S. Iyer", "R. Das", "M. Singh", "N. Patel", "K. Nair", "V. Gupta", "T. Joshi", "L. Menon"];
const SHIFT_HOURS = 8, WEEK_CAP = 48, STORES = 180;

export function makeWorld(seed = 7, staffPerStore = 14, openShifts = 410) {
  const r = rng(seed);
  const staff: Staff[] = [];
  for (let s = 0; s < STORES; s++) for (let i = 0; i < staffPerStore; i++) staff.push({
    id: staff.length, name: NAMES[staff.length % NAMES.length], store: s,
    hoursLast7: 24 + Math.floor(r() * 30), restSinceLast: 9 + Math.floor(r() * 22),
    extraThisFortnight: Math.floor(r() * r() * 6), coldChain: r() < 0.3, newJoiner: r() < 0.15,
    nightOk: r() < 0.7, available: r() < 0.8, acceptRate: 0.4 + r() * 0.5, offersToday: 0, declines: 0 });
  const shifts: Shift[] = Array.from({ length: openShifts }, (_, id) => ({
    id, store: Math.floor(r() * STORES), slot: (["morning", "evening", "night"] as const)[Math.floor(r() * 3)],
    coldChain: r() < 0.2 }));
  return { staff, shifts, seed };
}

export function runShiftFillAgent(world: ReturnType<typeof makeWorld>, limits: AgentLimits, maxOffersPerDay = 2): AgentRun {
  const r = rng(world.seed + 1);
  const staff = world.staff.map(s => ({ ...s }));
  const log: LogLine[] = [];
  let filled = 0, escalated = 0, offersSent = 0;

  // PERCEIVE
  log.push({ step: "perceive", text: `${world.shifts.length} open shifts across ${STORES} stores; ${staff.filter(s => s.available).length} staff available.` });

  for (const shift of world.shifts) {
    // PLAN: hard rules first, then fairness, then preference.
    const sameArea = (s: Staff) => s.store === shift.store || (limits.crossStore && Math.abs(s.store - shift.store) === 1);
    const eligible = staff.filter(s => s.available && sameArea(s)
      && s.restSinceLast >= limits.minRest
      && s.hoursLast7 + SHIFT_HOURS <= WEEK_CAP + limits.maxOvertime
      && (!shift.coldChain || s.coldChain)
      && (shift.slot !== "night" || (s.nightOk && !s.newJoiner))
      && s.offersToday < maxOffersPerDay && s.declines < 3)
      .sort((a, b) => a.extraThisFortnight - b.extraThisFortnight || b.acceptRate - a.acceptRate);

    // ACT: offer in waves of 3 until someone accepts.
    let taken: Staff | undefined;
    for (let wave = 0; wave < 3 && !taken; wave++) {
      for (const s of eligible.slice(wave * 3, wave * 3 + 3)) {
        s.offersToday++; offersSent++;
        if (!taken && r() < s.acceptRate) taken = s; else if (!taken) s.declines++;
      }
    }
    if (taken) {
      filled++; taken.hoursLast7 += SHIFT_HOURS; taken.extraThisFortnight++; taken.restSinceLast = 0;
      if (filled <= 5) log.push({ step: "act", text: `Store ${shift.store + 1} ${shift.slot} shift -> ${taken.name}: ${taken.extraThisFortnight} extra shift(s) this fortnight${shift.slot === "night" ? ", transport booked" : ""}.` });
    } else {
      escalated++;
      if (escalated <= 3) log.push({ step: "escalate", text: `Store ${shift.store + 1} ${shift.slot} shift: no eligible person accepted. Sent to the store manager.` });
    }
  }

  // REFLECT: rule check and fairness.
  const ruleBreaches = staff.filter(s => s.hoursLast7 > WEEK_CAP + limits.maxOvertime).length;
  const extras = staff.map(s => s.extraThisFortnight).sort((a, b) => b - a);
  const total = extras.reduce((a, b) => a + b, 0);
  const topFifthShare = total ? extras.slice(0, Math.ceil(extras.length / 5)).reduce((a, b) => a + b, 0) / total : 0;
  const fillRate = filled / world.shifts.length;
  log.push({ step: "reflect", text: `Filled ${filled} of ${world.shifts.length} (${Math.round(fillRate * 100)}%). Rule breaches: ${ruleBreaches}. Top 20% of staff hold ${Math.round(topFifthShare * 100)}% of extra shifts. ${escalated} shifts sent to managers.` });
  return { filled, open: world.shifts.length, fillRate, escalated, ruleBreaches, topFifthShare, offersSent, log };
}
