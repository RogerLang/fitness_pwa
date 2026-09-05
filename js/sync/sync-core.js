(() => {
  function create(App, Remote) {
    const NextWorkout = window.TrainingNextWorkout;
    if (!Remote || !NextWorkout) throw new Error("Sync dependencies must load before sync-v165.js");

    const CREDS_KEY = "syncCredentialsV7";
    const LEGACY_CONFIG_KEY = "syncConfig";
    const META_KEY = "syncMetaV11";
    const AUTO_CHECK_COOLDOWN_MS = 60000;
    const PLANNED_PATH = "planned-workout.json";
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    let applyingRemote = false;
    let autoInitialized = false;
    let autoChecking = false;
    let lastAutoCheckAt = 0;
    let savedCredentials = null;
    let suppressAutoPullCount = 0;
    let syncRunning = false;
    let persistHookRegistered = false;
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
      if (completeCredentials(merged) && !completeCredentials(primary)) await App.idbSet(CREDS_KEY, merged);
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
        today.textContent = message || "";
        today.className = `today-sync-status${ok === true ? " sync-ok" : ok === false ? " sync-error" : ""}${message ? " show" : ""}`;
      }
    }

    async function readMeta() {
      return await App.idbGet(META_KEY) || {};
    }

    async function writeMeta(meta) {
      await App.idbSet(META_KEY, meta);
      return meta;
    }

    function currentSchemaVersion() {
      return Number(App.schema?.version || 0);
    }

    function stampSchemaVersion(meta) {
      const version = currentSchemaVersion();
      if (version > 0) meta.schemaVersion = version;
      return meta;
    }

    function hasOwn(object, key) {
      return Object.prototype.hasOwnProperty.call(object, key);
    }

    async function refreshMeta() {
      if (!App.db) return {};
      const meta = await readMeta();
      const plansSig = await Remote.jsonSig(App.state.plans);
      const workout = NextWorkout.snapshot();
      const workoutSig = await Remote.jsonSig(workout);

      if (!meta.plansSig) {
        meta.plansSig = plansSig;
        meta.plansDirty = false;
        meta.plansBaseRevision = meta.plansBaseRevision || null;
      } else if (!applyingRemote && meta.plansSig !== plansSig) {
        meta.plansSig = plansSig;
        meta.plansDirty = true;
      }

      if (!hasOwn(meta, "plannedWorkoutSig")) {
        meta.plannedWorkoutSig = workoutSig;
        meta.plannedWorkoutBaseRevision = meta.plannedWorkoutBaseRevision || null;
        meta.plannedWorkoutDirty = !!workout;
      } else if (!applyingRemote && meta.plannedWorkoutSig !== workoutSig) {
        meta.plannedWorkoutSig = workoutSig;
        meta.plannedWorkoutDirty = true;
      }

      stampSchemaVersion(meta);
      return writeMeta(meta);
    }

    function templatesOnly(plans) {
      return (plans || []).map(plan => {
        const copy = JSON.parse(JSON.stringify(plan));
        delete copy.plannedWorkout;
        delete copy.pendingAssistantChange;
        return copy;
      });
    }

    async function reconcileSchemaMigrationDirty({ configValue = null, remoteState = null } = {}) {
      const version = currentSchemaVersion();
      const meta = await readMeta();
      if (!version || Number(meta.schemaVersion || 0) >= version) return meta;

      const localSig = await Remote.jsonSig(App.state.plans);
      if (!meta.plansDirty) {
        meta.plansSig = localSig;
        stampSchemaVersion(meta);
        return writeMeta(meta);
      }

      const c = configValue || await credentialsForSync();
      if (!configValue) await Remote.privateCheck(c);
      const remote = remoteState || await Remote.loadManifest(c);
      const remoteRev = remote.manifest?.plans?.revision || null;
      if (remote.exists && remoteRev) {
        const remotePlans = templatesOnly(await Remote.downloadPlans(c, remote.manifest));
        const remoteSig = await Remote.jsonSig(remotePlans);
        if (remoteSig === localSig) {
          meta.plansSig = localSig;
          meta.plansDirty = false;
          meta.plansBaseRevision = remoteRev;
        }
      }
      stampSchemaVersion(meta);
      return writeMeta(meta);
    }

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

    function apiHeaders(token) {
      return {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      };
    }

    async function apiRequest(url, token, options = {}) {
      const response = await fetch(url, { ...options, headers: { ...apiHeaders(token), ...(options.headers || {}) } });
      if (response.status === 404) return { status: 404, data: null };
      let data = null;
      try { data = await response.json(); } catch {}
      if (!response.ok) throw new Error(`GitHub API ${response.status}${data?.message ? `：${data.message}` : ""}`);
      return { status: response.status, data };
    }

    function fileUrl(config, path) {
      return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
    }

    async function getJson(config, path) {
      const response = await apiRequest(fileUrl(config, path), config.token);
      if (!response.data) return null;
      return { sha: response.data.sha, data: JSON.parse(decoder.decode(base64ToBytes(response.data.content))) };
    }

    async function putJson(config, path, data, sha, message) {
      const body = { message, content: bytesToBase64(encoder.encode(JSON.stringify(data, null, 2))) };
      if (sha) body.sha = sha;
      return apiRequest(fileUrl(config, path), config.token, { method: "PUT", body: JSON.stringify(body) });
    }

    function ensurePlannedManifest(manifest) {
      manifest.plannedWorkout ||= { path: PLANNED_PATH, revision: null };
      if (!manifest.plannedWorkout.path) manifest.plannedWorkout.path = PLANNED_PATH;
      return manifest.plannedWorkout;
    }

    async function uploadPlannedWorkout(config, manifest, meta) {
      const pointer = ensurePlannedManifest(manifest);
      const path = pointer.path || PLANNED_PATH;
      const old = await getJson(config, path);
      const revision = crypto.randomUUID();
      const workout = NextWorkout.snapshot();
      await putJson(config, path, {
        format: "fitness-planned-workout-v1",
        revision,
        updatedAt: new Date().toISOString(),
        workout
      }, old?.sha || null, "Update planned workout");
      manifest.plannedWorkout = { path, revision };
      meta.plannedWorkoutBaseRevision = revision;
      meta.plannedWorkoutDirty = false;
      meta.plannedWorkoutSig = await Remote.jsonSig(workout);
      return revision;
    }

    async function downloadPlannedWorkout(config, manifest) {
      const pointer = ensurePlannedManifest(manifest);
      if (!pointer.revision) return null;
      const file = await getJson(config, pointer.path || PLANNED_PATH);
      if (!file) throw new Error("云端当前待训练计划文件缺失");
      const payload = file.data;
      if (payload?.format !== "fitness-planned-workout-v1" || payload.revision !== pointer.revision) {
        throw new Error("云端当前待训练计划完整性检查失败");
      }
      return payload.workout && typeof payload.workout === "object" ? payload.workout : null;
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
        let meta = await readMeta();
        const remote = await Remote.loadManifest(c);
        ensurePlannedManifest(remote.manifest);
        meta = await reconcileSchemaMigrationDirty({ configValue: c, remoteState: remote });
        const manifest = remote.manifest;
        const remotePlansRevision = manifest.plans?.revision || null;
        const remoteWorkoutRevision = manifest.plannedWorkout?.revision || null;

        if (remote.exists && remotePlansRevision && meta.plansBaseRevision !== remotePlansRevision) {
          if (meta.plansDirty) throw new Error("本机和云端都修改过训练模板。请先从 GitHub 合并并选择要保留的模板。");
          throw new Error("云端训练模板有更新，请先从 GitHub 合并。");
        }
        if (remoteWorkoutRevision && meta.plannedWorkoutBaseRevision !== remoteWorkoutRevision) {
          if (meta.plannedWorkoutDirty) throw new Error("本机和云端都修改过当前待训练计划。请先从 GitHub 合并。");
          throw new Error("云端当前待训练计划有更新，请先从 GitHub 合并。");
        }

        status("正在增量同步新增记录…");
        const addedSessions = await pushImmutable(c, manifest, "sessions", App.state.sessions);
        const addedBody = await pushImmutable(c, manifest, "body", App.state.body);
        let changed = addedSessions > 0 || addedBody > 0;
        let plansUploaded = false;
        let plannedWorkoutUploaded = false;

        if (!remotePlansRevision || meta.plansDirty) {
          await Remote.uploadPlans(c, App.state.plans, manifest, meta);
          changed = true;
          plansUploaded = true;
        }

        if (meta.plannedWorkoutDirty || (!remoteWorkoutRevision && !!NextWorkout.snapshot())) {
          await uploadPlannedWorkout(c, manifest, meta);
          changed = true;
          plannedWorkoutUploaded = true;
        }

        if (changed) await Remote.saveManifest(c, manifest, remote.sha);
        stampSchemaVersion(meta);
        await writeMeta(meta);

        const parts = [];
        if (addedSessions) parts.push(`新增 ${addedSessions} 条训练`);
        if (addedBody) parts.push(`新增 ${addedBody} 条身体记录`);
        if (plansUploaded) parts.push("训练模板已同步");
        if (plannedWorkoutUploaded) parts.push("当前待训练已同步");
        const message = parts.length ? `同步完成：${parts.join(" · ")}` : "GitHub 已包含本机全部记录。";
        status(message, true);
        return { ok: true, kind: "push", changed, plansUploaded, plannedWorkoutUploaded, addedSessions, addedBody, message };
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
        status(source === "today" ? "正在刷新训练模板、待训练计划和训练记录…" : "正在读取 GitHub 数据…");
        await Remote.privateCheck(c);
        await ensureIds();
        await refreshMeta();
        let meta = await readMeta();
        const remote = await Remote.loadManifest(c);
        if (!remote.exists) throw new Error("GitHub 还没有同步数据，请先在有完整数据的设备执行增量同步。");
        ensurePlannedManifest(remote.manifest);
        meta = await reconcileSchemaMigrationDirty({ configValue: c, remoteState: remote });
        const manifest = remote.manifest;
        const remotePlansRevision = manifest.plans?.revision || null;
        const remoteWorkoutRevision = manifest.plannedWorkout?.revision || null;
        const oldPlanName = App.training?.currentPlanName || "";
        const forcePlans = App.state.plans.length === 0 && !!remotePlansRevision;
        const plansChanged = !!remotePlansRevision && (forcePlans || meta.plansBaseRevision !== remotePlansRevision);
        const plannedWorkoutChanged = !!remoteWorkoutRevision && meta.plannedWorkoutBaseRevision !== remoteWorkoutRevision;

        if ((plansChanged || plannedWorkoutChanged) && App.training?.hasDraft()) {
          throw new Error("当前还有未保存的训练输入。请先保存本次训练或清空输入，再更新训练数据。");
        }
        if (plansChanged && meta.plansDirty) {
          const useCloud = confirm("本机训练模板也有修改。继续会使用 GitHub 最新模板覆盖本机模板；训练历史会保留。继续？");
          if (!useCloud) throw new Error("已取消，保留本机训练模板。");
        }
        if (plannedWorkoutChanged && meta.plannedWorkoutDirty) {
          const useCloud = confirm("本机当前待训练计划也有修改。继续会使用 GitHub 最新待训练计划覆盖本机。继续？");
          if (!useCloud) throw new Error("已取消，保留本机当前待训练计划。");
        }

        let nextPlans = App.state.plans;
        let legacyPlannedWorkout = null;
        if (plansChanged) {
          nextPlans = await Remote.downloadPlans(c, manifest);
          const legacy = NextWorkout.extractLegacy(nextPlans);
          legacyPlannedWorkout = legacy.workout;
        }

        let incomingPlannedWorkout = null;
        if (plannedWorkoutChanged) incomingPlannedWorkout = await downloadPlannedWorkout(c, manifest);

        const addedSessions = await pullImmutable(c, manifest, "sessions", App.state.sessions);
        const addedBody = await pullImmutable(c, manifest, "body", App.state.body);

        applyingRemote = true;
        try {
          if (plansChanged) App.state.plans = nextPlans;
          if (plannedWorkoutChanged) {
            await NextWorkout.setFromRemote(incomingPlannedWorkout);
          } else if (!remoteWorkoutRevision && legacyPlannedWorkout && !NextWorkout.snapshot()) {
            await NextWorkout.setFromRemote(legacyPlannedWorkout);
          }
          const removed = await App.training?.cleanupDuplicates({ persistChanges: false }) || 0;
          await App.persist("remote");

          if (plansChanged) {
            meta.plansBaseRevision = remotePlansRevision;
            meta.plansDirty = false;
            meta.plansSig = await Remote.jsonSig(App.state.plans);
          }
          if (plannedWorkoutChanged) {
            meta.plannedWorkoutBaseRevision = remoteWorkoutRevision;
            meta.plannedWorkoutDirty = false;
            meta.plannedWorkoutSig = await Remote.jsonSig(NextWorkout.snapshot());
          } else if (!remoteWorkoutRevision && legacyPlannedWorkout) {
            meta.plannedWorkoutBaseRevision = null;
            meta.plannedWorkoutSig = await Remote.jsonSig(NextWorkout.snapshot());
            meta.plannedWorkoutDirty = !!NextWorkout.snapshot();
          }

          stampSchemaVersion(meta);
          await writeMeta(meta);
          await App.training?.prepareRemotePlans(oldPlanName, plansChanged);
          await App.refresh("remote");

          const updates = [
            plansChanged ? "训练模板已更新" : "",
            plannedWorkoutChanged || (!remoteWorkoutRevision && legacyPlannedWorkout) ? "当前待训练已更新" : "",
            addedSessions ? `新增 ${addedSessions} 条训练` : "",
            addedBody ? `新增 ${addedBody} 条身体记录` : "",
            removed ? `清理 ${removed} 条旧重复记录` : "",
            meta.plansDirty ? "本机模板有未同步修改" : "",
            meta.plannedWorkoutDirty ? "本机待训练计划有未同步修改" : ""
          ].filter(Boolean);
          const message = updates.length ? updates.join(" · ") : "训练数据已是最新";
          status(message, meta.plansDirty || meta.plannedWorkoutDirty ? null : true);
          return {
            ok: true,
            kind: "pull",
            plansChanged,
            plannedWorkoutChanged,
            plansDirty: !!meta.plansDirty,
            plannedWorkoutDirty: !!meta.plannedWorkoutDirty,
            addedSessions,
            addedBody,
            removed,
            message
          };
        } finally {
          applyingRemote = false;
        }
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

    async function localFormalDirty() {
      const meta = await refreshMeta();
      return !!(meta.plansDirty || meta.plannedWorkoutDirty);
    }

    async function checkLatest() {
      if (!autoInitialized || autoChecking || Date.now() - lastAutoCheckAt < AUTO_CHECK_COOLDOWN_MS) return { ok: true, skipped: "cooldown" };
      if (suppressAutoPullCount > 0) {
        suppressAutoPullCount--;
        return { ok: true, skipped: "suppressed" };
      }
      if (App.training?.hasDraft?.()) return { ok: true, skipped: "training-draft" };
      if (!await hasCredentials()) return { ok: true, skipped: "no-credentials" };

      autoChecking = true;
      lastAutoCheckAt = Date.now();
      try {
        await reconcileSchemaMigrationDirty();
        if (await localFormalDirty()) {
          const message = "本机有未同步的训练模板或待训练计划";
          status(message);
          return { ok: true, skipped: "local-formal-dirty", message };
        }
        return await pull({ source: "today" });
      } catch (error) {
        const message = error?.message || "同步失败";
        status(message, false);
        return { ok: false, kind: "auto-check", message, error };
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
      if (reason === "wipe") {
        const meta = stampSchemaVersion({
          plansBaseRevision: null,
          plansDirty: false,
          plansSig: await Remote.jsonSig([]),
          plannedWorkoutBaseRevision: null,
          plannedWorkoutDirty: false,
          plannedWorkoutSig: await Remote.jsonSig(null)
        });
        await writeMeta(meta);
      } else if (reason === "import") {
        await refreshMeta();
      }
    }

    function registerPersistHook() {
      if (persistHookRegistered) return;
      persistHookRegistered = true;
      App.registerPersistHook(async reason => {
        if (["plans", "import", "wipe", "workout", "planned-workout"].includes(reason)) await refreshMeta();
      });
    }

    async function init() {
      await loadCredentials();
      registerPersistHook();
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

    return { init, onPage, onDataReset, push, pull, hasCredentials, suppressNextAutoPull, refreshMeta };
  }

  window.FitnessSyncV165 = Object.freeze({ create });
})();
