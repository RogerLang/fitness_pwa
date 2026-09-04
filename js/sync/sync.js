(() => {
  const App = window.FitnessApp;
  const Remote = window.FitnessSyncRemote;
  if (!Remote) throw new Error("FitnessSyncRemote must load before sync.js");

  const CREDS_KEY = "syncCredentialsV7";
  const LEGACY_CONFIG_KEY = "syncConfig";
  const META_KEY = "syncMetaV11";
  let applyingRemote = false;
  let todayStatusTimer = null;

  function config() {
    return {
      owner: document.getElementById("syncOwner")?.value.trim() || "",
      repo: document.getElementById("syncRepo")?.value.trim() || "",
      token: document.getElementById("syncToken")?.value.trim() || ""
    };
  }

  async function readCredentials() {
    return await App.idbGet(CREDS_KEY) || await App.idbGet(LEGACY_CONFIG_KEY) || {};
  }

  async function hasCredentials() {
    const saved = await readCredentials();
    return !!(saved.owner && saved.repo && saved.token);
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
    for (const session of App.state.sessions) {
      if (!session.id) {
        session.id = crypto.randomUUID();
        changed = true;
      }
    }
    for (const body of App.state.body) {
      if (!body.id) {
        body.id = crypto.randomUUID();
        changed = true;
      }
    }
    if (changed) await App.persist("ids");
  }

  async function saveCredentials(showStatus = false) {
    const c = config();
    if (showStatus && (!c.owner || !c.repo || !c.token)) {
      status("请先填写 GitHub 用户名、Private 仓库和 Token。", false);
      return false;
    }
    await App.idbSet(CREDS_KEY, c);
    await App.idbSet(LEGACY_CONFIG_KEY, { owner: c.owner, repo: c.repo });
    if (showStatus) status("GitHub 同步信息已保存在当前设备。", true);
    return true;
  }

  async function loadCredentials() {
    const saved = await readCredentials();
    const values = { syncOwner: saved.owner, syncRepo: saved.repo, syncToken: saved.token };
    for (const [id, value] of Object.entries(values)) {
      const input = document.getElementById(id);
      if (input && value !== undefined && value !== null) input.value = value;
    }
  }

  async function push() {
    const c = config();
    try {
      await saveCredentials(false);
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

      let changed = false;
      let addedSessions = 0;
      let addedBody = 0;
      status("正在增量同步新增记录…");

      const sessionMap = await Remote.mapByHash(App.state.sessions);
      const remoteSessions = new Set(manifest.sessions);
      for (const [hash, item] of sessionMap) {
        if (remoteSessions.has(hash)) continue;
        await Remote.verifyOrCreateImmutable(c, "sessions", hash, item);
        remoteSessions.add(hash);
        addedSessions++;
        changed = true;
      }
      manifest.sessions = [...remoteSessions].sort();

      const bodyMap = await Remote.mapByHash(App.state.body);
      const remoteBody = new Set(manifest.body);
      for (const [hash, item] of bodyMap) {
        if (remoteBody.has(hash)) continue;
        await Remote.verifyOrCreateImmutable(c, "body", hash, item);
        remoteBody.add(hash);
        addedBody++;
        changed = true;
      }
      manifest.body = [...remoteBody].sort();

      if (!remoteRev || meta.plansDirty) {
        await Remote.uploadPlans(c, App.state.plans, manifest, meta);
        changed = true;
      }

      if (changed) {
        await Remote.saveManifest(c, manifest, remote.sha);
        await writeMeta(meta);
        status(`同步完成：新增 ${addedSessions} 条训练、${addedBody} 条身体记录。`, true);
      } else {
        status("GitHub 已包含本机全部记录。", true);
      }
    } catch (error) {
      status(error.message, false);
    }
  }

  async function pull({ source = "settings" } = {}) {
    const c = config();
    try {
      await saveCredentials(false);
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

      let addedSessions = 0;
      let addedBody = 0;
      const sessionMap = await Remote.mapByHash(App.state.sessions);
      for (const hash of manifest.sessions) {
        if (sessionMap.has(hash)) continue;
        const item = await Remote.downloadImmutable(c, "sessions", hash);
        App.state.sessions.push(item);
        sessionMap.set(hash, item);
        addedSessions++;
      }

      const bodyMap = await Remote.mapByHash(App.state.body);
      for (const hash of manifest.body) {
        if (bodyMap.has(hash)) continue;
        const item = await Remote.downloadImmutable(c, "body", hash);
        App.state.body.push(item);
        bodyMap.set(hash, item);
        addedBody++;
      }

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

      const details = [
        plansChanged ? "计划已更新" : "计划已是最新",
        addedSessions ? `新增 ${addedSessions} 条训练` : "训练记录已是最新",
        addedBody ? `新增 ${addedBody} 条身体记录` : "身体数据已是最新",
        removed ? `清理 ${removed} 条旧重复记录` : ""
      ].filter(Boolean).join(" · ");
      status(details, true);
      return true;
    } catch (error) {
      applyingRemote = false;
      status(error.message, false);
      return false;
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
    if (quickPush) quickPush.onclick = () => runButton(quickPush, "同步中…", push);
    if (settingsPull) settingsPull.onclick = () => runButton(settingsPull, "合并中…", () => pull({ source: "settings" }));
    if (settingsPush) settingsPush.onclick = () => runButton(settingsPush, "同步中…", push);
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
  }

  App.registerPersistHook(async reason => {
    if (["plans", "import", "wipe"].includes(reason)) await refreshMeta();
  });
  App.registerModule({ init, onDataReset });
  App.sync = { push, pull, saveCredentials, hasCredentials, refreshMeta };
})();
