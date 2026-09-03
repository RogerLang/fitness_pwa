const DB_NAME = "fitness-pwa-db";
const DB_VERSION = 1;
const STORE = "kv";

let db = null;
let state = { plans: [], sessions: [], body: [] };
let deferredPrompt = null;

const appModules = [];
const persistHooks = [];
let appStarted = false;
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

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbSet(key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function idbDelete(key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadState() {
  const [plans, sessions, body] = await Promise.all([
    idbGet("plans"), idbGet("sessions"), idbGet("body")
  ]);
  state = {
    plans: Array.isArray(plans) ? plans : [],
    sessions: Array.isArray(sessions) ? sessions : [],
    body: Array.isArray(body) ? body : []
  };
}

async function persist(reason = "data") {
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    store.put(state.plans, "plans");
    store.put(state.sessions, "sessions");
    store.put(state.body, "body");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  for (const hook of persistHooks) {
    try { await hook(reason); }
    catch (error) { console.warn("persist hook failed", error); }
  }
}

function toast(message, type = "info") {
  const el = document.getElementById("appToast");
  if (!el) return;
  clearTimeout(toastTimer);
  el.textContent = message;
  el.className = `app-toast show ${type}`;
  toastTimer = setTimeout(() => { el.className = "app-toast"; }, 2400);
}

function renderBodyHistory() {
  const box = document.getElementById("bodyHistory");
  if (!box) return;
  const arr = [...state.body].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 12);
  if (!arr.length) {
    box.innerHTML = '<div class="empty">暂无身体数据</div>';
    return;
  }
  box.innerHTML = arr.map(item => {
    const details = [
      ["体重", item.weight, "kg"], ["胸围", item.chest, "cm"],
      ["腰围", item.waist, "cm"], ["臂围", item.arm, "cm"]
    ].filter(x => x[1] !== null && x[1] !== undefined)
      .map(x => `${x[0]} ${x[1]} ${x[2]}`).join(" · ");
    return `<div class="body-history-row"><strong>${esc(item.date || "")}</strong><span>${esc(details)}</span></div>`;
  }).join("");
}

function num(id) {
  const el = document.getElementById(id);
  if (!el || el.value === "") return null;
  const value = Number(el.value);
  return Number.isFinite(value) ? value : null;
}

async function saveBody() {
  const item = {
    id: crypto.randomUUID(),
    date: isoDate(),
    weight: num("bodyWeight"),
    chest: num("chestCirc"),
    waist: num("waistCirc"),
    arm: num("armCirc")
  };
  if ([item.weight, item.chest, item.waist, item.arm].every(v => v === null)) {
    toast("请至少输入一项身体数据", "error");
    return;
  }
  state.body.push(item);
  await persist("body");
  ["bodyWeight", "chestCirc", "waistCirc", "armCirc"].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = "";
  });
  renderBodyHistory();
  toast("身体数据已保存", "success");
}

async function exportData() {
  const payload = { format: "fitness-pwa-backup-v3", exportedAt: new Date().toISOString(), ...state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `fitness-backup-${isoDate()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.format && !String(data.format).startsWith("fitness-pwa")) throw new Error("格式不支持");
    state = {
      plans: Array.isArray(data.plans) ? data.plans : [],
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
      body: Array.isArray(data.body) ? data.body : []
    };
    await persist("import");
    for (const module of appModules) if (module.onDataReset) await module.onDataReset("import");
    await refresh("import");
    toast("备份已导入", "success");
  } catch (error) {
    toast(`导入失败：${error.message}`, "error");
  }
}

async function wipeData() {
  if (!confirm("确定删除当前设备上的训练计划、训练记录和身体数据？GitHub 同步信息会保留。")) return;
  for (const module of appModules) if (module.beforeWipe) await module.beforeWipe();
  state = { plans: [], sessions: [], body: [] };
  await persist("wipe");
  for (const module of appModules) if (module.onDataReset) await module.onDataReset("wipe");
  await refresh("wipe");
  toast("本机训练数据已清空", "success");
}

async function refresh(reason = "refresh") {
  const date = document.getElementById("todayDate");
  if (date) date.textContent = fmtDate();
  for (const module of appModules) {
    if (module.refresh) await module.refresh(reason);
  }
  if (document.getElementById("progress")?.classList.contains("active")) renderBodyHistory();
}

async function switchPage(id) {
  document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", page.id === id));
  document.querySelectorAll(".bottom-nav button").forEach(button => button.classList.toggle("active", button.dataset.page === id));
  document.body.classList.remove("chrome-hidden");
  for (const module of appModules) if (module.onPage) await module.onPage(id);
  if (id === "progress") renderBodyHistory();
  window.scrollTo(0, 0);
}

function bindCoreEvents() {
  document.querySelectorAll(".bottom-nav button").forEach(button => {
    button.onclick = () => switchPage(button.dataset.page);
  });
  document.getElementById("saveBodyBtn").onclick = saveBody;
  document.getElementById("exportBtn").onclick = exportData;
  document.getElementById("importInput").onchange = event => {
    const file = event.target.files?.[0];
    if (file) importData(file);
    event.target.value = "";
  };
  document.getElementById("wipeBtn").onclick = wipeData;
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
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
}

async function start() {
  if (appStarted) return;
  appStarted = true;
  try {
    db = await openDB();
    await loadState();
    bindCoreEvents();
    for (const module of appModules) if (module.init) await module.init();
    await refresh("boot");
    initChromeAutoHide();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(error => console.warn("service worker", error));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.body.classList.remove("app-booting");
      document.body.classList.add("app-ready");
    }));
  } catch (error) {
    console.error(error);
    const status = document.querySelector(".boot-status");
    if (status) status.textContent = "启动失败，请刷新页面重试";
  }
}

window.FitnessApp = {
  get state() { return state; },
  get db() { return db; },
  esc, isoDate, fmtDate, idbGet, idbSet, idbDelete, persist, toast,
  refresh, switchPage, renderBodyHistory,
  replaceState(next) {
    state = {
      plans: Array.isArray(next?.plans) ? next.plans : [],
      sessions: Array.isArray(next?.sessions) ? next.sessions : [],
      body: Array.isArray(next?.body) ? next.body : []
    };
  },
  registerModule(module) { appModules.push(module); },
  registerPersistHook(hook) { persistHooks.push(hook); },
  start
};

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
