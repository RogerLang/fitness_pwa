(() => {
  function create(App) {
    const Repo = window.FitnessGitHubPrivateRepo;
    if (!Repo) throw new Error("FitnessGitHubPrivateRepo must load before assistant-proposals-core.js");

    const PRIMARY_CREDS_KEY = "syncCredentialsV7";
    const LEGACY_CONFIG_KEY = "syncConfig";
    const SYNC_META_KEY = "syncMetaV11";
    const PROPOSAL_PATH = "assistant-proposal.json";
    const REFRESH_COOLDOWN_MS = 15000;
    const ACTION_IDS = ["planningPushTopBtn", "planningPushBottomBtn", "planningGoTrainTopBtn", "planningGoTrainBtn"];
    const clone = value => JSON.parse(JSON.stringify(value));
    const normalizedId = value => String(value || "").trim();

    let proposal = null;
    let loadPromise = null;
    let lastLoadedAt = 0;
    let autoSelectedProposalId = "";
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

    function planIndexById(planId) {
      const id = normalizedId(planId);
      return id ? App.state.plans.findIndex(plan => normalizedId(plan?.planId) === id) : -1;
    }

    function targetPlan(payload) {
      const targetId = normalizedId(payload?.targetPlanId);
      const targetName = String(payload?.targetPlanName || "").trim();
      let live = targetId ? App.state.plans.find(plan => normalizedId(plan?.planId) === targetId) || null : null;
      if (!live && targetName) live = App.state.plans.find(plan => String(plan?.name || "") === targetName) || null;
      return { live, targetPlanId: normalizedId(live?.planId) || targetId };
    }

    function normalizeCandidate(payload, live) {
      const proposed = payload?.proposedPlan;
      if (!live || !proposed || typeof proposed !== "object" || Array.isArray(proposed)) throw new Error("助手计划提案缺少完整 proposedPlan");
      const merged = { ...clone(live), ...clone(proposed), planId: live.planId || proposed.planId };
      delete merged.plannedWorkout;
      delete merged.pendingAssistantChange;
      const candidate = App.schema?.normalizePlan ? App.schema.normalizePlan(merged) : merged;
      candidate.planId = live.planId || candidate.planId;
      delete candidate.plannedWorkout;
      delete candidate.pendingAssistantChange;

      const ids = new Set();
      for (const exercise of candidate.exercises || []) {
        const id = normalizedId(exercise?.exerciseId);
        if (!id) throw new Error("候选模板存在缺少 exerciseId 的动作");
        if (ids.has(id)) throw new Error("候选模板存在重复 exerciseId");
        ids.add(id);
      }
      return candidate;
    }

    function staleResult(base, reason) {
      return { ...base, stale: true, reason };
    }

    function normalizeProposal(file, manifest, config, syncMeta = {}) {
      const payload = file?.data;
      if (!payload || payload.format !== "fitness-assistant-proposal-v1") throw new Error("助手计划提案格式不支持");
      const id = normalizedId(payload.id);
      const basePlansRevision = normalizedId(payload.basePlansRevision);
      if (!id || !basePlansRevision) throw new Error("助手计划提案缺少 id 或 basePlansRevision");

      const target = targetPlan(payload);
      const summary = String(payload.summary || "训练模板已调整").trim() || "训练模板已调整";
      const changes = Array.isArray(payload.changes)
        ? payload.changes.map(item => String(item || "").trim()).filter(Boolean).slice(0, 8)
        : [];
      const base = {
        id,
        sha: file.sha,
        config,
        targetPlanId: target.targetPlanId,
        summary,
        changes,
        basePlansRevision,
        createdAt: String(payload.createdAt || "")
      };
      const remoteRevision = normalizedId(manifest?.plans?.revision);

      if (syncMeta?.plansDirty) return staleResult(base, "本机训练模板有未同步修改，请先处理本机与云端模板冲突。");
      const localBaseRevision = normalizedId(syncMeta?.plansBaseRevision);
      if (localBaseRevision && localBaseRevision !== basePlansRevision) return staleResult(base, "本机训练模板还没有同步到这份修改的基线，请先检查最新模板。");
      if (basePlansRevision !== remoteRevision) return staleResult(base, "这份修改基于旧版训练模板，请在聊天中重新生成。");
      if (!target.live || !target.targetPlanId) return staleResult(base, "找不到这份修改对应的训练模板。");

      return { ...base, stale: false, applied: false, candidate: normalizeCandidate(payload, target.live) };
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
          await Repo.privateCheck(config, { privateMessage: "助手计划提案只允许从 Private GitHub 仓库读取" });
          const [manifestFile, proposalFile, syncMeta] = await Promise.all([
            Repo.getJson(config, "manifest.json"),
            Repo.getJson(config, PROPOSAL_PATH),
            App.idbGet(SYNC_META_KEY)
          ]);
          lastLoadedAt = Date.now();
          if (!proposalFile) {
            if (!proposal?.applied) proposal = null;
            return proposal;
          }
          if (!manifestFile?.data || manifestFile.data.format !== "fitness-pwa-manifest-v3") throw new Error("云端 manifest 格式不支持");
          const next = normalizeProposal(proposalFile, manifestFile.data, config, syncMeta || {});
          if (proposal?.id !== next.id || proposal?.sha !== next.sha) autoSelectedProposalId = "";
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

    function selectedPlanId() {
      const el = document.getElementById("planningPlanSelect");
      const index = Number(el?.value ?? -1);
      return Number.isInteger(index) && index >= 0 ? normalizedId(App.state.plans[index]?.planId) : "";
    }

    function isTargetSelected() {
      return !!proposal?.targetPlanId && selectedPlanId() === proposal.targetPlanId;
    }

    function ensureReviewRoot() {
      let root = document.getElementById("planningAssistantReview");
      if (root) return root;
      const actions = document.querySelector("#plan .planning-actions-top");
      if (!actions) return null;
      root = document.createElement("div");
      root.id = "planningAssistantReview";
      root.className = "planning-assistant-review is-idle";
      root.setAttribute("aria-live", "polite");
      actions.before(root);
      return root;
    }

    function renderIdle() {
      const root = ensureReviewRoot();
      if (!root) return;
      root.className = "planning-assistant-review is-idle";
      root.innerHTML = `<span class="planning-assistant-review-kicker">ChatGPT 修改</span><strong>暂无待确认修改</strong><small>这里会显示 ChatGPT 对当前训练模板提出的修改。</small>`;
    }

    function currentPendingText() {
      const active = window.TrainingNextWorkout?.current?.();
      if (active?.workout?.status === "confirmed") return `当前待训练仍保留：${active.plan?.name || active.workout.planName || "本次训练"}`;
      return "确认前不会改变训练模板或当前待训练计划";
    }

    function renderStale() {
      const root = ensureReviewRoot();
      if (!root) return;
      root.className = "planning-assistant-review is-stale";
      root.innerHTML = `<span class="planning-assistant-review-kicker">ChatGPT 修改 · 已过期</span><strong>${App.esc(proposal.summary)}</strong><small>${App.esc(proposal.reason || "请重新生成修改。")}</small><div class="planning-proposal-actions"><button type="button" class="secondary" data-assistant-dismiss>忽略这份修改</button></div>`;
    }

    function renderApplied() {
      const root = ensureReviewRoot();
      if (!root) return;
      root.className = "planning-assistant-review is-approved";
      root.innerHTML = `<span class="planning-assistant-review-kicker">ChatGPT 修改 · 已应用</span><strong>${App.esc(proposal.summary)}</strong><small>${App.esc(proposal.syncOk === false ? "模板已在本机更新；GitHub 同步尚未完成。" : "训练模板已更新，并已重新生成下一次训练建议。")}</small>`;
    }

    function setPendingControls() {
      const pending = !!proposal && !proposal.stale && !proposal.applied && isTargetSelected();
      if (!pending) return;
      for (const id of ACTION_IDS) {
        const button = document.getElementById(id);
        if (button) button.disabled = true;
      }
      const regenerate = document.getElementById("planningRegenerateBtn");
      if (regenerate) regenerate.disabled = true;
      const addExercise = document.getElementById("planningAddExerciseBtn");
      if (addExercise) addExercise.disabled = true;
      document.querySelectorAll("#planningTemplateList input,#planningTemplateList select,#planningTemplateList textarea,#planningTemplateList button").forEach(control => { control.disabled = true; });
    }

    function renderPending() {
      const root = ensureReviewRoot();
      if (!root) return;
      const detail = proposal.changes.length ? proposal.changes.join(" · ") : "已生成完整候选模板";
      root.className = "planning-assistant-review is-pending";
      root.innerHTML = `<span class="planning-assistant-review-kicker">ChatGPT 修改 · 待确认</span><strong>${App.esc(proposal.summary)}</strong><small>${App.esc(`${detail} · ${currentPendingText()}`)}</small><div class="planning-proposal-actions"><button type="button" class="secondary" data-assistant-dismiss>忽略</button><button type="button" data-assistant-approve ${busy ? "disabled" : ""}>${busy ? "应用中…" : "确认修改"}</button></div>`;
      setPendingControls();
    }

    function renderReview({ selectTarget = false } = {}) {
      ensureReviewRoot();
      if (!proposal) {
        renderIdle();
        return;
      }
      const select = document.getElementById("planningPlanSelect");
      const targetIndex = planIndexById(proposal.targetPlanId);
      if (selectTarget && targetIndex >= 0 && autoSelectedProposalId !== proposal.id && select && !select.disabled) {
        select.value = String(targetIndex);
        autoSelectedProposalId = proposal.id;
        App.planning?.render?.();
      }
      if (proposal.applied) {
        renderApplied();
        return;
      }
      if (!isTargetSelected()) {
        renderIdle();
        return;
      }
      if (proposal.stale) renderStale();
      else renderPending();
    }

    function scheduleRender(options = {}) {
      queueMicrotask(() => requestAnimationFrame(() => renderReview(options)));
    }

    async function dismissProposal() {
      if (!proposal || busy) return;
      busy = true;
      try {
        await Repo.deleteJson(proposal.config, PROPOSAL_PATH, proposal.sha, "Dismiss assistant training plan proposal");
        proposal = null;
        autoSelectedProposalId = "";
        App.planning?.render?.();
        renderIdle();
        App.toast("已忽略 ChatGPT 的模板修改", "success");
      } catch (error) {
        App.toast(error?.message || "无法忽略这份修改", "error");
      } finally {
        busy = false;
      }
    }

    async function cleanupRemoteProposal(snapshot) {
      try {
        await Repo.deleteJson(snapshot.config, PROPOSAL_PATH, snapshot.sha, "Apply assistant training template proposal");
      } catch (error) {
        console.warn("assistant proposal cleanup", error);
      }
    }

    async function applyProposal() {
      if (!proposal || proposal.stale || proposal.applied || busy || !isTargetSelected()) return;
      const snapshot = proposal;
      const index = planIndexById(snapshot.targetPlanId);
      if (index < 0 || !App.state.plans[index]) return;
      busy = true;
      renderPending();

      try {
        const candidate = clone(snapshot.candidate);
        delete candidate.plannedWorkout;
        delete candidate.pendingAssistantChange;
        candidate.planId = snapshot.targetPlanId;
        App.state.plans[index] = candidate;
        await App.persist("plans");
        await App.planning?.invalidate?.(snapshot.targetPlanId, { force: true, regenerate: true, source: "assistant" });
        await cleanupRemoteProposal(snapshot);

        proposal = { ...snapshot, applied: true, appliedAt: new Date().toISOString(), syncOk: null };
        App.planning?.render?.();
        renderApplied();

        if (!App.sync?.push || !await App.sync.hasCredentials?.()) {
          proposal.syncOk = false;
          renderApplied();
          App.toast("ChatGPT 修改已应用到本机模板，尚未配置 GitHub 同步", "success");
          return;
        }

        const result = await App.sync.push({ priority: true });
        proposal.syncOk = !!result?.ok;
        renderApplied();
        if (result?.ok) App.toast("ChatGPT 修改已应用并同步", "success");
        else App.toast(result?.message || "模板已更新，但 GitHub 同步未完成", "error");
      } catch (error) {
        App.toast(error?.message || "应用 ChatGPT 修改失败", "error");
      } finally {
        busy = false;
        scheduleRender();
      }
    }

    function handleClickCapture(event) {
      const button = event.target.closest("button");
      if (!button || !proposal) return;
      if (button.matches("[data-assistant-approve]")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        applyProposal();
      } else if (button.matches("[data-assistant-dismiss]")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        dismissProposal();
      }
    }

    function bindEvents() {
      document.addEventListener("click", handleClickCapture, true);
      document.getElementById("planningPlanSelect")?.addEventListener("change", () => scheduleRender());
      document.querySelector("#plan .planning-template-shell")?.addEventListener("toggle", () => scheduleRender());
    }

    async function init() {
      bindEvents();
      ensureReviewRoot();
      renderIdle();
      loadProposal({ force: true }).then(() => scheduleRender({ selectTarget: true })).catch(() => {});
      App.assistantPlans = { refresh: () => loadProposal({ force: true }), current: () => proposal };
    }

    function refresh(reason) {
      scheduleRender();
      if (reason === "remote") loadProposal({ force: true }).then(() => scheduleRender()).catch(() => {});
    }

    function onPage(id) {
      if (id !== "plan") return;
      scheduleRender({ selectTarget: true });
      const force = Date.now() - lastLoadedAt >= REFRESH_COOLDOWN_MS;
      loadProposal({ force }).then(() => scheduleRender({ selectTarget: true })).catch(() => {});
    }

    async function onDataReset() {
      proposal = null;
      autoSelectedProposalId = "";
      renderIdle();
    }

    return { init, refresh, onPage, onDataReset };
  }

  window.FitnessAssistantProposalsCore = Object.freeze({ create });
})();