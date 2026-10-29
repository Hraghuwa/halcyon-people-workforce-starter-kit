// Round 1 simulator screen. Runs the real engine in the browser; no server needed.
// Flow: choose who hires -> set the agent's rules (see consequences live) -> pass three human gates -> result.
import data from "../data/people-workforce.json";
import { newGame, playRound, netScore, companyScore, availability, type Scenario, type ChoiceId, type Measures } from "../engine/game.ts";
import { makeApplicants, runHiringAgent, simulateOutcome, hiringModifiers, sendOffers, PERSON_BASELINE,
  DEFAULT_HIRING_LIMITS, type HiringLimits, type HiringRun } from "../engine/hiringAgent.ts";

const S = data as unknown as Scenario, R1 = S.rounds[0], APPS = makeApplicants(), START = S.shared.start;
type Decision = "" | "approve" | "signoff" | "hold";
const st = { choice: "" as "" | ChoiceId, lim: { ...DEFAULT_HIRING_LIMITS } as HiringLimits, decision: "" as Decision,
  confirm: false, demo: false, seen: new Set<string>(), prev: { ...START } as Measures };
const $ = (id: string) => document.getElementById(id)!;
const pct = (x: number) => Math.round(x * 100) + "%";
const sgn = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n);
const MK = ["revenue", "trust", "morale", "risk"] as const;
const MN: Record<keyof Measures, string> = { revenue: "Revenue", trust: "Customer trust", morale: "Staff morale", risk: "Risk" };
const enter = (k: string) => (st.seen.has(k) ? "" : (st.seen.add(k), "enter"));

type Ev = { run: HiringRun; out: ReturnType<typeof simulateOutcome> };
const cache = new Map<string, Ev>();
function evalLim(l: HiringLimits): Ev {
  const k = JSON.stringify(l); let v = cache.get(k);
  if (!v) { const run = runHiringAgent(APPS, 600, 9, l); v = { run, out: simulateOutcome(run) }; cache.set(k, v); }
  return v;
}
const peek = (patch: Partial<HiringLimits>) => evalLim({ ...st.lim, ...patch });

function outcome(choice: ChoiceId, decision: Decision) {
  const base = newGame(S);
  if (choice !== "agent") return { g: playRound(S, base, choice) };
  const { run, out } = evalLim(st.lim);
  const d = decision || (run.fairness.passed ? "approve" : "hold"); // projection: the safe path
  const sent = d === "hold" ? 0 : sendOffers({ ...run, audit: [] }, "Recruiter R. Sen", run.shortlist.map(a => a.id), d === "signoff" ? "HR Lead" : undefined).length;
  const mods = hiringModifiers(run, out, d === "signoff");
  return { g: playRound(S, base, "agent", undefined, false, mods), run, out, d, mods, sent };
}

// ---------- pieces ----------
function scoreboard() {
  const o = st.choice ? outcome(st.choice, st.decision) : null, m = o ? o.g.measures : START;
  const committed = st.choice && (st.choice !== "agent" || st.decision);
  const c = st.choice ? R1.choices.find(x => x.id === st.choice)! : null;
  const meters = MK.map(k => {
    const d = o ? o.g.history[0].deltas[k] : 0, good = (k === "risk" ? -d : d) >= 0;
    return `<div class="meter"><div class="mh"><span>${MN[k]}</span><b class="num">${m[k]}</b>${o ? `<i class="chip ${d === 0 ? "" : good ? "ok" : "bad"}">${sgn(d)}</i>` : ""}</div>
      <div class="track" role="img" aria-label="${MN[k]} ${m[k]} of 100, started at ${START[k]}"><span class="fill ${k === "risk" ? "risk" : ""} ${committed ? "" : "ghost"}" style="--from:${st.prev[k] / 100};--to:${m[k] / 100}"></span><span class="start" style="left:${START[k]}%"></span></div></div>`;
  }).join("");
  const over = c && c.cost > S.shared.teamBudgetUnits + 1e-9;
  return `<aside class="board" aria-label="Scoreboard"><h2>${committed ? "Scoreboard" : o ? "Projected scoreboard" : "Scoreboard"}</h2>
    ${meters}
    <div class="score"><small>Company score</small><b class="num">${o ? companyScore(o.g.measures) : companyScore(START)}</b></div>
    <div class="budget"><div class="mh"><span>AI budget</span><b class="num">${c ? c.cost : 0} / ${S.shared.teamBudgetUnits}</b></div>
      <div class="track"><span class="fill ${over ? "risk" : ""}" style="--from:0;--to:${Math.min(1, (c ? c.cost : 0) / S.shared.teamBudgetUnits)}"></span></div>
      ${over ? '<p class="hint bad">Over your team’s share.</p>' : ""}</div>
    <p class="hint">Ticks mark where each score started. The board steps in if Trust or Morale falls below ${S.shared.boardRule.trustBelow}, or Risk rises above ${S.shared.boardRule.riskAbove}.</p></aside>`;
}

function choices() {
  const av = availability(S, newGame(S), st.demo ? 999 : S.shared.teamBudgetUnits);
  return `<section class="step"><h2><span class="n">1</span>Who does the hiring?</h2>
  <div class="cards" role="radiogroup" aria-label="Hiring choice">${av.map(({ choice: c, net, locked }) => {
    const e = c.effects, no = c.humanCheckpoint === "No";
    return `<label class="choice ${st.choice === c.id ? "on" : ""} ${locked ? "locked" : ""}">
      <input type="radio" name="choice" data-k="choice-${c.id}" ${st.choice === c.id ? "checked" : ""} ${locked ? "disabled" : ""} onchange="act('choice','${c.id}')">
      <b>${c.label}</b><small>${c.delegation}</small>
      <span class="fx">${MK.map(k => `<i class="chip ${e[k] === 0 ? "" : (k === "risk" ? -e[k] : e[k]) > 0 ? "ok" : "bad"}" title="${MN[k]}">${({ revenue: "Rev", trust: "Trust", morale: "Morale", risk: "Risk" })[k]} ${sgn(e[k])}</i>`).join("")}</span>
      <span class="meta"><span class="gate-tag ${no ? "none" : c.id === "person" ? "" : "has"}">${no ? "No human checkpoint" : c.id === "person" ? "Human only" : "Human checkpoint"}</span><span class="num">${c.cost} units</span></span>
      ${locked ? `<em class="bad">${locked}</em>` : ""}</label>`;
  }).join("")}</div></section>`;
}

function seg(k: keyof HiringLimits, opts: { v: number; label: string; sub: string }[]) {
  return `<div class="seg" role="radiogroup">${opts.map(o => `<button type="button" role="radio" aria-checked="${st.lim[k] === o.v}" data-k="${k}-${o.v}" onclick="act('${k}',${o.v})"><b>${o.label}</b><small>${o.sub}</small></button>`).join("")}</div>`;
}
function lever(k: "balancePins" | "idLate", title: string, why: string, on: boolean, alt: Ev) {
  const f = alt.run.fairness;
  return `<div class="lever"><div class="lh"><div><b>${title}</b><p>${why}</p></div>
    <button type="button" class="sw" role="switch" aria-checked="${on}" aria-label="${title}" data-k="${k}" onclick="act('${k}',${!on})"><span></span></button></div>
    <p class="if">If you turned it ${on ? "off" : "on"}: fairness <b class="${f.passed ? "ok" : "bad"}">${f.ratio.toFixed(2)}</b>, ID cases for recruiters <b>${alt.run.idCases}</b>, people staying 30 days <b>${pct(alt.out.stay30)}</b></p></div>`;
}
function rules() {
  const cap = st.lim.reviewCapacity;
  return `<section class="step ${enter("rules")}"><h2><span class="n">2</span>Set the agent’s rules</h2>
  <p class="lead">The agent screens all 8,400 applications. You decide how it behaves. Each switch shows what it would change.</p>
  ${lever("balancePins", "Reserve places for every pin-code group", "Without this the agent favours people who live near stores, and shuts out poorer areas.", st.lim.balancePins, peek({ balancePins: !st.lim.balancePins }))}
  ${lever("idLate", "Check IDs only for the shortlist", "Rank first, then check IDs for likely hires. Checking all 8,400 first swamps recruiters.", !st.lim.idFirst, peek({ idFirst: !st.lim.idFirst }))}
  <div class="lever"><div class="lh"><div><b>Shortlist size</b><p>Extra names cover people who do not show up.</p></div></div>
    ${seg("overbook", [1, 1.3, 1.6].map(v => ({ v, label: v + "×", sub: "fill " + pct(peek({ overbook: v }).out.fillRate) })))}</div>
  <div class="lever"><div class="lh"><div><b>Recruiters on ID review</b><p>Each reviews about 20 unclear IDs a day.</p></div></div>
    ${seg("reviewCapacity", [80, 160, 240].map(v => ({ v, label: v / 20 + " of 12", sub: peek({ reviewCapacity: v }).run.deferred ? peek({ reviewCapacity: v }).run.deferred + " waiting" : "no queue" })))}</div></section>`;
}

function gates() {
  const { run, out } = evalLim(st.lim), f = run.fairness, cap = st.lim.reviewCapacity, over = run.idCases > cap;
  const g1 = `<div class="gate"><div class="gh"><span class="desk">Gate 1</span><b>ID review</b><i class="chip ${over ? "bad" : "ok"}">${over ? run.deferred + " waiting" : "Cleared"}</i></div>
    <p>Recruiters check IDs the agent cannot read or match. Nobody is rejected for this; they wait for a person.</p>
    <div class="track" role="img" aria-label="${run.idCases} ID cases, capacity ${cap}"><span class="fill ${over ? "risk" : ""}" style="--from:0;--to:${Math.min(1, run.idCases / cap)}"></span></div><small class="num">${run.idCases} cases · capacity ${cap} a day</small></div>`;
  const groups: [string, number][] = [["Women", f.rates.women], ["Men", f.rates.men], ["Low-income pin codes", f.rates.lowIncomePin], ["Other pin codes", f.rates.otherPin]];
  const mx = Math.max(...groups.map(x => x[1]), 0.01);
  const g2 = `<div class="gate"><div class="gh"><span class="desk">Gate 2</span><b>Fairness check</b><i class="chip ${f.passed ? "ok" : "bad"}">${f.passed ? "Cleared" : "Blocked"}</i></div>
    <p>Share of applicants shortlisted, by group. The lowest group must reach 80% of the highest. Groups are checked, never used to rank.</p>
    ${groups.map(([n, v]) => `<div class="grp"><span>${n}</span><div class="track"><span class="fill" style="--from:0;--to:${v / mx}"></span></div><b class="num">${pct(v)}</b></div>`).join("")}
    <small class="num">Ratio ${f.ratio.toFixed(2)} (needs 0.80)</small></div>`;
  let act = "";
  if (st.decision === "approve" || st.decision === "signoff") {
    act = `<div class="offer"><div class="sheet"><b>${run.shortlist.length} offer letters</b><small>${pct(out.fillRate)} of places filled</small></div>
      <div class="stamp ${enter("stamp" + st.decision)}" role="img" aria-label="Approved">APPROVED<small>R. Sen · Recruiter${st.decision === "signoff" ? " · HR Lead override" : ""}</small></div></div>`;
  } else if (st.decision === "hold") act = `<p class="hint">Offers held. Stores stay short-staffed while you change the rules above.</p>`;
  else if (f.passed) act = `<button class="btn primary" data-k="approve" onclick="act('decision','approve')">Approve ${run.shortlist.length} offers as Recruiter R. Sen</button><p class="hint">Governance rule 3: no offer leaves without a person’s approval.</p>`;
  else if (!st.confirm) act = `<p class="bad"><b>Offers are blocked.</b> Fix the rules above, or overrule.</p>
    <button class="btn primary" data-k="hold" onclick="act('decision','hold')">Hold offers and fix the rules</button>
    <button class="btn danger" data-k="overrule" onclick="act('confirm',true)">HR Lead overrules…</button>`;
  else act = `<div class="confirm"><b>Overrule the fairness gate?</b><p>Offers go out although a group is under-selected. This adds Risk 3 and costs 2 Trust, and the decision is logged under the HR Lead’s name.</p>
    <button class="btn" data-k="cancel" onclick="act('confirm',false)">Cancel</button><button class="btn danger" data-k="signoff" onclick="act('decision','signoff')">Yes, overrule</button></div>`;
  return `<section class="step ${enter("gates")}"><h2><span class="n">3</span>Pass the human gates</h2><div class="gates">${g1}${g2}
    <div class="gate wide"><div class="gh"><span class="desk">Gate 3</span><b>Offer approval</b></div>${act}</div></div></section>`;
}

function result() {
  const o = outcome(st.choice as ChoiceId, st.decision), h = o.g.history[0], c = R1.choices.find(x => x.id === st.choice)!;
  const why: string[] = [c.why];
  if (o.run && o.out) {
    if (!o.run.fairness.passed) why.push(o.d === "signoff" ? "You overruled a failed fairness gate: Risk +3, Trust −2." : "Offers were held while fairness failed: Revenue −2.");
    if (o.run.deferred) why.push(`${o.run.deferred} ID cases had no recruiter free: Morale −1.`);
    if (o.out.fillRate < 0.9) why.push(`Only ${pct(o.out.fillRate)} of places filled: Revenue −1.`);
    why.push(`${pct(o.out.stay30)} expected to stay 30 days (last festival ${pct(PERSON_BASELINE.stay30)}): ${sgn(o.g.carry.morale)} Morale carried to Round 4.`);
  }
  const nets = R1.choices.map(x => ({ id: x.id, label: x.label, n: x.id === st.choice ? netScore(h.deltas) : netScore(outcome(x.id, "").g.history[0].deltas) }));
  const talk = `We chose "${c.label}". Result: Revenue ${sgn(h.deltas.revenue)}, Trust ${sgn(h.deltas.trust)}, Morale ${sgn(h.deltas.morale)}, Risk ${sgn(h.deltas.risk)}; company score ${companyScore(o.g.measures)}.` +
    (o.run ? ` The agent screened 8,400 applications, but people made every decision: ID review, a fairness check (ratio ${o.run.fairness.ratio.toFixed(2)}) and approval of each offer${o.d === "signoff" ? ", and our HR lead overruled one blocked gate, which cost us Risk" : ""}.` : c.id === "agentic" ? " There was no human checkpoint, which breaks Governance rule 3." : "");
  return `<section class="step result ${enter("res")}" aria-live="polite"><h2 tabindex="-1" data-k="result"><span class="n">${st.choice === "agent" ? 4 : 2}</span>What happened</h2>
    ${h.boardSteppedIn ? '<p class="bad"><b>The board steps in.</b></p>' : ""}
    <ul class="why">${why.map(w => `<li>${w}</li>`).join("")}</ul>
    <h3>How the four choices compare (net points)</h3>
    <div class="cmp">${nets.map(x => `<div class="${x.id === st.choice ? "me" : ""}"><span>${x.label}</span><div class="track"><span class="fill ${x.n < 0 ? "risk" : ""}" style="--from:0;--to:${Math.min(1, Math.abs(x.n) / 12)}"></span></div><b class="num">${sgn(x.n)}</b></div>`).join("")}</div>
    <h3>Say it in one breath</h3><p class="talk" id="talk">${talk}</p>
    <button class="btn" data-k="copy" onclick="act('copy')">Copy talking points</button><button class="btn" data-k="again" onclick="act('reset')">Start over</button></section>`;
}

function render() {
  const fk = (document.activeElement as HTMLElement | null)?.dataset?.k;
  const showRules = st.choice === "agent", showRes = st.choice && (st.choice !== "agent" || st.decision) && !(st.decision === "hold");
  $("app").innerHTML = `<header class="top"><div><small>Halcyon Basket · People &amp; Workforce</small><h1>${R1.title}</h1></div>
    <label class="demo"><input type="checkbox" data-k="demo" ${st.demo ? "checked" : ""} onchange="act('demo',this.checked)"> Demo: ignore AI budget</label></header>
    <div class="layout"><main>
    <section class="brief"><p>${R1.brief.split(" Data shown")[0]}</p><div class="facts"><span><b class="num">8,400</b>applications</span><span><b class="num">12</b>recruiters</span><span><b class="num">600</b>places by Day 4</span><span><b class="num">45%</b>quit last festival</span></div></section>
    ${choices()}${st.choice ? "" : '<p class="empty">Pick an option to see its projected effect on the scoreboard.</p>'}
    ${showRules ? rules() + gates() : ""}${showRes ? result() : ""}</main>${scoreboard()}</div>`;
  MK.forEach(k => { const o = st.choice ? outcome(st.choice, st.decision) : null; st.prev[k] = o ? o.g.measures[k] : START[k]; });
  if (fk) (document.querySelector(`[data-k="${fk}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
}

(window as any).act = (k: string, v?: any) => {
  if (k === "choice") { st.choice = v; st.decision = ""; st.confirm = false; st.seen.clear(); }
  else if (k === "decision") { st.decision = v; st.confirm = false; render(); (document.querySelector('[data-k="result"]') as HTMLElement | null)?.focus(); return; }
  else if (k === "confirm") st.confirm = v;
  else if (k === "demo") st.demo = v;
  else if (k === "reset") { st.choice = ""; st.decision = ""; st.confirm = false; st.seen.clear(); st.prev = { ...START }; st.lim = { ...DEFAULT_HIRING_LIMITS }; window.scrollTo({ top: 0 }); }
  else if (k === "copy") { const t = $("talk").innerText; (navigator.clipboard?.writeText(t) ?? Promise.reject()).then(() => alert("Copied"), () => alert("Select the text above and copy it.")); return; }
  else { st.lim = { ...st.lim, [k === "idLate" ? "idFirst" : k]: k === "idLate" ? !v : v }; st.decision = ""; st.confirm = false; st.seen.delete("stampapprove"); st.seen.delete("stampsignoff"); }
  render();
};
render();
