(() => {
  const App = window.FitnessApp;
  if (!App) return;

  const PRIMARY_CREDS_KEY = "syncCredentialsV7";
  const LEGACY_CONFIG_KEY = "syncConfig";
  const SYNC_META_KEY = "syncMetaV11";
  const PROPOSAL_PATH = "assistant-proposal.json";
  const REFRESH_COOLDOWN_MS = 15000;
  const ACTION_IDS = new Set([
    "planningPushTopBtn",
    "planningPushBottomBtn",
    "planningGoTrainTopBtn",
    "planningGoTrainBtn"
  ]);

  const clone = value => JSON.parse(JSON.stringify(value));
  const decoder = new TextDecoder();

  let proposal = null;
  let loadPromise = null;
  let lastLoadedAt = 0;
  let preparedProposalId = "";
  let autoSelectedProposalId = "";
  let initialized = false;
  let busy = false;

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

  async function readCredentials() {
    const primary = normalizeCredentials(await App.idbGet(PRIMARY_CREDS_KEY) || {});
    const legacy = normalizeCredentials(await App.idbGet(LEGACY_CONFIG_KEY) || {});
    return {
      owner: primary.owner || legacy.owner,
      repo: primary.repo || legacy.repo,
      token: primary.token || legacy.token
    };
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
    const response = await fetch(url, {
      ...options,
      headers: { ...apiHeaders(token), ...(options.headers || {}) }
    });
    if (response.status === 404) return { status: 404, data: null };
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(`GitHub API ${response.status}${data?.message ? `：${data.message}` : ""}`);
    return { status: response.status, data };
  }

  function fileUrl(config, path) {
    const parts = path.split("/").map(encodeURIComponent).join("/");
    return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${parts}`;
  }

  function decodeBase64Json(content) {
    const text = atob(String(content || "").replace(/\s/g, ""));
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return JSON.parse(decoder.decode(bytes));
  }

  async function getJson(config, path) {
    const response = await apiRequest(fileUrl(config, path), config.token);
    if (!response.data) return null;
    return { sha: response.data.sha, data: decodeBase64Json(response.data.content) };
  }

  async function deleteJson(config, path, sha, message) {
    if (!sha) return;
    await apiRequest(fileUrl(config, path), config.token, {
      method: "DELETE",
      body: JSON.stringify({ message, sha })
    });
  }

  async function assertPrivateRepository(config) {
    const response = await apiRequest(
      `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`,
      config.token
    );
    if (!response.data || response.data.private !== true || response.data.visibility !== "private") {
      throw new Error("助手计划提案只允许从 Private GitHub 仓库读取");
    }
  }

  function findTargetIndex(payload) {
    const targetId = String(payload?.targetPlanId || "").trim();
    const targetName = String(payload?.targetPlanName || "").trim();
    let index = -1;
    if (targetId) index = App.state.plans.findIndex(plan => String(plan?.planId || "").trim() === targetId);
    if (index < 0 && targetName) index = App.state.plans.findIndex(plan => String(plan?.name || "") === targetName);
    return index;
  }

  function normalizeCandidate(payload, index) {
    const live = App.state.plans[index];
    const proposed = payload?.proposedPlan;
    if (!live || !proposed || typeof proposed !== "object" || Array.isArray(proposed)) {
      throw new Error("助手计划提案缺少完整 proposedPlan");
    }

    const merged = {
      ...clone(live),
      ...clone(proposed),
      planId: live.planId || proposed.planId
    };
    if (live.plannedWorkout) merged.plannedWorkout = clone(live.plannedWorkout);
    else delete merged.plannedWorkout;
    delete merged.pendingAssistantChange;

    const candidate = App.schema?.normalizePlan ? App.schema.normalizePlan(merged) : merged;
    candidate.planId = live.planId || candidate.planId;
    if (live.plannedWorkout) candidate.plannedWorkout = clone(live.plannedWorkout);
    else delete candidate.plannedWorkout;

    const ids = new Set();
    for (const exercise of candidate.exercises || []) {
      const id = String(exercise?.exerciseId || "").trim();
      if (!id) throw new Error("候选模板存在缺少 exerciseId 的动作");
      if (ids.has(id)) throw new Error("候选模板存在重复 exerciseId");
      ids.add(id);
    }
    return candidate;
  }

  function normalizeProposal(file, manifest, config, syncMeta = {}) {
    const payload = file?.data;
    if (!payload || payload.format !== "fitness-assistant-proposal-v1") throw new Error("助手计划提案格式不支持");
    const id = String(payload.id || "").trim();
    const basePlansRevision = String(payload.basePlansRevision || "").trim();
    if (!id || !basePlansRevision) throw new Error("助手计划提案缺少 id 或 basePlansRevision");

    const index = findTargetIndex(payload);
    const remoteRevision = String(manifest?.plans?.revision || "").trim();
    const summary = String(payload.summary || "训练模板已调整").trim() || "训练模板已调整";
    const changes = Array.isArray(payload.changes)
      ? payload.changes.map(item => String(item || "").trim()).filter(Boolean).slice(0, 8)
      : [];

    if (syncMeta?.plansDirty) {
      return {
        id,
        sha: file.sha,
        config,
        stale: true,
        index,
        summary,
        changes,
        reason: "本机训练模板有未同步修改，请先处理本机与云端计划冲突。"
      };
    }
    const localBaseRevision = String(syncMeta?.plansBaseRevision || "").trim();
    if (localBaseRevision && localBaseRevision !== basePlansRevision) {
      return {
        id,
        sha: file.sha,
        config,
        stale: true,
        index,
        summary,
        changes,
        reason: "本机训练模板还没有同步到这份修改的基线，请先检查最新计划。"
      };
    }

    if (basePlansRevision !== remoteRevision) {
      return {
        id,
        sha: file.sha,
        config,
        stale: true,
        index,
        summary,
        changes,
        reason: "这份修改基于旧版训练模板，请在聊天中重新生成。"
      };
    }
    if (index < 0) {
      return {
        id,
        sha: file.sha,
        config,
        stale: true,
        index,
        summary,
        changes,
        reason: "找不到这份修改对应的训练模板。"
      };
    }

    return {
      id,
      sha: file.sha,
      config,
      stale: false,
      approved: false,
      index,
      summary,
      changes,
      createdAt: String(payload.createdAt || ""),
      basePlansRevision,
      candidate: normalizeCandidate(payload, index)
    };
  }

  async function loadProposal({ force = false } = {}) {
    if (!force && Date.now() - lastLoadedAt < REFRESH_COOLDOWN_MS) return proposal;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      try {
        const config = await readCredentials();
        if (!completeCredentials(config)) {
          proposal = null;
          return null;
        }
        await assertPrivateRepository(config);
        const [manifestFile, proposalFile, syncMeta] = await Promise.all([
          getJson(config, "manifest.json"),
          getJson(config, PROPOSAL_PATH),
          App.idbGet(SYNC_META_KEY)
        ]);
        lastLoadedAt = Date.now();
        if (!proposalFile) {
          proposal = null;
          preparedProposalId = "";
          return null;
        }
        if (!manifestFile?.data || manifestFile.data.format !== "fitness-pwa-manifest-v3") {
          throw new Error("云端 manifest 格式不支持");
        }

        const next = normalizeProposal(proposalFile, manifestFile.data, config, syncMeta || {});
        if (proposal?.id === next.id && proposal?.sha === next.sha && !next.stale) {
          next.approved = !!proposal.approved;
        } else {
          preparedProposalId = "";
          autoSelectedProposalId = "";
        }
        proposal = next;
        return proposal;
      } catch (error) {
        console.warn("assistant proposal load", error);
        return proposal;
      } finally {
        loadPromise = null;
      }
    })();

    return loadPromise;
  }

  function selectedIndex() {
    const select = document.getElementById("planningPlanSelect");
    const index = Number(select?.value ?? -1);
    return Number.isInteger(index) ? index : -1;
  }

  function isTargetSelected() {
    return !!proposal && proposal.index >= 0 && selectedIndex() === proposal.index;
  }

  function currentPendingText() {
    const live = proposal?.index >= 0 ? App.state.plans[proposal.index] : null;
    const workout = live?.plannedWorkout;
    if (workout?.status === "confirmed") return `当前待训练仍保留：${workout.planName || live.name || "本次训练"}`;
    return "当前待训练计划不会在确认前改变";
  }

  function decorateStale() {
    if (!proposal?.stale || !isTargetSelected()) return;
    const root = document.getElementById("planningCurrentPlan");
    if (!root) return;
    root.className = "planning-current assistant-proposal";
    root.innerHTML = `
      <span>ChatGPT 修改 · 已过期</span>
      <strong>${App.esc(proposal.summary)}</strong>
      <small>${App.esc(proposal.reason || "请重新生成修改。")}</small>
      <div class="planning-proposal-actions">
        <button type="button" class="secondary" data-assistant-dismiss>忽略这份修改</button>
      </div>
    `;
  }

  function setPendingControls() {
    const pending = !!proposal && !proposal.stale && isTargetSelected();
    if (!pending) return;

    const allowCommit = !!proposal.approved && !busy;
    for (const id of ACTION_IDS) {
      const button = document.getElementById(id);
      if (button) button.disabled = !allowCommit;
    }
    const regenerate = document.getElementById("planningRegenerateBtn");
    if (regenerate) regenerate.disabled = true;
    const addExercise = document.getElementById("planningAddExerciseBtn");
    if (addExercise) addExercise.disabled = true;
    document.querySelectorAll("#planningTemplateList input,#planningTemplateList select,#planningTemplateList textarea,#planningTemplateList button")
      .forEach(control => { control.disabled = true; });
  }

  function decorateProposal() {
    if (!proposal || proposal.stale || !isTargetSelected()) return;
    const root = document.getElementById("planningCurrentPlan");
    if (!root) return;
    const detail = proposal.changes.length ? proposal.changes.join(" · ") : "已生成候选模板和候选训练计划";
    const stateText = proposal.approved
      ? "修改已确认；点击“推送计划”或“去训练”后正式写入模板和本次计划。"
      : `${detail} · ${currentPendingText()}`;
    root.className = "planning-current assistant-proposal";
    root.innerHTML = `
      <span>${proposal.approved ? "ChatGPT 修改 · 已确认" : "ChatGPT 已调整 · 待确认"}</span>
      <strong>${App.esc(proposal.summary)}</strong>
      <small>${App.esc(stateText)}</small>
      <div class="planning-proposal-actions">
        ${proposal.approved
          ? '<button type="button" class="secondary" data-assistant-unapprove>取消确认</button><button type="button" disabled>请使用下方推送/训练按钮</button>'
          : '<button type="button" class="secondary" data-assistant-dismiss>忽略</button><button type="button" data-assistant-approve>确认修改</button>'}
      </div>
    `;

    const shell = document.querySelector("#plan .planning-template-shell");
    const list = document.getElementById("planningTemplateList");
    if (shell?.open && list && !list.querySelector(".planning-proposal-note")) {
      list.insertAdjacentHTML("afterbegin", '<p class="planning-proposal-note">这里显示的是 ChatGPT 候选模板预览。确认并推送前，不会改写正式模板。</p>');
    }
    setPendingControls();
  }

  function renderPreview({ selectTarget = false } = {}) {
    if (!initialized || !proposal || !App.planning?.render) return;
    const select = document.getElementById("planningPlanSelect");
    if (selectTarget && proposal.index >= 0 && autoSelectedProposalId !== proposal.id && select && !select.disabled) {
      select.value = String(proposal.index);
      autoSelectedProposalId = proposal.id;
    }
    if (!isTargetSelected()) return;

    if (proposal.stale) {
      decorateStale();
      return;
    }

    const index = proposal.index;
    const live = App.state.plans[index];
    if (!live) return;
    const previewPlan = clone(proposal.candidate);
    delete previewPlan.plannedWorkout;

    App.state.plans[index] = previewPlan;
    try {
      if (preparedProposalId !== proposal.id) App.planning.invalidate(index);
      App.planning.render();
      preparedProposalId = proposal.id;
    } finally {
      App.state.plans[index] = live;
    }
    decorateProposal();
  }

  function schedulePreview(options = {}) {
    queueMicrotask(() => requestAnimationFrame(() => renderPreview(options)));
  }

  async function dismissProposal() {
    if (!proposal || busy) return;
    busy = true;
    try {
      await deleteJson(proposal.config, PROPOSAL_PATH, proposal.sha, "Dismiss assistant training plan proposal");
      const index = proposal.index;
      proposal = null;
      preparedProposalId = "";
      autoSelectedProposalId = "";
      if (index >= 0) App.planning?.invalidate?.(index);
      App.planning?.render?.();
      App.toast("已忽略 ChatGPT 的模板修改", "success");
    } catch (error) {
      App.toast(error?.message || "无法忽略这份修改", "error");
    } finally {
      busy = false;
    }
  }

  function approveProposal() {
    if (!proposal || proposal.stale || busy) return;
    proposal.approved = true;
    decorateProposal();
  }

  function unapproveProposal() {
    if (!proposal || proposal.stale || busy) return;
    proposal.approved = false;
    decorateProposal();
  }

  async function cleanupRemoteProposal(snapshot) {
    try {
      await deleteJson(snapshot.config, PROPOSAL_PATH, snapshot.sha, "Apply assistant training plan proposal");
    } catch (error) {
      console.warn("assistant proposal cleanup", error);
    }
  }

  async function finalizeProposal({ goTrain = false } = {}) {
    if (!proposal || proposal.stale || !proposal.approved || busy || !isTargetSelected()) return;
    const snapshot = proposal;
    const index = snapshot.index;
    const original = App.state.plans[index];
    if (!original) return;

    busy = true;
    setPendingControls();
    const candidate = clone(snapshot.candidate);
    if (original.plannedWorkout) candidate.plannedWorkout = clone(original.plannedWorkout);
    else delete candidate.plannedWorkout;
    App.state.plans[index] = candidate;

    try {
      const pushed = await App.planning.pushPlan({ sync: false });
      if (!pushed) {
        App.state.plans[index] = original;
        schedulePreview();
        return;
      }

      if (goTrain) {
        await App.switchPage("today", { historyMode: "replace" });
        App.toast("训练计划已载入，正在同步 ChatGPT 修改", "success");
      }

      const syncResult = await App.sync?.push?.({ priority: true });
      if (!syncResult?.ok) {
        App.toast("本机已应用修改，但 GitHub 同步未完成；稍后可再次同步", "error");
        return;
      }

      await cleanupRemoteProposal(snapshot);
      proposal = null;
      preparedProposalId = "";
      autoSelectedProposalId = "";
      if (!goTrain) {
        App.planning?.render?.();
        App.toast("ChatGPT 修改已应用并同步", "success");
      }
    } catch (error) {
      App.toast(error?.message || "应用 ChatGPT 修改失败", "error");
    } finally {
      busy = false;
      if (!goTrain && proposal) schedulePreview();
    }
  }

  function handleClickCapture(event) {
    const button = event.target.closest("button");
    if (!button || !proposal || !isTargetSelected()) return;

    if (button.matches("[data-assistant-approve]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      approveProposal();
      return;
    }
    if (button.matches("[data-assistant-unapprove]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      unapproveProposal();
      return;
    }
    if (button.matches("[data-assistant-dismiss]")) {
      event.preventDefault();
      event.stopImmediatePropagation();
      dismissProposal();
      return;
    }

    if (!proposal.approved || !ACTION_IDS.has(button.id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    finalizeProposal({ goTrain: button.id === "planningGoTrainTopBtn" || button.id === "planningGoTrainBtn" });
  }

  function bindEvents() {
    document.addEventListener("click", handleClickCapture, true);
    document.getElementById("planningPlanSelect")?.addEventListener("change", () => schedulePreview());
    document.querySelector("#plan .planning-template-shell")?.addEventListener("toggle", () => schedulePreview());
  }

  async function init() {
    bindEvents();
    initialized = true;
    loadProposal({ force: true }).then(() => schedulePreview({ selectTarget: true })).catch(() => {});
  }

  function refresh(reason) {
    schedulePreview();
    if (reason === "remote") loadProposal({ force: true }).then(() => schedulePreview()).catch(() => {});
  }

  function onPage(id) {
    if (id !== "plan") return;
    schedulePreview({ selectTarget: true });
    const force = Date.now() - lastLoadedAt >= REFRESH_COOLDOWN_MS;
    loadProposal({ force }).then(() => schedulePreview({ selectTarget: true })).catch(() => {});
  }

  async function onDataReset() {
    proposal = null;
    preparedProposalId = "";
    autoSelectedProposalId = "";
  }

  App.assistantPlans = {
    refresh: () => loadProposal({ force: true }),
    current: () => proposal
  };
  App.registerModule({ pages: ["plan"], init, refresh, onPage, onDataReset });
})();
