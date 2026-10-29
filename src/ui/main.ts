// Round 1 simulator screen. Runs the real engine in the browser; no server needed.
import data from "../data/people-workforce.json";
import { newGame, playRound, netScore, companyScore, type Scenario, type ChoiceId, type Measures } from "../engine/game.ts";
import { makeApplicants, runHiringAgent, simulateOutcome, hiringModifiers, sendOffers, PERSON_BASELINE,
  DEFAULT_HIRING_LIMITS, type HiringLimits } from "../engine/hiringAgent.ts";

const S = data as unknown as Scenario, R1 = S.rounds[0], APPS = makeApplicants();
const st = { choice: "" as "" | ChoiceId, lim: { ...DEFAULT_HIRING_LIMITS } as HiringLimits, decision: "" as "" | "approve" | "signoff" | "hold" };
const $ = (id: string) => document.getElementById(id)!;
const pct = (x: number) => Math.round(x * 100) + "%";
const sgn = (n: number) => (n > 0 ? "+" : "") + n;
const MN: Record<keyof Measures, string> = { revenue: "Revenue", trust: "Trust", morale: "Morale", risk: "Risk" };

function result() {
  let g = newGame(S), extra = "";
  if (st.choice === "agent") {
    const run = runHiringAgent(APPS, 600, 9, st.lim), out = simulateOutcome(run);
    if (st.decision === "approve" || st.decision === "signoff") {
      sendOffers(run, "Recruiter R. Sen", run.shortlist.map(a => a.id), st.decision === "signoff" ? "HR Lead" : undefined);
      g = playRound(S, g, "agent", undefined, false, hiringModifiers(run, out, st.decision === "signoff"));
    } else if (st.decision === "hold") g = playRound(S, g, "agent", undefined, false, hiringModifiers(run, { ...out, fillRate: out.fillRate }, false));
    else return null;
    extra = `<p class="muted">${run.audit.length} offers approved and logged. Filled ${pct(out.fillRate)} of places; ${pct(out.stay30)} expected to stay 30 days (last festival: ${pct(PERSON_BASELINE.stay30)}).</p>`;
  } else g = playRound(S, g, st.choice as ChoiceId);
  return { g, extra };
}

function agentPanel() {
  const run = runHiringAgent(APPS, 600, 9, st.lim), out = simulateOutcome(run), f = run.fairness;
  const bar = (k: string, v: number, ref: number) => `<div class="row"><span>${k}</span><div class="bar"><i style="width:${Math.min(100, v * 600)}%"></i></div><b>${pct(v)}</b></div>`;
  const q = run.idCases > st.lim.reviewCapacity ? "bad" : "ok";
  const gate = f.passed
    ? `<button class="go" onclick="act('decision','approve')">Recruiter approves ${run.shortlist.length} offers</button>`
    : `<p class="bad">Fairness gate blocked: ratio ${f.ratio.toFixed(2)} is below 0.80. Offers cannot go out.</p>
       <button onclick="act('decision','hold')">Hold offers and fix the settings</button>
       <button class="warn" onclick="act('decision','signoff')">HR Lead signs off anyway</button>`;
  return `<div class="card"><h3>The hiring agent</h3>
    <label><input type="checkbox" ${st.lim.balancePins ? "checked" : ""} onchange="act('balancePins',this.checked)"> Reserve places for each pin-code group, in proportion to applicants</label>
    <label><input type="checkbox" ${!st.lim.idFirst ? "checked" : ""} onchange="act('idFirst',!this.checked)"> Check IDs only for the shortlist (not all applicants)</label>
    <label>Shortlist ${st.lim.overbook.toFixed(1)}x the places <input type="range" min="1" max="1.6" step="0.1" value="${st.lim.overbook}" oninput="act('overbook',+this.value)"></label>
    <label>Recruiters on ID review: ${st.lim.reviewCapacity / 20} of 12 <input type="range" min="2" max="12" step="1" value="${st.lim.reviewCapacity / 20}" oninput="act('reviewCapacity',+this.value*20)"></label>
    <h4>What the agent did</h4>
    <div class="funnel"><div><b>${run.applicants.toLocaleString()}</b>applications</div><div><b>${run.shortlist.length}</b>shortlisted, clear ID</div>
      <div class="${q}"><b>${run.idCases}</b>ID cases for people (capacity ${st.lim.reviewCapacity})</div><div><b>${pct(out.fillRate)}</b>places filled</div><div><b>${pct(out.stay30)}</b>stay 30 days</div></div>
    ${run.deferred ? `<p class="bad">${run.deferred} people are waiting in the ID queue, not rejected, because recruiters are full.</p>` : ""}
    <h4>Share shortlisted, by group (for audit only, never used to rank)</h4>
    ${bar("Women", f.rates.women, 0)}${bar("Men", f.rates.men, 0)}${bar("Low-income pin codes", f.rates.lowIncomePin, 0)}${bar("Other pin codes", f.rates.otherPin, 0)}
    <h4>Human gate</h4>${gate}</div>`;
}

function render() {
  const r = st.choice && (st.choice !== "agent" || st.decision) ? result() : null;
  $("app").innerHTML = `
  <header><small>Halcyon Basket · People &amp; Workforce · Round 1 · Days 1 to 3</small><h1>${R1.title}</h1><p>${R1.brief}</p></header>
  <div class="grid">${R1.choices.map(c => `<button class="choice ${st.choice === c.id ? "on" : ""}" onclick="act('choice','${c.id}')">
    <b>${c.label}</b><small>${c.delegation}</small><span>${c.cost} units · net ${sgn(netScore(c.effects))}</span>
    ${c.humanCheckpoint === "No" ? '<em class="bad">No human checkpoint: breaks Governance rule 3</em>' : ""}</button>`).join("")}</div>
  ${st.choice ? `<div class="card"><b>${R1.choices.find(c => c.id === st.choice)!.label}:</b> ${R1.choices.find(c => c.id === st.choice)!.whatItDoes}</div>` : '<p class="muted">Pick how to hire.</p>'}
  ${st.choice === "agent" ? agentPanel() : ""}
  ${r ? `<div class="card res"><h3>Result after Round 1</h3><div class="scores">${(Object.keys(MN) as (keyof Measures)[]).map(k =>
      `<div><small>${MN[k]}</small><b>${r.g.measures[k]}</b><span class="${(k === "risk" ? -1 : 1) * r.g.history[0].deltas[k] >= 0 ? "ok" : "bad"}">${sgn(r.g.history[0].deltas[k])}</span></div>`).join("")}
      <div><small>Company score</small><b>${companyScore(r.g.measures)}</b></div></div>
      ${r.g.history[0].boardSteppedIn ? '<p class="bad">The board steps in.</p>' : ""}${r.extra}
      ${r.g.carry.morale ? `<p class="muted">Carried to Round 4: Morale ${sgn(r.g.carry.morale)} (store teams feel the churn).</p>` : ""}
      ${r.g.history[0].note.map(n => `<p class="muted">${n}</p>`).join("")}
      ${st.decision === "hold" ? '<p class="muted">Offers held: stores stay short-staffed while you fix the settings.</p>' : ""}</div>` : ""}`;
}
(window as any).act = (k: string, v: any) => {
  if (k === "choice") { st.choice = v; st.decision = ""; } else if (k === "decision") st.decision = v;
  else { (st.lim as any)[k] = v; st.decision = ""; }
  render();
};
render();
