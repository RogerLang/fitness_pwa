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
  }

  for (const required of [
    "js/training/planning-v165.js",
    "js/sync/sync-v165.js",
    "js/sync/assistant-proposals-v165.js"
  ]) {
    if (!shellSet.has(required)) fail(`v165 core module is missing from SHELL_ASSETS: ${required}`);
  }
}

if (/\?v=\d+/i.test(indexHtml) || /\?v=\d+/i.test(serviceWorker)) {
  fail("per-file ?v= resource versions must not return; shell cache version is the release boundary");
}

const motionJs = read("js/training/training-motion.js");
const motionCss = read("assets/css/training-motion.css");
if (!motionJs.includes("overviewTargetY = 0;")) fail("protected overviewTargetY = 0 regression guard failed");
if (!motionCss.includes("--training-overview-offset:68px;")) fail("protected --training-overview-offset:68px regression guard failed");

const planningCore = read("js/training/planning-v165.js");
const nextWorkout = read("js/training/training-next-workout.js");
const syncCore = read("js/sync/sync-v165.js");
const assistantCore = read("js/sync/assistant-proposals-v165.js");

if (!planningCore.includes('const CANDIDATES_KEY = "planningCandidatesV1"')) fail("v165 Candidate Workout store key is missing");
if (!planningCore.includes("NextWorkout.setConfirmed")) fail("v165 planning must push Candidate into global Planned Workout");
if (/plan\.plannedWorkout\s*=/.test(planningCore)) fail("v165 planning must not write Planned Workout into Template objects");
if (!nextWorkout.includes('const STORE_KEY = "plannedWorkoutV1"')) fail("v165 global Planned Workout store key is missing");
if (!nextWorkout.includes("delete plan.plannedWorkout")) fail("v165 legacy embedded Planned Workout migration is missing");
if (!syncCore.includes('const PLANNED_PATH = "planned-workout.json"')) fail("v165 independent Planned Workout remote file is missing");
if (!syncCore.includes('format: "fitness-planned-workout-v1"')) fail("v165 Planned Workout remote payload format is missing");
if (!assistantCore.includes('await App.persist("plans")')) fail("v165 ChatGPT confirmation must persist Template immediately");
if (!assistantCore.includes("force: true") || !assistantCore.includes("regenerate: true")) fail("v165 ChatGPT confirmation must force Candidate regeneration");
if (assistantCore.includes("pushPlan({ sync: false })")) fail("v165 ChatGPT confirmation must not push Planned Workout");

if (!process.exitCode) console.log("static-check: all checks passed");
