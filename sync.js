(() => {
  const App = window.FitnessApp;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const CREDS_KEY = "syncCredentialsV7";
  const META_KEY = "syncMetaV11";
  let applyingRemote = false;
  let todayStatusTimer = null;

  function bytesToBase64(bytes) {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
  }

  function base64ToBytes(value) {
    const text = atob(String(value || "").replace(/\s/g, ""));
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
  }

  function config() {
    return {
      owner: document.getElementById("syncOwner")?.value.trim() || "",
      repo: document.getElementById("syncRepo")?.value.trim() || "",
      token: document.getElementById("syncToken")?.value.trim() || ""
    };
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

  function headers(token) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    };
  }

  async function gh(url, token, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...headers(token), ...(options.headers || {}) } });
    if (response.status === 404) return { status: 404, data: null };
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(`GitHub API ${response.status}${data?.message ? `：${data.message}` : ""}`);
    return { status: response.status, data };
  }

  function fileUrl(c, path) {
    return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  async function privateCheck(c) {
    if (!c.owner || !c.repo || !c.token) throw new Error("请填写 GitHub 用户名、Private 仓库和 Token。");
    const { data } = await gh(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`, c.token);
    if (!data) throw new Error("找不到同步仓库");
    if (data.private !== true || data.visibility !== "private") throw new Error("安全检查拒绝：同步目标必须是 Private repository");
  }

  async function getJson(c, path) {
    const response = await gh(fileUrl(c, path), c.token);
    if (!response.data) return null;
    return { sha: response.data.sha, data: JSON.parse(decoder.decode(base64ToBytes(response.data.content))) };
  }

  async function putJson(c, path, data, sha = null, message = "Update fitness sync data") {
    const body = { message, content: bytesToBase64(encoder.encode(JSON.stringify(data, null, 2))) };
    if (sha) body.sha = sha;
    return gh(fileUrl(c, path), c.token, { method: "PUT", body: JSON.stringify(body) });
  }

  async function hexDigest(text) {
    const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(String(text)));
    return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }

  const jsonSig = value => hexDigest(JSON.stringify(value));
  const itemHash = id => hexDigest(id);
  const now = () => new Date().toISOString();

  async function readMeta() { return await App.idbGet(META_KEY) || {}; }
  async function writeMeta(meta) { await App.idbSet(META_KEY, meta); return meta; }

  async function refreshMeta() {
    if (!App.db) return {};
    const meta = await readMeta();
    const sig = await jsonSig(App.state.plans);
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

  function emptyManifest() {
    return {
      format: "fitness-pwa-manifest-v3",
      updatedAt: now(),
      plans: { path: "plans.json", revision: null },
      sessions: [],
      body: []
    };
  }

  function validateManifest(manifest) {
    if (!manifest || manifest.format !== "fitness-pwa-manifest-v3") throw new Error("云端同步格式不支持。");
    manifest.plans ||= { path: "plans.json", revision: null };
    if (!Array.isArray(manifest.sessions)) manifest.sessions = [];
    if (!Array.isArray(manifest.body)) manifest.body = [];
    return manifest;
  }

  async function loadManifest(c) {
    const file = await getJson(c, "manifest.json");
    if (!file) return { manifest: emptyManifest(), sha: null, exists: false };
    return { manifest: validateManifest(file.data), sha: file.sha, exists: true };
  }

  async function saveManifest(c, manifest, sha) {
    manifest.updatedAt = now();
    await putJson(c, "manifest.json", manifest, sha, "Update fitness manifest");
  }

  async function ensureIds() {
    let changed = false;
    for (const session of App.state.sessions) if (!session.id) { session.id = crypto.randomUUID(); changed = true; }
    for (const body of App.state.body) if (!body.id) { body.id = crypto.randomUUID(); changed = true; }
    if (changed) await App.persist("ids");
  }

  async function mapByHash(items) {
    const map = new Map();
    for (const item of items) map.set(await itemHash(item.id), item);
    return map;
  }

  async function verifyOrCreateImmutable(c, kind, hash, item) {
    const path = `${kind}/${hash}.json`;
    const old = await getJson(c, path);
    const expected = kind === "sessions" ? "fitness-session-v2" : "fitness-body-entry-v2";
    if (old) {
      const remoteItem = kind === "sessions" ? old.data?.session : old.data?.entry;
      if (old.data?.format !== expected || !remoteItem?.id || await itemHash(remoteItem.id) !== hash) throw new Error(`${kind === "sessions" ? "训练" : "身体"}记录完整性检查失败`);
      return false;
    }
    const payload = kind === "sessions"
      ? { format: "fitness-session-v2", session: item }
      : { format: "fitness-body-entry-v2", entry: item };
    await putJson(c, path, payload, null, kind === "sessions" ? "Add workout session" : "Add body entry");
    return true;
  }

  async function downloadImmutable(c, kind, hash) {
    const file = await getJson(c, `${kind}/${hash}.json`);
    if (!file) throw new Error(`云端文件缺失：${hash.slice(0, 8)}…`);
    const expected = kind === "sessions" ? "fitness-session-v2" : "fitness-body-entry-v2";
    const item = kind === "sessions" ? file.data?.session : file.data?.entry;
    if (file.data?.format !== expected || !item?.id || await itemHash(item.id) !== hash) throw new Error("云端记录完整性检查失败");
    return item;
  }

  async function uploadPlans(c, manifest, meta) {
    const path = "plans.json";
    const old = await getJson(c, path);
    const revision = crypto.randomUUID();
    await putJson(c, path, {
      format: "fitness-plans-v3",
      revision,
      updatedAt: now(),
      plans: App.state.plans
    }, old?.sha || null, "Update training plans");
    manifest.plans = { path, revision };
    meta.plansBaseRevision = revision;
    meta.plansDirty = false;
    meta.plansSig = await jsonSig(App.state.plans);
  }

  async function downloadPlans(c, manifest) {
    const file = await getJson(c, manifest.plans?.path || "plans.json");
    if (!file) throw new Error("云端计划文件缺失");
    const payload = file.data;
    if (payload?.format !== "fitness-plans-v3" || payload.revision !== manifest.plans.revision || !Array.isArray(payload.plans)) throw new Error("云端训练计划完整性检查失败");
    return payload.plans;
  }

  async function saveCredentials(showStatus = false) {
    const c = config();
    if (showStatus && (!c.owner || !c.repo || !c.token)) {
      status("请先填写 GitHub 用户名、Private 仓库和 Token。", false);
      return false;
    }
    await App.idbSet(CREDS_KEY, c);
    await App.idbSet("syncConfig", { owner: c.owner, repo: c.repo });
    if (showStatus) status("GitHub 同步信息已保存在当前设备。", true);
    return true;
  }

  async function loadCredentials() {
    const saved = await App.idbGet(CREDS_KEY) || await App.idbGet("syncConfig") || {};
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
      await privateCheck(c);
      await ensureIds();
      await refreshMeta();
      const meta = await readMeta();
      const remote = await loadManifest(c);
      const manifest = remote.manifest;
      const remoteRev = manifest.plans?.revision || null;

      if (remote.exists && remoteRev && meta.plansBaseRevision !== remoteRev) {
        if (meta.plansDirty) throw new Error("本机和云端都修改过训练计划。请先从 GitHub 合并并选择要保留的计划。");
        throw new Error("云端训练计划有更新，请先从 GitHub 合并。");
      }

      let changed = false, addedSessions = 0, addedBody = 0;
      status("正在增量同步新增记录…");

      const sessionMap = await mapByHash(App.state.sessions);
      const remoteSessions = new Set(manifest.sessions);
      for (const [hash, item] of sessionMap) {
        if (remoteSessions.has(hash)) continue;
        await verifyOrCreateImmutable(c, "sessions", hash, item);
        remoteSessions.add(hash); addedSessions++; changed = true;
      }
      manifest.sessions = [...remoteSessions].sort();

      const bodyMap = await mapByHash(App.state.body);
      const remoteBody = new Set(manifest.body);
      for (const [hash, item] of bodyMap) {
        if (remoteBody.has(hash)) continue;
        await verifyOrCreateImmutable(c, "body", hash, item);
        remoteBody.add(hash); addedBody++; changed = true;
      }
      manifest.body = [...remoteBody].sort();

      if (!remoteRev || meta.plansDirty) {
        await uploadPlans(c, manifest, meta);
        changed = true;
      }

      if (changed) {
        await saveManifest(c, manifest, remote.sha);
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
      await privateCheck(c);
      await ensureIds();
      await refreshMeta();
      const meta = await readMeta();
      const remote = await loadManifest(c);
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
      if (plansChanged) nextPlans = await downloadPlans(c, manifest);

      let addedSessions = 0, addedBody = 0;
      const sessionMap = await mapByHash(App.state.sessions);
      for (const hash of manifest.sessions) {
        if (sessionMap.has(hash)) continue;
        const item = await downloadImmutable(c, "sessions", hash);
        App.state.sessions.push(item); sessionMap.set(hash, item); addedSessions++;
      }
      const bodyMap = await mapByHash(App.state.body);
      for (const hash of manifest.body) {
        if (bodyMap.has(hash)) continue;
        const item = await downloadImmutable(c, "body", hash);
        App.state.body.push(item); bodyMap.set(hash, item); addedBody++;
      }

      if (plansChanged) App.state.plans = nextPlans;
      const removed = await App.training?.cleanupDuplicates({ persistChanges: false }) || 0;
      if (plansChanged) {
        meta.plansBaseRevision = remoteRev;
        meta.plansDirty = false;
        meta.plansSig = await jsonSig(App.state.plans);
      }

      applyingRemote = true;
      try { await App.persist("remote"); }
      finally { applyingRemote = false; }
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
    try { await task(); }
    finally { button.disabled = false; button.textContent = old; }
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
    await writeMeta({ plansBaseRevision: null, plansDirty: false, plansSig: await jsonSig([]) });
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
  App.sync = { push, pull, saveCredentials, refreshMeta };
})();
