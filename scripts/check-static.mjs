import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const fail = message => {
  console.error(`static-check: ${message}`);
  process.exitCode = 1;
};
const normalizeLocal = value => String(value || "").split("#")[0].split("?")[0].replace(/^\.\//, "");
const exists = file => fs.existsSync(path.join(root, normalizeLocal(file)));

function jsFiles(dir = "js") {
  const full = path.join(root, dir);
  return fs.readdirSync(full, { withFileTypes: true }).flatMap(entry => {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(relative);
    return entry.isFile() && entry.name.endsWith(".js") ? [relative] : [];
  });
}

const indexHtml = read("index.html");
const serviceWorker = read("sw.js");
const appCore = read("js/core/app.js");

const localRefs = [...indexHtml.matchAll(/\b(?:href|src)="([^"]+)"/g)]
  .map(match => match[1])
  .filter(value => value && !/^(?:https?:|data:|#)/i.test(value));

for (const ref of localRefs) {
  if (!exists(ref)) fail(`index.html references missing local asset: ${ref}`);
}

for (const file of jsFiles()) {
  const source = read(file);
  const dynamicRefs = [
    ...source.matchAll(/\.src\s*=\s*["']([^"']+\.js(?:[?#][^"']*)?)["']/g),
    ...source.matchAll(/\.setAttribute\(\s*["']src["']\s*,\s*["']([^"']+\.js(?:[?#][^"']*)?)["']\s*\)/g)
  ].map(match => match[1]);

  for (const ref of dynamicRefs) {
    if (/^(?:https?:|data:|\/\/|#)/i.test(ref)) continue;
    if (!exists(ref)) fail(`${file} dynamically references missing local script: ${ref}`);
  }
}

const shellMatch = serviceWorker.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
if (!shellMatch) {
  fail("sw.js does not expose a parseable SHELL_ASSETS array");
} else {
  const shellAssets = [...shellMatch[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  const shellSet = new Set(shellAssets.map(normalizeLocal));

  for (const asset of shellAssets) {
    const normalized = normalizeLocal(asset);
    if (!normalized) continue;
    if (!exists(asset)) fail(`SHELL_ASSETS contains missing file: ${asset}`);
  }

  for (const ref of localRefs) {
    const normalized = normalizeLocal(ref);
    if (!/\.(?:css|js|webmanifest|png)$/i.test(normalized)) continue;
    if (!shellSet.has(normalized)) fail(`index asset is missing from SHELL_ASSETS: ${ref}`);
  }

  const pageScriptsMatch = appCore.match(/const PAGE_SCRIPTS = Object\.freeze\(\{([\s\S]*?)\}\);/);
  if (!pageScriptsMatch) {
    fail("app.js does not expose a parseable PAGE_SCRIPTS map");
  } else {
    const pageScripts = [...pageScriptsMatch[1].matchAll(/"([^"]+\.js)"/g)].map(match => match[1]);
    for (const script of pageScripts) {
      if (!exists(script)) fail(`PAGE_SCRIPTS references missing file: ${script}`);
      if (!shellSet.has(normalizeLocal(script))) fail(`PAGE_SCRIPTS asset is missing from SHELL_ASSETS: ${script}`);
    }
    for (const required of [
      "js/training/candidate-workout.js",
      "js/training/planning-core.js",
      "js/training/planning.js",
      "js/sync/assistant-proposals-core.js"
    ]) {
      if (!pageScripts.includes(required)) fail(`plan page dependency is missing from PAGE_SCRIPTS: ${required}`);
    }
  }

  for (const required of [
    "js/training/planned-workout.js",
    "js/training/candidate-workout.js",
    "js/training/planning-core.js",
    "js/sync/github-private-repo.js",
    "js/sync/sync-core.js",
    "js/sync/assistant-proposals-core.js"
  ]) {
    if (!shellSet.has(required)) fail(`architecture module is missing from SHELL_ASSETS: ${required}`);
  }
}

if (/\?v=\d+/i.test(indexHtml) || /\?v=\d+/i.test(serviceWorker)) {
  fail("per-file ?v= resource versions must not return; shell cache version is the release boundary");
}

for (const deprecated of [
  "js/training/planning-v165.js",
  "js/sync/sync-v165.js",
  "js/sync/assistant-proposals-v165.js",
  "js/training/training-next-workout.js"
]) {
  if (exists(deprecated)) fail(`deprecated transition module must stay removed: ${deprecated}`);
}

if (!exists("ARCHITECTURE.md")) fail("ARCHITECTURE.md is required");

const motionJs = read("js/training/training-motion.js");
const motionCss = read("assets/css/training-motion.css");
if (!motionJs.includes("overviewTargetY = 0;")) fail("protected overviewTargetY = 0 regression guard failed");
if (!motionCss.includes("--training-overview-offset:68px;")) fail("protected --training-overview-offset:68px regression guard failed");

const candidateWorkout = read("js/training/candidate-workout.js");
const planningEntry = read("js/training/planning.js");
const planningCore = read("js/training/planning-core.js");
const plannedWorkout = read("js/training/planned-workout.js");
const githubPrivateRepo = read("js/sync/github-private-repo.js");
const syncRemote = read("js/sync/sync-remote.js");
const syncEntry = read("js/sync/sync.js");
const syncCore = read("js/sync/sync-core.js");
const assistantEntry = read("js/sync/assistant-proposals.js");
const assistantCore = read("js/sync/assistant-proposals-core.js");

for (const [name, source] of [
  ["planning.js", planningEntry],
  ["sync.js", syncEntry],
  ["assistant-proposals.js", assistantEntry]
]) {
  if (/document\.createElement\(\s*["']script["']\s*\)/.test(source)) fail(`${name} must not create a nested script loader`);
}

if (!candidateWorkout.includes('const STORE_KEY = "planningCandidatesV1"')) fail("Candidate Workout store key must be owned by candidate-workout.js");
if (!candidateWorkout.includes("entryForPlan") || !candidateWorkout.includes("regenerate") || !candidateWorkout.includes("invalidate")) fail("Candidate Workout lifecycle API is incomplete");
if (planningCore.includes("planningCandidatesV1")) fail("planning-core.js must not own Candidate persistence");
if (!planningCore.includes("TrainingCandidateWorkout")) fail("planning-core.js must consume the Candidate Workout service");
if (!planningCore.includes("NextWorkout.setConfirmed")) fail("planning must push Candidate into global Planned Workout");
if (/plan\.plannedWorkout\s*=/.test(planningCore)) fail("planning must not write Planned Workout into Template objects");
if (!planningCore.includes("window.FitnessPlanningCore")) fail("Planning core must use the formal global name");
if (planningCore.includes("FitnessPlanningV165") || planningEntry.includes("FitnessPlanningV165")) fail("legacy Planning V165 global must stay removed");
if (!plannedWorkout.includes('const STORE_KEY = "plannedWorkoutV1"')) fail("global Planned Workout store key is missing");
if (!plannedWorkout.includes("delete plan.plannedWorkout")) fail("legacy embedded Planned Workout migration is missing");

if (!githubPrivateRepo.includes("window.FitnessGitHubPrivateRepo")) fail("shared Private GitHub client export is missing");
if (!githubPrivateRepo.includes("privateCheck") || !githubPrivateRepo.includes("getJson") || !githubPrivateRepo.includes("putJson") || !githubPrivateRepo.includes("deleteJson")) fail("shared Private GitHub client API is incomplete");
for (const [name, source] of [
  ["sync-remote.js", syncRemote],
  ["sync-core.js", syncCore],
  ["assistant-proposals-core.js", assistantCore]
]) {
  if (!source.includes("FitnessGitHubPrivateRepo")) fail(`${name} must consume the shared Private GitHub client`);
  if (/function\s+(?:apiHeaders|apiRequest|fileUrl|bytesToBase64|base64ToBytes|decodeBase64Json)\b/.test(source)) {
    fail(`${name} must not reimplement shared GitHub transport helpers`);
  }
}
if (!syncCore.includes('const PLANNED_PATH = "planned-workout.json"')) fail("independent Planned Workout remote file is missing");
if (!syncCore.includes('format: "fitness-planned-workout-v1"')) fail("Planned Workout remote payload format is missing");
if (!syncCore.includes("window.FitnessSyncCore") || syncCore.includes("FitnessSyncV165") || syncEntry.includes("FitnessSyncV165")) fail("Sync core must use the formal global name");
if (!assistantCore.includes("window.FitnessAssistantProposalsCore") || assistantCore.includes("FitnessAssistantProposalsV165") || assistantEntry.includes("FitnessAssistantProposalsV165")) fail("Proposal core must use the formal global name");
if (!assistantCore.includes('await App.persist("plans")')) fail("ChatGPT confirmation must persist Template immediately");
if (!assistantCore.includes("force: true") || !assistantCore.includes("regenerate: true")) fail("ChatGPT confirmation must force Candidate regeneration");
if (assistantCore.includes("pushPlan({ sync: false })")) fail("ChatGPT confirmation must not push Planned Workout");

if (!process.exitCode) console.log("static-check: all checks passed");
