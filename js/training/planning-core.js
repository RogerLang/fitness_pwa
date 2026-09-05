(() => {
  function create(App) {
    const Progression = window.TrainingProgression;
    const NextWorkout = window.TrainingNextWorkout;
    const CandidateFactory = window.TrainingCandidateWorkout;
    if (!Progression || !NextWorkout || !CandidateFactory?.create) throw new Error("Planning dependencies must load before planning-core.js");

    const Candidate = CandidateFactory.create(App, Progression);
    const {
      valueOrNull,
      loadType,
      usesWeight,
      loadLabel,
      repRange,
      setCount,
      weightStep,
      buildHistoryContext,
      previousSummary
    } = Progression;

    const clone = value => JSON.parse(JSON.stringify(value));
    const AUTOFILL_GUARD = 'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-autocomplete="none" data-form-type="other" data-lpignore="true" data-1p-ignore';
    const normalizedId = value => String(value || "").trim();

    function select() {
      return document.getElementById("planningPlanSelect");
    }

    function currentIndex() {
      const el = select();
      if (!el || el.disabled) return 0;
      const index = Number(el.value || 0);
      return Number.isInteger(index) && index >= 0 && index < App.state.plans.length ? index : 0;
    }

    function currentPlan() {
      return App.state.plans[currentIndex()] || null;
    }

    function planIndexById(planId) {
      const id = normalizedId(planId);
      return id ? App.state.plans.findIndex(plan => normalizedId(plan?.planId) === id) : -1;
    }

    function planById(planId) {
      const index = planIndexById(planId);
      return index >= 0 ? App.state.plans[index] : null;
    }

    function confirmed() {
      return NextWorkout.current();
    }

    function entryFor(index = currentIndex(), options = {}) {
      return Candidate.entryForPlan(App.state.plans[index] || null, options);
    }

    function draftFor(index = currentIndex()) {
      return Candidate.draftForPlan(App.state.plans[index] || null);
    }

    function markEdited(index = currentIndex()) {
      Candidate.markEdited(App.state.plans[index] || null);
    }

    function regenerateEntry(index = currentIndex()) {
      return Candidate.regenerate(App.state.plans[index] || null);
    }

    function warmupSet(ex, si) {
      return Array.isArray(ex?.setPresets) ? (ex.setPresets[si] || {}) : {};
    }

    function ensureCandidateStatus() {
      let root = document.getElementById("planningCandidateStatus");
      if (root) return root;
      const current = document.getElementById("planningCurrentPlan");
      if (!current) return null;
      root = document.createElement("div");
      root.id = "planningCandidateStatus";
      root.className = "planning-assistant-review hidden";
      current.after(root);
      return root;
    }

    function renderCandidateStatus() {
      const root = ensureCandidateStatus();
      if (!root) return;
      const entry = entryFor(currentIndex(), { notify: true });
      if (!entry?.stale) {
        root.className = "planning-assistant-review hidden";
        root.innerHTML = "";
        return;
      }
      root.className = "planning-assistant-review is-stale";
      root.innerHTML = `
        <span class="planning-assistant-review-kicker">训练建议 · 依据已更新</span>
        <strong>${App.esc(entry.staleReason || "生成依据发生变化")}</strong>
        <small>你的重量、次数和组数调整已保留。请选择继续保留，或按最新数据重新生成。</small>
        <div class="planning-proposal-actions">
          <button type="button" class="secondary" data-candidate-keep>保留当前调整</button>
          <button type="button" data-candidate-regenerate>重新生成</button>
        </div>
      `;
    }

    function previousPanel(summary) {
      if (!summary) return `<div class="planning-context planning-previous"><span>上次记录</span><strong>暂无历史记录</strong><small>完成一次训练后会显示</small></div>`;
      return `<div class="planning-context planning-previous"><span>上次记录</span><strong>${App.esc(summary.target)}</strong><small>${App.esc(summary.detail || "最近一次有效训练")}</small></div>`;
    }

    function suggestionPanel(ex) {
      return `<div class="planning-context planning-suggestion"><span>${ex.warmup ? "热身预设" : "系统建议"}</span><strong>${App.esc(ex.suggestionLabel || "建议")}</strong><small>${App.esc(ex.reason || "")}</small></div>`;
    }

    function plannedRows(ex, ei) {
      const weighted = usesWeight(ex);
      const loadName = loadLabel(ex);
      const rows = (ex.sets || []).map((set, si) => `<div class="planning-set-row${weighted ? "" : " bodyweight-plan-row"}">
        <span class="planning-set-number">${si + 1}</span>
        ${weighted ? `<input type="text" inputmode="decimal" ${AUTOFILL_GUARD} aria-label="第 ${si + 1} 组${App.esc(loadName)}" data-plan-e="${ei}" data-plan-s="${si}" data-plan-key="weight" value="${App.esc(set.weight ?? "")}">` : ""}
        <input type="text" inputmode="numeric" ${AUTOFILL_GUARD} aria-label="第 ${si + 1} 组次数" data-plan-e="${ei}" data-plan-s="${si}" data-plan-key="reps" value="${App.esc(set.reps ?? "")}">
      </div>`).join("");
      const header = weighted
        ? `<div class="planning-set-header"><span>组</span><span>${App.esc(loadName)} kg</span><span>次数</span></div>`
        : '<div class="planning-set-header bodyweight-plan-row"><span>组</span><span>次数</span></div>';
      return `${header}${rows}`;
    }

    function renderCurrentBanner() {
      const root = document.getElementById("planningCurrentPlan");
      if (!root) return;
      const active = confirmed();
      root.className = `planning-current${active ? " is-confirmed" : " is-empty"}`;
      if (!active) {
        root.innerHTML = '<span class="planning-current-label">当前待训练</span><strong>暂无</strong><small>推送后会显示在训练页</small>';
        return;
      }
      const count = Array.isArray(active.workout?.exercises) ? active.workout.exercises.length : 0;
      const time = active.workout?.confirmedAt
        ? new Date(active.workout.confirmedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })
        : "已推送";
      root.innerHTML = `<span class="planning-current-label">当前待训练</span><strong>${App.esc(active.plan?.name || active.workout?.planName || "本次训练")}</strong><small>${count ? `${count} 个动作 · ` : ""}${App.esc(time)} 推送</small>`;
    }

    function renderCurrentPlan() {
      const root = document.getElementById("planningWorkoutList");
      if (!root) return;
      const plan = currentPlan();
      const draft = draftFor();
      if (!plan || !draft) {
        root.innerHTML = '<div class="card empty-state"><strong>暂无训练模板</strong></div>';
        return;
      }

      const historyContext = buildHistoryContext(plan);
      root.innerHTML = draft.exercises.map((ex, ei) => {
        const previous = historyContext.latest(ex);
        const summary = previousSummary(previous, ex);
        const count = Math.max(1, ex.sets?.length || 1);
        return `<article class="planning-exercise-card" data-load-type="${App.esc(loadType(ex))}">
          <div class="planning-exercise-head">
            <div><h3>${App.esc(ex.name || "未命名动作")}</h3><p>${App.esc(ex.note || (ex.warmup ? "专项热身" : ""))}</p></div>
            ${ex.warmup ? '<span class="badge warmup-badge">热身</span>' : ""}
          </div>
          <div class="planning-context-grid">${previousPanel(summary)}${suggestionPanel(ex)}</div>
          <div class="planning-target-panel${usesWeight(ex) ? "" : " bodyweight-target-panel"}">
            <div class="planning-target-head">
              <div><strong>本次计划</strong><small>${count} 组${ex.repRange ? ` · 模板 ${ex.repRange[0]}–${ex.repRange[1]} 次` : ""}</small></div>
              <div class="planning-set-control"><button type="button" class="small secondary planning-remove-set" data-e="${ei}" ${count <= 1 ? "disabled" : ""}>−</button><span>${count}</span><button type="button" class="small secondary planning-add-set" data-e="${ei}">+</button></div>
            </div>
            <div class="planning-set-list">${plannedRows(ex, ei)}</div>
          </div>
        </article>`;
      }).join("");
    }

    function renderActions() {
      const hasPlan = !!currentPlan();
      const stale = !!entryFor(currentIndex(), { notify: false })?.stale;
      for (const id of ["planningPushTopBtn", "planningPushBottomBtn"]) {
        const button = document.getElementById(id);
        if (button) button.disabled = !hasPlan || stale;
      }
      for (const id of ["planningGoTrainTopBtn", "planningGoTrainBtn"]) {
        const button = document.getElementById(id);
        if (!button) continue;
        button.classList.remove("hidden");
        button.disabled = !hasPlan || stale;
      }
      const regenerateButton = document.getElementById("planningRegenerateBtn");
      if (regenerateButton) regenerateButton.disabled = !hasPlan;
    }

    function templateField(label, edit, value, extra = "") {
      return `<label>${label}<input data-template-edit="${edit}" ${extra} value="${App.esc(value ?? "")}"></label>`;
    }

    function loadTypeField(ex) {
      const type = loadType(ex);
      return `<label>负重类型<select data-template-edit="loadType"><option value="weight"${type === "weight" ? " selected" : ""}>常规重量</option><option value="bodyweight"${type === "bodyweight" ? " selected" : ""}>徒手</option><option value="added-weight"${type === "added-weight" ? " selected" : ""}>附加重量</option></select></label>`;
    }

    function renderWarmupPresets(ex, ei) {
      const count = setCount(ex);
      const weighted = usesWeight(ex);
      return `<div class="template-preset-list">${Array.from({ length: count }, (_, si) => {
        const preset = warmupSet(ex, si);
        return `<div class="template-preset-row${weighted ? "" : " bodyweight-template-preset"}"><span>${si + 1}</span>${weighted ? `<label>${App.esc(loadLabel(ex))}<input type="number" step="0.5" inputmode="decimal" autocomplete="off" data-template-preset="weight" data-e="${ei}" data-s="${si}" value="${App.esc(preset.weight ?? "")}"></label>` : ""}<label>次数<input type="number" step="1" inputmode="numeric" autocomplete="off" data-template-preset="reps" data-e="${ei}" data-s="${si}" value="${App.esc(preset.reps ?? "")}"></label></div>`;
      }).join("")}</div>`;
    }

    function templateShell() {
      return document.querySelector("#plan .planning-template-shell");
    }

    function renderTemplate({ force = false } = {}) {
      const root = document.getElementById("planningTemplateList");
      if (!root) return;
      const plan = currentPlan();
      if (!plan) { root.innerHTML = ""; return; }
      if (!force && !templateShell()?.open) return;

      root.innerHTML = (plan.exercises || []).map((ex, ei) => {
        const [min, max] = repRange(ex);
        const sets = setCount(ex);
        const weighted = usesWeight(ex);
        const loadName = loadLabel(ex);
        const common = `<div class="template-card-head"><div><strong>${App.esc(ex.name || "未命名动作")}</strong><small>${ex.warmup ? "专项热身模板" : "长期训练模板"}</small></div><span>${sets} 组</span></div>`;
        const countControl = `<div class="template-setting-row"><span>计划组数</span><div class="planning-set-control"><button type="button" class="small secondary template-remove-set" data-e="${ei}" ${sets <= 1 ? "disabled" : ""}>−</button><span>${sets}</span><button type="button" class="small secondary template-add-set" data-e="${ei}">+</button></div></div>`;
        const repsFields = `<div class="template-grid"><label>目标次数下限<input data-template-edit="repMin" type="number" min="1" step="1" inputmode="numeric" value="${min}"></label><label>目标次数上限<input data-template-edit="repMax" type="number" min="1" step="1" inputmode="numeric" value="${max}"></label></div>`;
        const loadFields = weighted ? `<div class="template-grid"><label>起始${App.esc(loadName)} kg<input data-template-edit="defaultWeight" type="number" step="0.5" inputmode="decimal" value="${App.esc(ex.defaultWeight ?? "")}"></label><label>升档重量 kg<input data-template-edit="weightStep" type="number" min="0" step="0.5" inputmode="decimal" value="${weightStep(ex)}"></label></div>` : "";
        const body = ex.warmup
          ? `${templateField("动作名称", "name", ex.name, 'autocomplete="off"')}${loadTypeField(ex)}${countControl}${renderWarmupPresets(ex, ei)}<label>备注<textarea data-template-edit="note" rows="2">${App.esc(ex.note || "")}</textarea></label>`
          : `${templateField("动作名称", "name", ex.name, 'autocomplete="off"')}${loadTypeField(ex)}${repsFields}${loadFields}${countControl}<label>备注<textarea data-template-edit="note" rows="2">${App.esc(ex.note || "")}</textarea></label><p class="template-hint">修改动作名称会保留当前动作 ID；如需真正替换动作，建议通过 ChatGPT 修改。</p>`;
        return `<article class="template-card" data-e="${ei}">${common}${body}<button type="button" class="small template-delete" data-e="${ei}">删除动作</button></article>`;
      }).join("");
    }

    function renderSelect() {
      const el = select();
      if (!el) return;
      const raw = el.value;
      const activePlanId = normalizedId(confirmed()?.workout?.planId);
      const trainingPlanId = normalizedId(App.training?.currentPlanId?.());
      const activeIndex = planIndexById(activePlanId || trainingPlanId);
      const fallback = activeIndex >= 0 ? activeIndex : 0;
      const previous = raw === "" ? fallback : Number(raw);
      if (!App.state.plans.length) {
        el.innerHTML = "<option>暂无训练模板</option>";
        el.disabled = true;
        return;
      }
      el.disabled = false;
      el.innerHTML = App.state.plans.map((plan, index) => `<option value="${index}">${App.esc(plan.name || `训练模板 ${index + 1}`)}</option>`).join("");
      el.value = String(Math.min(Math.max(0, Number.isInteger(previous) ? previous : fallback), App.state.plans.length - 1));
    }

    function render() {
      renderSelect();
      entryFor(currentIndex(), { notify: true });
      renderCurrentBanner();
      renderCurrentPlan();
      renderActions();
      renderTemplate();
      renderCandidateStatus();
    }

    function updateDraftInput(input) {
      const draft = draftFor();
      const ei = Number(input.dataset.planE);
      const si = Number(input.dataset.planS);
      const key = input.dataset.planKey;
      const set = draft?.exercises?.[ei]?.sets?.[si];
      if (!set || !key) return;
      set[key] = valueOrNull(input.value);
      draft.status = "draft";
      draft.revision = null;
      markEdited();
    }

    async function persistTemplateChange(input) {
      const index = currentIndex();
      const plan = App.state.plans[index];
      const ei = Number(input.closest(".template-card")?.dataset.e);
      const ex = plan?.exercises?.[ei];
      if (!ex) return;
      const field = input.dataset.templateEdit;
      if (field === "name") ex.name = input.value.trim() || "未命名动作";
      else if (field === "loadType") ex.loadType = loadType(input.value);
      else if (field === "repMin") { ex.repRange ??= [8, 12]; ex.repRange[0] = Math.max(1, Number(input.value) || 1); }
      else if (field === "repMax") { ex.repRange ??= [8, 12]; ex.repRange[1] = Math.max(1, Number(input.value) || 1); }
      else if (field === "defaultWeight") ex.defaultWeight = valueOrNull(input.value);
      else if (field === "weightStep") ex.weightStep = Math.max(0, Number(input.value) || 0);
      else if (field === "note") ex.note = input.value;
      await App.persist("plans");
      regenerateEntry(index);
      render();
    }

    async function persistPresetChange(input) {
      const index = currentIndex();
      const plan = App.state.plans[index];
      const ei = Number(input.dataset.e);
      const si = Number(input.dataset.s);
      const ex = plan?.exercises?.[ei];
      if (!ex?.warmup) return;
      ex.setPresets ??= [];
      ex.setPresets[si] ??= {};
      ex.setPresets[si][input.dataset.templatePreset] = valueOrNull(input.value);
      await App.persist("plans");
      regenerateEntry(index);
      render();
    }

    function adjustDraftSets(ei, delta) {
      const draft = draftFor();
      const ex = draft?.exercises?.[ei];
      if (!ex) return;
      ex.sets ??= [];
      if (delta > 0) ex.sets.push({ ...(ex.sets[ex.sets.length - 1] || { weight: null, reps: null }) });
      else if (ex.sets.length > 1) ex.sets.pop();
      draft.status = "draft";
      draft.revision = null;
      markEdited();
      renderCurrentPlan();
    }

    async function adjustTemplateSets(ei, delta) {
      const index = currentIndex();
      const plan = App.state.plans[index];
      const ex = plan?.exercises?.[ei];
      if (!ex) return;
      const next = Math.max(1, setCount(ex) + delta);
      ex.sets = next;
      if (ex.warmup) {
        ex.setPresets ??= [];
        while (ex.setPresets.length < next) ex.setPresets.push({ ...(ex.setPresets[ex.setPresets.length - 1] || {}) });
        ex.setPresets = ex.setPresets.slice(0, next);
      }
      await App.persist("plans");
      regenerateEntry(index);
      render();
    }

    function comparableWorkout(workout) {
      if (!workout) return "";
      return JSON.stringify({ planId: workout.planId || "", planName: workout.planName || "", exercises: workout.exercises || [] });
    }

    function sameAsPlanned(draft) {
      const active = confirmed();
      return !!active && comparableWorkout(active.workout) === comparableWorkout(draft);
    }

    async function pushPlan({ sync = true, skipIfSame = false } = {}) {
      const index = currentIndex();
      const plan = App.state.plans[index];
      const entry = entryFor(index);
      const draft = entry?.workout;
      if (!plan || !draft) return false;
      if (entry.stale) {
        App.toast("训练依据已更新，请先保留当前调整或重新生成", "error");
        return false;
      }
      if (confirmed() && App.training?.hasDraft?.()) {
        App.toast("当前训练已经开始记录，请先保存或清空后再推送新计划", "error");
        return false;
      }
      if (skipIfSame && sameAsPlanned(draft)) return true;

      const now = new Date().toISOString();
      await NextWorkout.setConfirmed({
        id: crypto.randomUUID(),
        revision: crypto.randomUUID(),
        status: "confirmed",
        planId: plan.planId || "",
        planName: plan.name,
        generatedAt: draft.generatedAt || now,
        confirmedAt: now,
        sourceTemplateSig: entry.templateSig || Candidate.templateSig(plan),
        exercises: clone((draft.exercises || []).map(ex => ({ ...ex, loadType: loadType(ex) })))
      });

      await App.refresh("planned-workout");
      if (!sync) return true;
      if (!App.sync?.push || !await App.sync.hasCredentials?.()) {
        App.toast("训练计划已保存在本机，但尚未配置 GitHub 同步", "error");
        return true;
      }
      const result = await App.sync.push();
      if (!result?.ok) App.toast(result?.message || "训练计划已保存在本机，GitHub 同步未完成", "error");
      else App.toast("训练计划已推送到云端", "success");
      return true;
    }

    function regenerate() {
      if (!currentPlan()) return;
      regenerateEntry(currentIndex());
      render();
      App.toast("已按最新模板和训练记录重新生成", "success");
    }

    function keepCurrentCandidate() {
      const plan = currentPlan();
      if (!plan) return;
      Candidate.keep(plan);
      render();
      App.toast("已保留当前调整", "success");
    }

    async function deleteTemplateExercise(ei) {
      const index = currentIndex();
      const plan = App.state.plans[index];
      if (!plan?.exercises?.[ei]) return;
      if (!confirm("删除这个模板动作？历史训练记录会保留。")) return;
      plan.exercises.splice(ei, 1);
      await App.persist("plans");
      regenerateEntry(index);
      render();
    }

    async function addTemplateExercise() {
      const index = currentIndex();
      const plan = App.state.plans[index];
      if (!plan) return;
      plan.exercises ??= [];
      plan.exercises.push({ exerciseId: crypto.randomUUID(), name: "新动作", loadType: "weight", sets: 3, repRange: [8, 12], defaultWeight: null, weightStep: 5, note: "", optional: false });
      await App.persist("plans");
      regenerateEntry(index);
      render();
    }

    async function goTrain() {
      const draft = draftFor();
      if (!draft) return;
      if (!sameAsPlanned(draft)) {
        const pushed = await pushPlan({ sync: false, skipIfSame: true });
        if (!pushed) return;
      }
      await App.switchPage("today", { historyMode: "replace" });
      App.toast("训练计划已载入，正在后台同步", "success");
      Promise.resolve().then(async () => {
        if (!App.sync?.push || !await App.sync.hasCredentials?.()) return;
        await App.sync.push();
      }).catch(error => console.warn("go-train plan sync", error));
    }

    async function invalidate(planId = currentPlan()?.planId, options = {}) {
      const plan = planById(planId);
      if (!plan) return;
      Candidate.invalidate(plan, options);
      if (document.getElementById("plan")?.classList.contains("active")) render();
    }

    function bindEvents() {
      select()?.addEventListener("change", () => render());
      document.getElementById("planningWorkoutList")?.addEventListener("input", event => {
        const input = event.target.closest("input[data-plan-key]");
        if (input) updateDraftInput(input);
      });
      document.getElementById("planningWorkoutList")?.addEventListener("click", event => {
        const button = event.target.closest("button");
        if (!button) return;
        const ei = Number(button.dataset.e);
        if (button.classList.contains("planning-add-set")) adjustDraftSets(ei, 1);
        else if (button.classList.contains("planning-remove-set")) adjustDraftSets(ei, -1);
      });
      document.getElementById("planningTemplateList")?.addEventListener("change", event => {
        const input = event.target;
        if (input.dataset.templateEdit) persistTemplateChange(input).catch(error => App.toast(error.message, "error"));
        else if (input.dataset.templatePreset) persistPresetChange(input).catch(error => App.toast(error.message, "error"));
      });
      document.getElementById("planningTemplateList")?.addEventListener("click", event => {
        const button = event.target.closest("button");
        if (!button) return;
        const ei = Number(button.dataset.e);
        if (button.classList.contains("template-add-set")) adjustTemplateSets(ei, 1);
        else if (button.classList.contains("template-remove-set")) adjustTemplateSets(ei, -1);
        else if (button.classList.contains("template-delete")) deleteTemplateExercise(ei);
      });
      document.getElementById("planningCandidateStatus")?.addEventListener("click", event => {
        const button = event.target.closest("button");
        if (button?.matches("[data-candidate-keep]")) keepCurrentCandidate();
        else if (button?.matches("[data-candidate-regenerate]")) regenerate();
      });
      const shell = templateShell();
      shell?.addEventListener("toggle", () => { if (shell.open) renderTemplate({ force: true }); });
      document.getElementById("planningRegenerateBtn")?.addEventListener("click", regenerate);
      for (const id of ["planningPushTopBtn", "planningPushBottomBtn"]) document.getElementById(id)?.addEventListener("click", () => pushPlan().catch(error => App.toast(error.message, "error")));
      for (const id of ["planningGoTrainTopBtn", "planningGoTrainBtn"]) document.getElementById(id)?.addEventListener("click", () => goTrain().catch(error => App.toast(error.message, "error")));
      document.getElementById("planningAddExerciseBtn")?.addEventListener("click", addTemplateExercise);
    }

    async function init() {
      await Candidate.init();
      ensureCandidateStatus();
      bindEvents();
    }

    async function refresh(reason) {
      if (reason === "remote") Candidate.refreshPlans(App.state.plans);
      render();
    }

    async function onPage(id) { if (id === "plan") render(); }
    async function onDataReset() { await Candidate.reset(); }

    const publicApi = { render, pushPlan, invalidate };
    return { init, refresh, onPage, onDataReset, publicApi };
  }

  window.FitnessPlanningCore = Object.freeze({ create });
})();