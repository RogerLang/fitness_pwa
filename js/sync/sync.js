(() => {
  const App = window.FitnessApp;
  const Remote = window.FitnessSyncRemote;
  if (!Remote) throw new Error("FitnessSyncRemote must load before sync.js");

  const CREDS_KEY = "syncCredentialsV7";
  const LEGACY_CONFIG_KEY = "syncConfig";
  const META_KEY = "syncMetaV11";
  const AUTO_CHECK_COOLDOWN_MS = 60000;

  let applyingRemote = false;
  let todayStatusTimer = null;
  let autoInitialized = false;
  let autoChecking = false;
  let lastAutoCheckAt = 0;
  let savedCredentials = null;
  let suppressAutoPullCount = 0;
  let syncRunning = false;
  const syncQueue = [];

  function normalizeCredentials(value = {}) {
    return {
      owner: String(value.owner || "").trim(),
      repo: String(value.repo || "").trim(),
      token: String(value.token || "").trim()
    };
  }

  function completeCredentials(value) {
    return !!(value?.owner && value?.repo && value?.token);
  }

  function formCredentials() {
    return normalizeCredentials({
      owner: document.getElementById("syncOwner")?.value,
      repo: document.getElementById("syncRepo")?.value,
      token: document.getElementById("syncToken")?.value
    });
  }

  function fillCredentialInputs(credentials, { onlyEmpty = false } = {}) {
    const values = {
      syncOwner: credentials?.owner || "",
      syncRepo: credentials?.repo || "",
      syncToken: credentials?.token || ""
    };
    for (const [id, value] of Object.entries(values)) {
      const input = document.getElementById(id);
      if (!input || !value) continue;
      if (onlyEmpty && input.value.trim()) continue;
      input.value = value;
    }
  }

  async function readCredentials() {
    const primary = normalizeCredentials(await App.idbGet(CREDS_KEY) || {});
    const legacy = normalizeCredentials(await App.idbGet(LEGACY_CONFIG_KEY) || {});
    const merged = {
      owner: primary.owner || legacy.owner,
      repo: primary.repo || legacy.repo,
      token: primary.token || legacy.token
    };
    savedCredentials = merged;

    if (completeCredentials(merged) && !completeCredentials(primary)) {
      await App.idbSet(CREDS_KEY, merged);
    }
    return merged;
  }

  async function persistCredentials(credentials) {
    const value = normalizeCredentials(credentials);
    if (!completeCredentials(value)) return false;
    savedCredentials = value;
    await App.idbSet(CREDS_KEY, value);
    await App.idbSet(LEGACY_CONFIG_KEY, { owner: value.owner, repo: value.repo });
    return true;
  }

  async function hasCredentials() {
    if (completeCredentials(savedCredentials)) return true;
    return completeCredentials(await readCredentials());
  }

  async function credentialsForSync() {
    const form = formCredentials();
    if (completeCredentials(form)) {
      await persistCredentials(form);
      return form;
    }

    const saved = completeCredentials(savedCredentials) ? savedCredentials : await readCredentials();
    if (completeCredentials(saved)) {
      fillCredentialInputs(saved, { onlyEmpty: true });
      return saved;
    }
    return form;
  }

  function status(message, ok = null) {
    const settings = document.getElementById("syncStatus");
    if (settings) {
      settings.textContent = message || "";
      settings.className = `muted sync-status${ok === true ? " sync-ok" : ok === false ? " sync-error" : ""}`;
    }
    const today = document.getElementById("todaySyncStatus");
    if (today) {
      clearTimeout(todayStatusTimer);
      today.textContent = message || "";
      today.className = `today-sync-status${ok === true ? " sync-ok" : ok === false ? " sync-error" : ""}${message ? " show" : ""}`;
      if (message && ok === true) {
        const shown = message;
        todayStatusTimer = setTimeout(() => {
          if (today.textContent === shown) today.className = "today-sync-status";
        }, 4200);
      }
    }
  }

  async function readMeta() {
    return await App.idbGet(META_KEY) || {};
  }

  async function writeMeta(meta) {
    await App.idbSet(META_KEY, meta);
    return meta;
  }

  async function refreshMeta() {
    if (!App.db) return {};
    const meta = await readMeta();
    const sig = await Remote.jsonSig(App.state.plans);
    if (!meta.plansSig) {
      meta.plansSig = sig;
      meta.plansDirty = false;
      meta.plansBaseRevision = meta.plansBaseRevision || null;
    } else if (!applyingRemote && meta.plansSig !== sig) {
      meta.plansSig = sig;
      meta.plansDirty = true;
    }
    return writeMeta(meta);
  }

  async function ensureIds() {
    let changed = false;
    for (const items of [App.state.sessions, App.state.body]) {
      for (const item of items) {
        if (item.id) continue;
        item.id = crypto.randomUUID();
        changed = true;
      }
    }
    if (changed) await App.persist("ids");
  }

  async function pushImmutable(configValue, manifest, kind, items) {
    const local = await Remote.mapByHash(items);
    const remote = new Set(Array.isArray(manifest[kind]) ? manifest[kind] : []);
    let added = 0;

    for (const [hash, item] of local) {
      if (remote.has(hash)) continue;
      await Remote.verifyOrCreateImmutable(configValue, kind, hash, item);
      remote.add(hash);
      added++;
    }

    manifest[kind] = [...remote].sort();
    return added;
  }

  async function pullImmutable(configValue, manifest, kind, target) {
    const local = await Remote.mapByHash(target);
    let added = 0;

    for (const hash of Array.isArray(manifest[kind]) ? manifest[kind] : []) {
      if (local.has(hash)) continue;
      const item = await Remote.downloadImmutable(configValue, kind, hash);
      target.push(item);
      local.set(hash, item);
      added++;
    }

    return added;
  }

  async function saveCredentials(showStatus = false) {
    const value = formCredentials();
    if (!completeCredentials(value)) {
      if (showStatus) status("请先填写 GitHub 用户名、Private 仓库和 Token。", false);
      return false;
    }
    await persistCredentials(value);
    if (showStatus) status("GitHub 同步信息已保存在当前设备。", true);
    return true;
  }

  async function loadCredentials({ onlyEmpty = false } = {}) {
    const saved = await readCredentials();
    fillCredentialInputs(saved, { onlyEmpty });
  }

  function enqueueSync(kind, task, { priority = false } = {}) {
    return new Promise(resolve => {
      const entry = { kind, task, resolve };
      if (priority) syncQueue.unshift(entry);
      else syncQueue.push(entry);
      runSyncQueue();
    });
  }

  async function runSyncQueue() {
    if (syncRunning) return;
    syncRunning = true;
    try {
      while (syncQueue.length) {
        const entry = syncQueue.shift();
        let result;
        try {
          result = await entry.task();
        } catch (error) {
          console.warn(`sync ${entry.kind}`, error);
          const message = error?.message || "同步失败";
          status(message, false);
          result = { ok: false, kind: entry.kind, message, error };
        }
        entry.resolve(result);
      }
    } finally {
      syncRunning = false;
      if (syncQueue.length) runSyncQueue();
    }
  }

  async function performPush() {
    try {
      const c = await credentialsForSync();
      status("正在检查 Private 仓库…");
      await Remote.privateCheck(c);
      await ensureIds();
      await refreshMeta();
      const meta = await readMeta();
      const remote = await Remote.loadManifest(c);
      const manifest = remote.manifest;
      const remoteRev = manifest.plans?.revision || null;

      if (remote.exists && remoteRev && meta.plansBaseRevision !== remoteRev) {
        if (meta.plansDirty) throw new Error("本机和云端都修改过训练计划。请先从 GitHub 合并并选择要保留的计划。");
        throw new Error("云端训练计划有更新，请先从 GitHub 合并。");
      }

      status("正在增量同步新增记录…");
      const addedSessions = await pushImmutable(c, manifest, "sessions", App.state.sessions);
      const addedBody = await pushImmutable(c, manifest, "body", App.state.body);
      let changed = addedSessions > 0 || addedBody > 0;
      let plansUploaded = false;

      if (!remoteRev || meta.plansDirty) {
        await Remote.uploadPlans(c, App.state.plans, manifest, meta);
        changed = true;
        plansUploaded = true;
      }

      const message = changed
        ? `同步完成：新增 ${addedSessions} 条训练、${addedBody} 条身体记录。`
        : "GitHub 已包含本机全部记录。";

      if (changed) {
        await Remote.saveManifest(c, manifest, remote.sha);
        await writeMeta(meta);
      }
      status(message, true);
      return { ok: true, kind: "push", changed, plansUploaded, addedSessions, addedBody, message };
    } catch (error) {
      const message = error?.message || "同步失败";
      status(message, false);
      return { ok: false, kind: "push", message, error };
    }
  }

  function push({ priority = false } = {}) {
    return enqueueSync("push", performPush, { priority });
  }

  async function performPull({ source = "settings" } = {}) {
    try {
      const c = await credentialsForSync();
      App.training?.captureDraft();
      await App.training?.flushDraft();
      status(source === "today" ? "正在刷新训练计划和训练记录…" : "正在读取 GitHub 数据…");
      await Remote.privateCheck(c);
      await ensureIds();
      await refreshMeta();
      const meta = await readMeta();
      const remote = await Remote.loadManifest(c);
      if (!remote.exists) throw new Error("GitHub 还没有同步数据，请先在有完整数据的设备执行增量同步。");
      const manifest = remote.manifest;
      const remoteRev = manifest.plans?.revision || null;
      const oldPlanName = App.training?.currentPlanName || "";
      const forcePlans = App.state.plans.length === 0 && !!remoteRev;
      const plansChanged = !!remoteRev && (forcePlans || meta.plansBaseRevision !== remoteRev);

      if (plansChanged && App.training?.hasDraft()) throw new Error("当前还有未保存的训练输入。请先保存本次训练或清空输入，再更新训练计划。");
      if (plansChanged && meta.plansDirty) {
        const useCloud = confirm("本机训练计划也有修改。继续会使用 GitHub 最新计划覆盖本机计划；训练历史和身体数据会保留。继续？");
        if (!useCloud) throw new Error("已取消，保留本机训练计划。");
      }

      let nextPlans = App.state.plans;
      if (plansChanged) nextPlans = await Remote.downloadPlans(c, manifest);

      const addedSessions = await pullImmutable(c, manifest, "sessions", App.state.sessions);
      const addedBody = await pullImmutable(c, manifest, "body", App.state.body);

      if (plansChanged) App.state.plans = nextPlans;
      const removed = await App.training?.cleanupDuplicates({ persistChanges: false }) || 0;
      if (plansChanged) {
        meta.plansBaseRevision = remoteRev;
        meta.plansDirty = false;
        meta.plansSig = await Remote.jsonSig(App.state.plans);
      }

      applyingRemote = true;
      try {
        await App.persist("remote");
      } finally {
        applyingRemote = false;
      }
      await writeMeta(meta);
      await App.training?.prepareRemotePlans(oldPlanName, plansChanged);
      await App.refresh("remote");

      const message = [
        plansChanged ? "计划已更新" : "计划已是最新",
        addedSessions ? `新增 ${addedSessions} 条训练` : "训练记录已是最新",
        addedBody ? `新增 ${addedBody} 条身体记录` : "身体数据已是最新",
        removed ? `清理 ${removed} 条旧重复记录` : ""
      ].filter(Boolean).join(" · ");
      status(message, true);
      return { ok: true, kind: "pull", plansChanged, addedSessions, addedBody, removed, message };
    } catch (error) {
      applyingRemote = false;
      const message = error?.message || "同步失败";
      status(message, false);
      return { ok: false, kind: "pull", message, error };
    }
  }

  function pull({ source = "settings", priority = false } = {}) {
    return enqueueSync("pull", () => performPull({ source }), { priority });
  }

  function suppressNextAutoPull() {
    suppressAutoPullCount++;
  }

  async function plansAreDirty() {
    const meta = await refreshMeta();
    return !!meta.plansDirty;
  }

  async function checkLatest() {
    if (!autoInitialized || autoChecking || Date.now() - lastAutoCheckAt < AUTO_CHECK_COOLDOWN_MS) return { ok: true, skipped: "cooldown" };
    if (suppressAutoPullCount > 0) {
      suppressAutoPullCount--;
      return { ok: true, skipped: "suppressed" };
    }
    if (App.training?.hasDraft?.()) return { ok: true, skipped: "training-draft" };
    if (!await hasCredentials()) return { ok: true, skipped: "no-credentials" };
    if (await plansAreDirty()) return { ok: true, skipped: "local-plans-dirty" };

    autoChecking = true;
    lastAutoCheckAt = Date.now();
    try {
      return await pull({ source: "today" });
    } finally {
      autoChecking = false;
    }
  }

  async function runButton(button, busyText, task) {
    if (!button || button.disabled) return;
    const old = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
    try {
      await task();
    } finally {
      button.disabled = false;
      button.textContent = old;
    }
  }

  function bindEvents() {
    const quickPull = document.getElementById("pullPlansTodayBtn");
    const quickPush = document.getElementById("syncTodayBtn");
    const settingsPull = document.getElementById("pullSyncBtn");
    const settingsPush = document.getElementById("pushSyncBtn");
    const remember = document.getElementById("rememberSyncBtn");
    if (quickPull) quickPull.onclick = () => runButton(quickPull, "刷新中…", () => pull({ source: "today" }));
    if (quickPush) quickPush.onclick = () => runButton(quickPush, "同步中…", () => push());
    if (settingsPull) settingsPull.onclick = () => runButton(settingsPull, "合并中…", () => pull({ source: "settings" }));
    if (settingsPush) settingsPush.onclick = () => runButton(settingsPush, "同步中…", () => push());
    if (remember) remember.onclick = () => saveCredentials(true);
  }

  async function onDataReset(reason) {
    if (reason !== "wipe") return;
    await writeMeta({ plansBaseRevision: null, plansDirty: false, plansSig: await Remote.jsonSig([]) });
  }

  async function init() {
    await loadCredentials();
    await refreshMeta();
    bindEvents();
    autoInitialized = true;
    if (document.getElementById("today")?.classList.contains("active")) {
      setTimeout(() => checkLatest().catch(() => {}), 250);
    }
  }

  async function onPage(id) {
    if (id === "settings") await loadCredentials({ onlyEmpty: true });
    if (id === "today") checkLatest().catch(() => {});
  }

  App.registerPersistHook(async reason => {
    if (["plans", "import", "wipe"].includes(reason)) await refreshMeta();
  });
  App.registerModule({ init, onPage, onDataReset });
  App.sync = { push, pull, hasCredentials, suppressNextAutoPull };
})();
