const Storage = window.FitnessStorage;
if (!Storage) throw new Error("FitnessStorage must load before app.js");

const PAGE_IDS = new Set(["today", "plan", "history", "progress", "settings"]);
const PAGE_SCRIPTS = Object.freeze({
  plan: [
    "js/training/planning-core.js",
    "js/training/planning.js",
    "js/sync/assistant-proposals-core.js"
  ],
  history: [
    "js/training/training-session-data.js",
    "js/training/training-history.js"
  ],
  progress: [
    "js/training/training-session-data.js",
    "js/training/training-progress.js",
    "js/core/app-body.js"
  ],
  settings: ["js/core/app-backup.js"]
});
const STATE_KEYS = Object.freeze(["plans", "sessions", "body"]);
const PERSIST_SCOPES = Object.freeze({
  plans: ["plans"],
  sessions: ["sessions"],
  body: ["body"],
  workout: ["plans", "sessions"],
  maintenance: ["sessions"],
  ids: ["sessions", "body"],
  remote: STATE_KEYS,
  import: STATE_KEYS,
  wipe: STATE_KEYS,
  reset: STATE_KEYS,
  data: STATE_KEYS
});
const DATA_SCHEMA_VERSION = 2;

let db = null;
let state = { plans: [], sessions: [], body: [] };
let deferredPrompt = null;

const appModules = [];
const persistHooks = [];
const initializedModules = new WeakSet();
const scriptLoads = new Map();
let appStarted = false;
let auxiliaryInitStarted = false;
let toastTimer = null;

function esc(value = "") {
  return String(value).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function isoDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtDate(d = new Date()) {
  const date = d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  const weekday = d.toLocaleDateString("zh-CN", { weekday: "short" });
  return `${date} ${weekday}`;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizedString(value) {
  return value === undefined || value === null ? "" : String(value);
}

function normalizedId(value) {
  return normalizedString(value).trim();
}

function legacyId(prefix, ...parts) {
  const seed = parts.map(part => normalizedString(part).trim()).join("\u001f");
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < seed.length; i++) {
    const code = seed.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
  }
  return `${prefix}-${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

function normalizeSet(value) {
  return { ...objectValue(value) };
}

function normalizeTemplateExercise(value, planId = "", legacyIndex = 0) {
  const exercise = objectValue(value);
  const name = normalizedString(exercise.name);
  const normalized = {
    ...exercise,
    name,
    exerciseId: normalizedId(exercise.exerciseId) || legacyId("exercise", planId, name, legacyIndex)
  };
  if (Object.prototype.hasOwnProperty.call(exercise, "setPresets")) {
    normalized.setPresets = Array.isArray(exercise.setPresets) ? exercise.setPresets.map(normalizeSet) : [];
  }
  return normalized;
}

function exerciseLookup(exercises = []) {
  const byId = new Map();
  const byName = new Map();
  for (const exercise of exercises) {
    const id = normalizedId(exercise?.exerciseId);
    const name = normalizedString(exercise?.name);
    if (id && !byId.has(id)) byId.set(id, exercise);
    if (name && !byName.has(name)) byName.set(name, exercise);
  }
  return { byId, byName };
}

function normalizeWorkoutExercise(value, planId = "", templates = null, positionalTemplate = null, legacyIndex = 0) {
  const exercise = objectValue(value);
  const name = normalizedString(exercise.name);
  const existingId = normalizedId(exercise.exerciseId);
  const positionalMatch = positionalTemplate && normalizedString(positionalTemplate.name) === name ? positionalTemplate : null;
  const matched = existingId
    ? templates?.byId?.get(existingId)
    : positionalMatch || templates?.byName?.get(name);
  return {
    ...exercise,
    name,
    exerciseId: existingId || normalizedId(matched?.exerciseId) || legacyId("exercise", planId, name, legacyIndex),
    sets: Array.isArray(exercise.sets) ? exercise.sets.map(normalizeSet) : []
  };
}

function normalizeWorkout(value, fallbackPlanId = "", templateExercises = []) {
  const workout = objectValue(value);
  const planName = normalizedString(workout.planName);
  const planId = normalizedId(workout.planId) || normalizedId(fallbackPlanId) || legacyId("plan", planName);
  const templates = exerciseLookup(templateExercises);
  return {
    ...workout,
    planName,
    planId,
    exercises: Array.isArray(workout.exercises)
      ? workout.exercises.map((exercise, index) => normalizeWorkoutExercise(exercise, planId, templates, templateExercises[index], index))
      : []
  };
}

function normalizePlan(value) {
  const plan = objectValue(value);
  const name = normalizedString(plan.name);
  const planId = normalizedId(plan.planId) || legacyId("plan", name);
  const exercises = Array.isArray(plan.exercises)
    ? plan.exercises.map((exercise, index) => normalizeTemplateExercise(exercise, planId, index))
    : [];
  const normalized = {
    ...plan,
    name,
    planId,
    exercises
  };
  if (plan.plannedWorkout && typeof plan.plannedWorkout === "object" && !Array.isArray(plan.plannedWorkout)) {
    normalized.plannedWorkout = normalizeWorkout(plan.plannedWorkout, planId, exercises);
  }
  return normalized;
}

function normalizeSessionExercise(value, planId = "", templates = null, positionalTemplate = null, legacyIndex = 0) {
  const exercise = normalizeWorkoutExercise(value, planId, templates, positionalTemplate, legacyIndex);
  if (exercise.planned && typeof exercise.planned === "object" && !Array.isArray(exercise.planned)) {
    exercise.planned = {
      ...exercise.planned,
      sets: Array.isArray(exercise.planned.sets) ? exercise.planned.sets.map(normalizeSet) : []
    };
  }
  return exercise;
}

function planLookup(plans = []) {
  const byId = new Map();
  const byName = new Map();
  for (const plan of plans) {
    const id = normalizedId(plan?.planId);
    const name = normalizedString(plan?.name);
    if (id && !byId.has(id)) byId.set(id, plan);
    if (name && !byName.has(name)) byName.set(name, plan);
  }
  return { byId, byName };
}

function normalizeSession(value, plans = null) {
  const session = objectValue(value);
  const planName = normalizedString(session.plan);
  const existingPlanId = normalizedId(session.planId);
  const matchedPlan = existingPlanId ? plans?.byId?.get(existingPlanId) : plans?.byName?.get(planName);
  const planId = existingPlanId || normalizedId(matchedPlan?.planId) || legacyId("plan", planName);
  const templateExercises = matchedPlan?.exercises || [];
  const templates = exerciseLookup(templateExercises);
  const normalized = {
    ...session,
    date: normalizedString(session.date),
    plan: planName,
    planId,
    exercises: Array.isArray(session.exercises)
      ? session.exercises.map((exercise, index) => normalizeSessionExercise(exercise, planId, templates, templateExercises[index], index))
      : []
  };
  if (session.id !== undefined && session.id !== null) normalized.id = String(session.id);
  if (session.completedAt !== undefined && session.completedAt !== null) normalized.completedAt = String(session.completedAt);
  return normalized;
}

function normalizeBodyRecord(value) {
  const record = { ...objectValue(value) };
  if (record.id !== undefined && record.id !== null) record.id = String(record.id);
  if (record.date !== undefined && record.date !== null) record.date = String(record.date);
  if (record.recordedAt !== undefined && record.recordedAt !== null) record.recordedAt = String(record.recordedAt);
  return record;
}

function normalizeState(next) {
  const value = objectValue(next);
  const plans = Array.isArray(value.plans) ? value.plans.map(normalizePlan) : [];
  const plansByIdentity = planLookup(plans);
  return {
    plans,
    sessions: Array.isArray(value.sessions) ? value.sessions.map(session => normalizeSession(session, plansByIdentity)) : [],
    body: Array.isArray(value.body) ? value.body.map(normalizeBodyRecord) : []
  };
}

function stateChangedByNormalization(before, after) {
  try {
    return JSON.stringify(before) !== JSON.stringify(after);
  } catch (_) {
    return true;
  }
}

const Schema = Object.freeze({
  version: DATA_SCHEMA_VERSION,
  legacyId,
  normalizeSet,
  normalizeTemplateExercise,
  normalizeWorkoutExercise,
  normalizeWorkout,
  normalizePlan,
  normalizeSession,
  normalizeBodyRecord,
  normalizeState
});

function pageFromLocation() {
  const id = window.location.hash.slice(1).split("/")[0];
  return PAGE_IDS.has(id) ? id : "today";
}

function modulePages(module) {
  return Array.isArray(module?.pages) ? module.pages : [];
}

function moduleHandlesPage(module, pageId) {
  return modulePages(module).includes(pageId);
}

function pagesForScript(src) {
  const source = String(src || "").split("?")[0];
  if (!source) return [];
  return Object.entries(PAGE_SCRIPTS)
    .filter(([, scripts]) => scripts.includes(source))
    .map(([pageId]) => pageId);
}

function currentScriptSource() {
  return document.currentScript?.getAttribute("src")?.split("?")[0] || "";
}

function loadScript(src) {
  if (scriptLoads.has(src)) return scriptLoads.get(src);
  const existing = [...document.scripts].find(script => script.getAttribute("src")?.split("?")[0] === src);
  if (existing) {
    const ready = Promise.resolve();
    scriptLoads.set(src, ready);
    return ready;
  }

  const promise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.dataset.fitnessPageModule = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`页面模块加载失败：${src}`));
    document.body.appendChild(script);
  });
  scriptLoads.set(src, promise);
  return promise;
}

async function ensurePageScripts(pageId) {
  for (const src of PAGE_SCRIPTS[pageId] || []) await loadScript(src);
}

const idbGet = key => Storage.get(db, key);
const idbSet = (key, value) => Storage.set(db, key, value);

async function loadState() {
  const rawState = await Storage.readState(db);
  const normalized = Schema.normalizeState(rawState);
  state = normalized;
  if (stateChangedByNormalization(rawState, normalized)) {
    await Storage.writeState(db, normalized);
  }
}

function persistKeys(reason) {
  return PERSIST_SCOPES[reason] || STATE_KEYS;
}

async function persist(reason = "data") {
  state = Schema.normalizeState(state);
  const keys = persistKeys(reason);
  await Storage.writeKeys(db, state, keys);
  for (const hook of persistHooks) {
    try {
      await hook(reason, keys);
    } catch (error) {
      console.warn("persist hook failed", error);
    }
  }
}

function toast(message, type = "info") {
  const el = document.getElementById("appToast");
  if (!el) return;
  clearTimeout(toastTimer);
  el.textContent = message;
  el.className = `app-toast show ${type}`;
  toastTimer = setTimeout(() => {
    el.className = "app-toast";
  }, 2400);
}

async function refresh(reason = "refresh") {
  const date = document.getElementById("todayDate");
  if (date) date.textContent = fmtDate();
  for (const module of appModules) {
    if (module.refresh && initializedModules.has(module)) await module.refresh(reason);
  }
}

async function resetData(next, reason = "reset") {
  for (const module of appModules) {
    if (module.beforeDataReset && initializedModules.has(module)) await module.beforeDataReset(reason);
  }

  state = Schema.normalizeState(next);
  await persist(reason);

  for (const module of appModules) {
    if (module.onDataReset && initializedModules.has(module)) await module.onDataReset(reason);
  }
  await refresh(reason);
}

async function initModule(module) {
  if (!module?.init || initializedModules.has(module)) return;
  await module.init();
  initializedModules.add(module);
}

async function initPageModules(pageId) {
  for (const module of appModules) {
    if (moduleHandlesPage(module, pageId)) await initModule(module);
  }
}

async function switchPage(id, { historyMode = "replace", scroll = true } = {}) {
  const pageId = PAGE_IDS.has(id) ? id : "today";
  const nextHash = `#${pageId}`;

  await ensurePageScripts(pageId);
  await initPageModules(pageId);

  if (historyMode === "replace" && window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
  } else if (historyMode === "push" && window.location.hash !== nextHash) {
    window.history.pushState(null, "", nextHash);
  }

  document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", page.id === pageId));
  document.querySelectorAll(".bottom-nav button").forEach(button => button.classList.toggle("active", button.dataset.page === pageId));
  document.body.classList.remove("chrome-hidden");

  for (const module of appModules) {
    if (module.onPage && initializedModules.has(module)) await module.onPage(pageId);
  }
  if (scroll) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
}

function bindCoreEvents() {
  document.querySelectorAll(".bottom-nav button").forEach(button => {
    button.onclick = () => switchPage(button.dataset.page, { historyMode: "replace" });
  });
}

function initChromeAutoHide() {
  const trainingPage = document.getElementById("today");
  let lastY = window.scrollY;
  let ticking = false;

  const update = () => {
    const y = window.scrollY;
    if (trainingPage?.classList.contains("active")) {
      lastY = y;
      ticking = false;
      return;
    }

    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const delta = y - lastY;
    if (y <= 16 || max - y <= 16 || delta < -8) document.body.classList.remove("chrome-hidden");
    else if (delta > 8) document.body.classList.add("chrome-hidden");
    lastY = y;
    ticking = false;
  };

  window.addEventListener("scroll", () => {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(update);
    }
  }, { passive: true });
}

function initAuxiliaryModules(modules) {
  if (auxiliaryInitStarted || !modules.length) return;
  auxiliaryInitStarted = true;
  requestAnimationFrame(() => setTimeout(async () => {
    for (const module of modules) {
      if (modulePages(module).length) continue;
      try {
        await initModule(module);
        if (module.onPage && initializedModules.has(module)) await module.onPage(pageFromLocation());
      } catch (error) {
        console.warn("auxiliary module lifecycle", error);
      }
    }
  }, 0));
}

function revealApp() {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.body.classList.remove("app-booting");
    document.body.classList.add("app-ready");
  }));
}

async function start() {
  if (appStarted) return;
  appStarted = true;

  try {
    db = await Storage.open();
    await loadState();
    bindCoreEvents();

    const criticalModules = appModules.filter(module => module.critical === true && modulePages(module).length === 0);
    const auxiliaryModules = appModules.filter(module => !criticalModules.includes(module));
    for (const module of criticalModules) await initModule(module);

    await refresh("boot");

    const initialPage = pageFromLocation();
    const hasValidHash = window.location.hash === `#${initialPage}`;
    await switchPage(initialPage, { historyMode: hasValidHash ? "none" : "replace", scroll: false });

    initChromeAutoHide();
    revealApp();
    initAuxiliaryModules(auxiliaryModules);
  } catch (error) {
    appStarted = false;
    console.error(error);
    const status = document.querySelector(".boot-status");
    if (status) status.textContent = "启动失败，请刷新页面重试";
  }
}

window.FitnessApp = {
  get state() {
    return state;
  },
  get db() {
    return db;
  },
  schema: Schema,
  esc,
  isoDate,
  fmtDate,
  idbGet,
  idbSet,
  persist,
  toast,
  refresh,
  resetData,
  switchPage,
  registerModule(module) {
    if (!Array.isArray(module?.pages)) {
      const inferredPages = pagesForScript(currentScriptSource());
      if (inferredPages.length) module.pages = inferredPages;
    }
    appModules.push(module);
  },
  registerPersistHook(hook) {
    persistHooks.push(hook);
  },
  start
};

window.addEventListener("popstate", () => {
  if (!appStarted) return;
  switchPage(pageFromLocation(), { historyMode: "none" }).catch(error => console.warn("page route", error));
});

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredPrompt = event;
  const button = document.getElementById("installBtn");
  if (!button) return;
  button.classList.remove("hidden");
  button.onclick = async () => {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    button.classList.add("hidden");
  };
});

window.addEventListener("DOMContentLoaded", () => queueMicrotask(start), { once: true });