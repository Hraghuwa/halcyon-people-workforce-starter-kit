"""Export the filled Scenario Sheet to src/data/people-workforce.json.

Run from the project folder:  python scripts/export_sheet.py Halcyon_Scenario_Sheet_People_and_Workforce.xlsx
Needs:  pip install openpyxl
Re-run it every time the team changes the Scenario Sheet, so the game and the sheet never disagree.
"""
import json, sys
import openpyxl

SHEET = sys.argv[1] if len(sys.argv) > 1 else "Halcyon_Scenario_Sheet_People_and_Workforce.xlsx"
OUT = "src/data/people-workforce.json"
wb = openpyxl.load_workbook(SHEET, data_only=True)
sit, cho, shared = wb["2 Situations"], wb["3 Choices"], wb["Shared numbers"]

IDS = {"A person": "person", "Gen AI": "genai", "AI agent": "agent", "Agentic AI": "agentic"}
# Staffing coverage % each choice publishes to other modules (illustrative; agree with the integration group).
COVERAGE = {1: [45, 60, 90, 100], 2: [61, 73, 91, 98], 3: [92, 90, 88, 85], 4: [85, 90, 88, 80]}

def zero(**k):
    return {m: k.get(m, 0) for m in ["revenue", "trust", "morale", "risk"]}

# Optional surprise cards proposed by the team (not part of the Scenario Sheet).
SURPRISES = {
    1: ("A rejected applicant posts online that a bot screened her out for a gap in her work history.",
        {"agent": {"now": zero(risk=2)}, "agentic": {"now": zero(trust=-2, risk=5)}}),
    2: ("The staff app's availability data turns out to be a day out of date.",
        {"agent": {"carry": zero(morale=-3, risk=4)}, "agentic": {"now": zero(morale=-3, risk=3)}}),
    3: ("Pickers file a group grievance over the warnings.",
        {"genai": {"now": zero(risk=1)}, "agent": {"now": zero(morale=-1, risk=3)}, "agentic": {"now": zero(morale=-2, risk=5)}}),
    4: ("At a town hall, staff ask whether the pulse survey was really anonymous.",
        {"agent": {"now": zero(morale=-3, risk=2)}, "agentic": {"now": zero(morale=-2, risk=2)}}),
}

def num(label):
    for row in shared.iter_rows(values_only=True):
        if row[0] and str(row[0]).startswith(label):
            return row[1]
    raise KeyError(label)

rounds = []
for i in range(4):
    rn, r = i + 1, 5 + i
    choices = []
    for j in range(4):
        cr = 5 + 4 * i + j
        g = lambda col: cho[f"{col}{cr}"].value
        choices.append({
            "id": IDS[g("B")], "label": g("B"), "delegation": g("C"), "whatItDoes": g("D"),
            "cost": g("E"), "costIfWrong": g("F"), "dataPoints": g("G"), "humanCheckpoint": g("H"),
            "effects": {"revenue": g("I"), "trust": g("J"), "morale": g("K"), "risk": g("L")},
            "why": g("M"), "staffingCoverage": COVERAGE[rn][j],
        })
    text, effects = SURPRISES[rn]
    rounds.append({
        "round": rn, "days": sit[f"B{r}"].value, "title": sit[f"C{r}"].value, "brief": sit[f"D{r}"].value,
        "spot": {"signal": sit[f"E{r}"].value, "pattern": sit[f"F{r}"].value, "orchestrate": sit[f"G{r}"].value,
                 "testTrust": sit[f"H{r}"].value, "verdict": sit[f"I{r}"].value},
        "personStaysInCharge": sit[f"J{r}"].value, "choices": choices,
        "surprise": {"text": text, "note": "Optional. Proposed by the team; not in the Scenario Sheet.", "effects": effects},
    })

data = {
    "module": "people-workforce", "function": "People and Workforce",
    "shared": {
        "start": {"revenue": num("Revenue"), "trust": num("Customer Trust"), "morale": num("Employee Morale"), "risk": num("Risk Exposure")},
        "boardRule": {"trustBelow": num("Board steps in if Trust"), "moraleBelow": num("Board steps in if Trust"), "riskAbove": num("Board steps in if Risk")},
        "teamBudgetUnits": round(num("Your team's share"), 1),
        "dataAllowancePoints": num("Customer-data allowance"),
    },
    "rounds": rounds,
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
print(f"Wrote {OUT}: {len(rounds)} rounds, {sum(len(r['choices']) for r in rounds)} choices")
