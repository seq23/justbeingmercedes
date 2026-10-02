// The browser checks run on demand only (dispatched by a person or by `land` after a large change),
// never on a schedule, never per merge; production is published only through the production gate.
//
// Build first, test in batches (owner, 2 Oct 2026: no scheduled e2e): `validate.yml` is the merge
// gate and may not open a browser (no playwright, no `npm run screenshots`, no bare `npm run
// validate`); `e2e.yml` does, with a ceiling, ONLY on workflow_dispatch; `deploy.yml` publishes
// staging on push to main and production through `scripts/production-gate.mjs`.
//
// SMALL CHANGES SHIP ON THE FAST CHECK (owner decision 2 Oct 2026, asked and answered). Until then
// this file pinned "production only on e2e's success", and a small change sat on staging waiting
// for browser checks nothing would run. The pin is now the stricter pair: deploy.yml still fires
// on e2e and still turns a red run away, AND every production path — the e2e success and the
// dispatch `land <pr>` makes for a small change — goes through the gate (a green e2e on the sha;
// or a reason, the fast check green on the sha, and the checks not known red), whose own
// self-test runs here. What "large" means is defined once, in `land` (seq23/seq-bin); this repo
// points at it and restates no threshold.
//
// A workflow file is a specification code must read, or the shape drifts back the first time
// someone "just adds the browser step to CI". Hard-fails on zero workflow files (Rule 0).
//
//   node scripts/validate-workflows.mjs            # the real files
//   node scripts/validate-workflows.mjs --self-test
import fs from "node:fs";
import { selfTest as gateSelfTest } from "./production-gate.mjs";

const DIR = ".github/workflows";
const GATE = "scripts/production-gate.mjs";
const BROWSER = /playwright|npm run screenshots|npm run validate\s*$/im;

export function triggersIn(yaml) {
  const lines = yaml.split("\n").map((l) => l.replace(/\s#.*$/, ""));
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (start < 0) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") continue;
    if (!line.startsWith(" ")) break;
    const m = line.match(/^  ([A-Za-z_]+):/);
    if (m) out.push(m[1]);
  }
  return out;
}
const stepsOf = (yaml) => yaml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

export function check(files, gateSrc = "") {
  const errors = [];
  if (Object.keys(files).length === 0) return [`${DIR} has no workflow files (Rule 0: nothing to check)`];
  const gate = files["validate.yml"], e2e = files["e2e.yml"], deploy = files["deploy.yml"];
  if (!gate) errors.push("validate.yml (the merge gate) is missing");
  else {
    if (BROWSER.test(stepsOf(gate))) errors.push("validate.yml opens a browser — the page checks belong in e2e.yml, on dispatch, never per merge");
    if (!/npm run validate:static/.test(stepsOf(gate))) errors.push("validate.yml no longer runs the static checks (validate:static)");
    for (const t of ["pull_request", "push"]) if (!triggersIn(gate).includes(t)) errors.push(`validate.yml no longer runs on ${t} — the merge gate must run per PR and on main`);
  }
  if (!e2e) errors.push("e2e.yml is missing — the browser checks run nowhere. On demand means dispatchable, not never");
  else {
    const tr = triggersIn(e2e);
    for (const bad of ["push", "pull_request", "pull_request_target"]) if (tr.includes(bad)) errors.push(`e2e.yml triggers on ${bad} — the browser checks are back on the merge path; only workflow_dispatch`);
    if (tr.includes("schedule")) errors.push("e2e.yml has a schedule trigger — the browser checks run on demand only (a person or `land` after a large change; owner, 2 Oct 2026), never on a timer");
    if (!tr.includes("workflow_dispatch")) errors.push("e2e.yml has no workflow_dispatch trigger");
    if (tr.length !== 1 || tr[0] !== "workflow_dispatch") errors.push(`e2e.yml must trigger on exactly [workflow_dispatch], found [${tr.join(", ")}]`);
    if (!/npm run screenshots/.test(stepsOf(e2e))) errors.push("e2e.yml does not run the browser checks (npm run screenshots) — Rule 0: a dispatch that tests nothing");
    if (!/^\s+timeout-minutes:\s*\d+/m.test(e2e)) errors.push("e2e.yml job has no timeout-minutes — a hung run goes on for six hours");
  }
  if (!deploy) errors.push("deploy.yml is missing — nothing publishes the site");
  else {
    if (!/workflow_run:[\s\S]*workflows:\s*\[e2e\]/.test(deploy)) errors.push("deploy.yml does not fire on the e2e workflow — production would never follow a green e2e run");
    if (!/workflow_run\.conclusion == 'success'/.test(deploy)) errors.push("deploy.yml does not require e2e success — a red e2e run would ship");
    if (!/'staging'/.test(deploy) || !triggersIn(deploy).includes("push")) errors.push("deploy.yml no longer publishes staging on push to main");
    // 2 Oct 2026: every production path passes the gate script, and the workflow restates none of it.
    // (Until then: "deploy.yml's dispatch path checks for a green e2e run on the sha" — that read
    // now lives in the gate, pinned below, next to the fast-check and known-red reads.)
    const steps = stepsOf(deploy);
    if (!/node scripts\/production-gate\.mjs/.test(steps)) errors.push(`deploy.yml does not run ${GATE} — a dispatch could publish production with nothing checked`);
    if (/REFUSED: no successful e2e run/.test(steps)) errors.push(`deploy.yml carries its own inline e2e check — the rule lives in ${GATE}, once`);
    if (!/workflow_dispatch:[\s\S]*inputs:[\s\S]*\n      sha:/.test(steps)) errors.push("deploy.yml dispatch takes no sha — land could not name the commit it judged");
    if (!/workflow_dispatch:[\s\S]*inputs:[\s\S]*\n      reason:/.test(steps)) errors.push("deploy.yml dispatch takes no reason — a small change (land's verdict) could never ship, and production would wait on checks nothing runs");
    if (!/REASON: \$\{\{ github\.event\.inputs\.reason \}\}/.test(steps)) errors.push("deploy.yml does not hand the dispatch reason to the gate (env REASON)");
    if (!/deployments: write/.test(steps) || !/-X POST "repos\/\$\{GITHUB_REPOSITORY\}\/deployments"/.test(steps)) errors.push("deploy.yml does not record a GitHub Deployment — land could not read what production runs");
    if (!/if \[ "\$EVENT" = push \]; then\n\s+echo "target=staging"/.test(steps)) errors.push("deploy.yml no longer sends a push to staging before the gate — a push must never reach production");
  }
  if (!gateSrc) errors.push(`${GATE} is missing — nothing decides what may reach production`);
  else {
    if (!/export function decide\(/.test(gateSrc) || !/KNOWN RED/.test(gateSrc)) errors.push(`${GATE} no longer carries the decision (decide) or the known-red rule`);
    if (!/actions\/workflows\/\$\{E2E_WF\}\/runs\?head_sha=/.test(gateSrc)) errors.push(`${GATE} does not check for a green e2e run on the sha`);
    if (!/actions\/workflows\/\$\{FAST_WF\}\/runs\?head_sha=/.test(gateSrc)) errors.push(`${GATE} does not check the fast check on the sha`);
    if (!/seq23\/seq-bin/.test(gateSrc)) errors.push(`${GATE} no longer points at land (seq23/seq-bin) for what "large" means`);
    if (/LAND_LARGE_|changedFiles|additions \+ deletions/.test(gateSrc)) errors.push(`${GATE} restates land's size rule — one definition, in land`);
  }
  return errors;
}

const loadGate = () => (fs.existsSync(GATE) ? fs.readFileSync(GATE, "utf8") : "");
function load() {
  if (!fs.existsSync(DIR)) return {};
  return Object.fromEntries(fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).map((f) => [f, fs.readFileSync(`${DIR}/${f}`, "utf8")]));
}

if (process.argv.includes("--self-test")) {
  const good = load();
  const gate = loadGate();
  const cases = [
    ["the shipped shape passes", good, 0],
    ["browser back in the gate (screenshots)", { ...good, "validate.yml": good["validate.yml"] + "\n      - run: npm run screenshots\n" }, 1],
    ["browser back in the gate (bare validate)", { ...good, "validate.yml": good["validate.yml"] + "\n      - run: npm run validate\n" }, 1],
    ["e2e.yml on push", { ...good, "e2e.yml": good["e2e.yml"].replace("\non:\n", "\non:\n  push:\n    branches: [main]\n") }, 1],
    ["e2e.yml on pull_request", { ...good, "e2e.yml": good["e2e.yml"].replace("\non:\n", "\non:\n  pull_request:\n") }, 1],
    ["e2e.yml WITH a schedule (nightly cron)", { ...good, "e2e.yml": good["e2e.yml"].replace("\non:\n", "\non:\n  schedule:\n    - cron: \"20 8 * * *\"\n") }, 1],
    ["e2e.yml on a foreign trigger (repository_dispatch)", { ...good, "e2e.yml": good["e2e.yml"].replace("\non:\n", "\non:\n  repository_dispatch:\n") }, 1],
    ["e2e.yml with no workflow_dispatch", { ...good, "e2e.yml": good["e2e.yml"].replace("\non:\n  workflow_dispatch:\n", "\non:\n  schedule:\n    - cron: \"20 8 * * *\"\n") }, 1],
    ["e2e.yml without a ceiling", { ...good, "e2e.yml": good["e2e.yml"].replace(/^\s+timeout-minutes:.*\n/m, "") }, 1],
    ["deploy.yml that ships on any e2e conclusion", { ...good, "deploy.yml": good["deploy.yml"].replace("|| github.event.workflow_run.conclusion == 'success'", "") }, 1],
    ["deploy.yml whose production path skips the gate", { ...good, "deploy.yml": good["deploy.yml"].replace("node scripts/production-gate.mjs", "true") }, 1],
    ["a gate that does not check for a green e2e run on the sha", good, 1, gate.replace("actions/workflows/${E2E_WF}/runs?head_sha=", "x")],
    ["a gate that does not check the fast check on the sha", good, 1, gate.replace("actions/workflows/${FAST_WF}/runs?head_sha=", "x")],
    ["deploy.yml back to its own inline e2e-only check", { ...good, "deploy.yml": good["deploy.yml"].replace("node scripts/production-gate.mjs", 'echo "::error::REFUSED: no successful e2e run on $sha"; node scripts/production-gate.mjs') }, 1],
    ["deploy.yml whose dispatch takes no reason", { ...good, "deploy.yml": good["deploy.yml"].replace(/\n      reason:\n(?:        .*\n)+/, "\n") }, 1],
    ["deploy.yml that drops the reason on the floor", { ...good, "deploy.yml": good["deploy.yml"].replace("REASON: ${{ github.event.inputs.reason }}", 'REASON: ""') }, 1],
    ["deploy.yml that records no deployment", { ...good, "deploy.yml": good["deploy.yml"].replace('-X POST "repos/${GITHUB_REPOSITORY}/deployments"', '-X GET "repos/${GITHUB_REPOSITORY}/deployments"') }, 1],
    ["deploy.yml where a push no longer stops at staging", { ...good, "deploy.yml": good["deploy.yml"].replace('if [ "$EVENT" = push ]; then', 'if [ "$EVENT" = never ]; then') }, 1],
    ["the gate script missing", good, 1, ""],
    ["a gate script with no known-red rule", good, 1, gate.replaceAll("KNOWN RED", "known")],
    ["a gate script that restates land's thresholds", good, 1, gate + "\nconst LAND_LARGE_LINES = 200;\n"],
    ["Rule 0: e2e.yml missing", Object.fromEntries(Object.entries(good).filter(([k]) => k !== "e2e.yml")), 1],
    ["Rule 0: no workflows at all", {}, 1],
  ];
  let wrong = 0;
  for (const [name, files, min, gateSrc = gate] of cases) {
    const e = check(files, gateSrc);
    const ok = min === 0 ? e.length === 0 : e.length >= min;
    if (!ok) { wrong++; console.error(`  FAIL ${name}: ${e.length} error(s) ${e.join(" | ")}`); }
  }
  if (wrong) { console.error(`validate:workflows self-test: ${wrong} case(s) wrong`); process.exit(1); }
  console.log(`validate:workflows self-test: ${cases.length}/${cases.length} fixtures detected correctly`);
  process.exit(0);
}

const errors = check(load(), loadGate());
// The gate's own table (every branch, five broken gates) runs here too: a rule nobody runs is a wish.
const g = gateSelfTest();
if (g.cases === 0 || g.mutants === 0) errors.push(`${GATE} self-test examined nothing (Rule 0)`);
for (const w of g.wrong) errors.push(`${GATE} decides wrongly: ${w}`);
for (const u of g.uncaught) errors.push(`${GATE} self-test would not catch a gate that ${u}`);
if (errors.length) { console.error("validate:workflows FAILED"); for (const e of errors) console.error(`  - ${e}`); process.exit(1); }
console.log(`validate:workflows PASS — merge gate opens no browser; e2e.yml is dispatch only (never a schedule); deploy.yml stages on push and publishes production only through ${GATE} (e2e green on the sha, or a small change on a green fast check with the checks not known red: ${g.cases} cases, ${g.mutants} broken gates caught)`);
