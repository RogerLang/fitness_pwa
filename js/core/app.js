const Storage = window.FitnessStorage;
if (!Storage) throw new Error("FitnessStorage must load before app.js");

const PAGE_IDS = new Set(["today", "plan", "history", "progress", "settings"]);

let db = null;
let state = { plans: [], sessions: [], body: [] };
let deferredPrompt = null;

const appModules = [];
const persistHooks = [];
const initializedModules = new WeakSet();
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
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" });
}

function normalizeState(next) {
  return {
    plans: Array.isArray(next?.plans) ? next.plans : [],
    sessions: Array.isArray(next?.sessions) ? next.sessions : [],
    body: Array.isArray(next?.body) ? next.body : []
  };
}

function pageFromLocation() {
  const id = window.location.hash.slice(1).split("/")[0];
  return PAGE_IDS.has(id) ? id : "today";
}

const idbGet = key => Storage.get(db, key);
const idbSet = (key, value) => Storage.set(db, key, value);
const idbDelete = key => Storage.remove(db, key);

async function loadState() {
  state = await Storage.readState(db);
}

async function persist(reason = "data") {
  await Storage.writeState(db, state);
  for (const hook of persistHooks) {
    try {
      await hook(reason);
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
    if (module.refresh) await module.refresh(reason);
  }
}

async function resetData(next, reason = "reset") {
  for (const module of appModules) {
    if (module.beforeDataReset) await module.beforeDataReset(reason);
    else if (reason === "wipe" && module.beforeWipe) await module.beforeWipe();
  }

  state = normalizeState(next);
  await persist(reason);

  for (const module of appModules) {
    if (module.onDataReset) await module.onDataReset(reason);
  }
  await refresh(reason);
}

async function switchPage(id, { historyMode = "replace", scroll = true } = {}) {
  const pageId = PAGE_IDS.has(id) ? id : "today";
  const nextHash = `#${pageId}`;

  if (historyMode === "replace" && window.location.hash !== nextHash) {
    window.history.replaceState(null, "", nextHash);
  } else if (historyMode === "push" && window.location.hash !== nextHash) {
    window.history.pushState(null, "", nextHash);
  }

  document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", page.id === pageId));
  document.querySelectorAll(".bottom-nav button").forEach(button => button.classList.toggle("active", button.dataset.page === pageId));
  document.body.classList.remove("chrome-hidden");

  for (const module of appModules) {
    if (module.onPage) await module.onPage(pageId);
  }
  if (scroll) window.scrollTo(0, 0);
}

function bindCoreEvents() {
  document.querySelectorAll(".bottom-nav button").forEach(button => {
    button.onclick = () => switchPage(button.dataset.page, { historyMode: "replace" });
  });
}

function initChromeAutoHide() {
  let lastY = window.scrollY;
  let ticking = false;

  const update = () => {
    const y = window.scrollY;
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

async function initModule(module) {
  if (!module?.init || initializedModules.has(module)) return;
  await module.init();
  initializedModules.add(module);
}

function initAuxiliaryModules(modules) {
  if (auxiliaryInitStarted || !modules.length) return;
  auxiliaryInitStarted = true;
  requestAnimationFrame(() => setTimeout(async () => {
    for (const module of modules) {
      try {
        await initModule(module);
      } catch (error) {
        console.warn("auxiliary module init", error);
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

    const criticalModules = appModules.filter(module => module.critical === true || typeof module.refresh === "function");
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
  esc,
  isoDate,
  fmtDate,
  idbGet,
  idbSet,
  idbDelete,
  persist,
  toast,
  refresh,
  resetData,
  switchPage,
  replaceState(next) {
    state = normalizeState(next);
  },
  registerModule(module) {
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
