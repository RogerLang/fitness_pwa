(() => {
  const App = window.FitnessApp;
  const Progression = window.TrainingProgression;
  const NextWorkout = window.TrainingNextWorkout;
  if (!Progression || !NextWorkout) throw new Error("Planning dependencies must load before planning.js");

  const {
    valueOrNull,
    loadType,
    usesWeight,
    loadLabel,
    repRange,
    setCount,
    weightStep,
    buildHistoryContext,
    progressionSuggestion,
    previousSummary
  } = Progression;

  const drafts = new Map();
  const clone = value => JSON.parse(JSON.stringify(value));
  const AUTOFILL_GUARD = 'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-autocomplete="none" data-form-type="other" data-lpignore="true" data-1p-ignore';

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

  function confirmed() {
    return NextWorkout.current();
  }

  function warmupSet(ex, si) {
    return Array.isArray(ex?.setPresets) ? (ex.setPresets[si] || {}) : {};
  }

  function suggestionSnapshot(plan) {
    const historyContext = buildHistoryContext(plan.name);
    const exercises = (plan.exercises || []).map(ex => {
      const type = loadType(ex);
      if (ex.warmup) {
        const count = setCount(ex);
        return {
          name: ex.name,
          warmup: true,
          loadType: type,
          note: ex.note || "",
          repRange: null,
          weightStep: 0,
          suggestionLabel: "专项热身",
          reason: ex.note || "按预设完成后进入正式工作组。",
          sets: Array.from({ length: count }, (_, si) => {
            const preset = warmupSet(ex, si);
            return {
              weight: usesWeight(ex) ? valueOrNull(preset.weight) : null,
              reps: valueOrNull(preset.reps ?? preset.repsLabel)
            };
          })
        };
      }

      const history = historyContext.history(ex.name);
      const suggestion = progressionSuggestion(ex, history);
      return {
        name: ex.name,
        warmup: false,
        loadType: type,
        note: ex.note || "",
        repRange: [...suggestion.repRange],
        weightStep: suggestion.weightStep,
        suggestionLabel: suggestion.statusLabel,
        suggestionStatus: suggestion.status,
        reason: suggestion.reason,
        sets: suggestion.reps.map(reps => ({ weight: type === "bodyweight" ? null : suggestion.weight, reps }))
      };
    });

    return {
      id: crypto.randomUUID(),
      revision: null,
      status: "draft",
      planName: plan.name,
      generatedAt: new Date().toISOString(),
      exercises
    };
  }

  function draftFor(index = currentIndex()) {
    const plan = App.state.plans[index];
    if (!plan) return null;
    if (drafts.has(index)) return drafts.get(index);

    const active = confirmed();
    const draft = active?.index === index
      ? { ...clone(active.workout), status: "draft", revision: null }
      : suggestionSnapshot(plan);
    for (const ex of draft.exercises || []) ex.loadType = loadType(ex);
    drafts.set(index, draft);
    return draft;
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

    const historyContext = buildHistoryContext(plan.name);
    root.innerHTML = draft.exercises.map((ex, ei) => {
      const previous = historyContext.latest(ex.name);
      const summary = previousSummary(previous, ex);
      const count = Math.max(1, ex.sets?.length || 1);
      return `<article class="planning-exercise-card" data-load-type="${App.esc(loadType(ex))}">
        <div class="planning-exercise-head">
          <div><h3>${App.esc(ex.name || "未命名动作")}</h3><p>${App.esc(ex.note || (ex.warmup ? "专项热身" : ""))}</p></div>
          ${ex.warmup ? '<span class="badge warmup-badge">热身</span>' : ""}
        </div>
        <div class="planning-context-grid">
          ${previousPanel(summary)}
          ${suggestionPanel(ex)}
        </div>
        <div class="planning-target-panel${usesWeight(ex) ? "" : " bodyweight-target-panel"}">
          <div class="planning-target-head">
            <div><strong>本次计划</strong><small>${count} 组${ex.repRange ? ` · 模板 ${ex.repRange[0]}–${ex.repRange[1]} 次` : ""}</small></div>
            <div class="planning-set-control">
              <button type="button" class="small secondary planning-remove-set" data-e="${ei}" ${count <= 1 ? "disabled" : ""}>−</button>
              <span>${count}</span>
              <button type="button" class="small secondary planning-add-set" data-e="${ei}">+</button>
            </div>
          </div>
          <div class="planning-set-list">${plannedRows(ex, ei)}</div>
        </div>
      </article>`;
    }).join("");
  }

  function renderActions() {
    const hasPlan = !!currentPlan();
    for (const id of ["planningPushTopBtn", "planningPushBottomBtn"]) {
      const button = document.getElementById(id);
      if (button) button.disabled = !hasPlan;
    }
    for (const id of ["planningGoTrainTopBtn", "planningGoTrainBtn"]) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.classList.remove("hidden");
      button.disabled = !hasPlan;
    }
    const regenerateButton = document.getElementById("planningRegenerateBtn");
    if (regenerateButton) regenerateButton.disabled = !hasPlan;
  }

  function templateField(label, edit, value, extra = "") {
    return `<label>${label}<input data-template-edit="${edit}" ${extra} value="${App.esc(value ?? "")}"></label>`;
  }

  function loadTypeField(ex) {
    const type = loadType(ex);
    return `<label>负重类型<select data-template-edit="loadType">
      <option value="weight"${type === "weight" ? " selected" : ""}>常规重量</option>
      <option value="bodyweight"${type === "bodyweight" ? " selected" : ""}>徒手</option>
      <option value="added-weight"${type === "added-weight" ? " selected" : ""}>附加重量</option>
    </select></label>`;
  }

  function renderWarmupPresets(ex, ei) {
    const count = setCount(ex);
    const weighted = usesWeight(ex);
    return `<div class="template-preset-list">${Array.from({ length: count }, (_, si) => {
      const preset = warmupSet(ex, si);
      return `<div class="template-preset-row${weighted ? "" : " bodyweight-template-preset"}"><span>${si + 1}</span>
        ${weighted ? `<label>${App.esc(loadLabel(ex))}<input type="number" step="0.5" inputmode="decimal" autocomplete="off" data-template-preset="weight" data-e="${ei}" data-s="${si}" value="${App.esc(preset.weight ?? "")}"></label>` : ""}
        <label>次数<input type="number" step="1" inputmode="numeric" autocomplete="off" data-template-preset="reps" data-e="${ei}" data-s="${si}" value="${App.esc(preset.reps ?? "")}"></label>
      </div>`;
    }).join("")}</div>`;
  }

  function renderTemplate() {
    const root = document.getElementById("planningTemplateList");
    if (!root) return;
    const plan = currentPlan();
    if (!plan) {
      root.innerHTML = "";
      return;
    }

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
        : `${templateField("动作名称", "name", ex.name, 'autocomplete="off"')}${loadTypeField(ex)}${repsFields}${loadFields}${countControl}<label>备注<textarea data-template-edit="note" rows="2">${App.esc(ex.note || "")}</textarea></label><p class="template-hint">修改动作名称会影响历史记录的名称匹配。</p>`;
      return `<article class="template-card" data-e="${ei}">${common}${body}<button type="button" class="small template-delete" data-e="${ei}">删除动作</button></article>`;
    }).join("");
  }

  function renderSelect() {
    const el = select();
    if (!el) return;
    const raw = el.value;
    const active = confirmed();
    const fallback = active?.index ?? App.training?.currentPlanIndex?.() ?? 0;
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
    renderCurrentBanner();
    renderCurrentPlan();
    renderActions();
    renderTemplate();
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
    drafts.delete(index);
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
    drafts.delete(index);
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
    drafts.delete(index);
    render();
  }

  async function pushPlan() {
    const index = currentIndex();
    const plan = App.state.plans[index];
    const draft = draftFor(index);
    const active = confirmed();
    if (!plan || !draft) return false;

    if (active && App.training?.hasDraft?.()) {
      App.toast("当前训练已经开始记录，请先保存或清空后再推送新计划", "error");
      return false;
    }

    if (active && active.index !== index) {
      const replace = confirm(`当前待训练计划是“${active.plan?.name || active.workout.planName}”。推送后将替换为“${plan.name}”。继续？`);
      if (!replace) return false;
    }

    NextWorkout.replaceOthers(index, { replacedByPlanName: plan.name || "" });
    const old = plan.plannedWorkout;
    const now = new Date().toISOString();
    plan.plannedWorkout = {
      id: old?.status === "confirmed" && old.id ? old.id : crypto.randomUUID(),
      revision: crypto.randomUUID(),
      status: "confirmed",
      planName: plan.name,
      generatedAt: draft.generatedAt || now,
      confirmedAt: now,
      exercises: clone((draft.exercises || []).map(ex => ({ ...ex, loadType: loadType(ex) })))
    };

    drafts.delete(index);
    await App.persist("plans");
    await App.refresh("planned-workout");
    App.toast("训练计划已推送", "success");

    if (App.sync?.push && await App.sync.hasCredentials?.()) {
      try {
        await App.sync.push();
        const syncStatus = document.getElementById("todaySyncStatus");
        if (syncStatus?.classList.contains("sync-error")) {
          App.toast(syncStatus.textContent || "训练计划已保存在本机，GitHub 同步未完成", "error");
        }
      } catch (error) {
        App.toast(error?.message || "训练计划已保存在本机，GitHub 同步未完成", "error");
      }
    }
    return true;
  }

  function regenerate() {
    const index = currentIndex();
    const plan = currentPlan();
    if (!plan) return;
    drafts.set(index, suggestionSnapshot(plan));
    renderCurrentPlan();
    renderActions();
    App.toast("已恢复为系统推荐计划", "success");
  }

  async function deleteTemplateExercise(ei) {
    const index = currentIndex();
    const plan = App.state.plans[index];
    if (!plan?.exercises?.[ei]) return;
    if (!confirm("删除这个模板动作？历史训练记录会保留。")) return;
    plan.exercises.splice(ei, 1);
    await App.persist("plans");
    drafts.delete(index);
    render();
  }

  async function addTemplateExercise() {
    const index = currentIndex();
    const plan = App.state.plans[index];
    if (!plan) return;
    plan.exercises ??= [];
    plan.exercises.push({ name: "新动作", loadType: "weight", sets: 3, repRange: [8, 12], defaultWeight: null, weightStep: 5, note: "", optional: false });
    await App.persist("plans");
    drafts.delete(index);
    render();
  }

  async function goTrain() {
    const pushed = await pushPlan();
    if (!pushed) return;
    await App.switchPage("today", { historyMode: "replace" });
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
    document.getElementById("planningRegenerateBtn")?.addEventListener("click", regenerate);
    for (const id of ["planningPushTopBtn", "planningPushBottomBtn"]) {
      document.getElementById(id)?.addEventListener("click", () => pushPlan().catch(error => App.toast(error.message, "error")));
    }
    for (const id of ["planningGoTrainTopBtn", "planningGoTrainBtn"]) {
      document.getElementById(id)?.addEventListener("click", () => goTrain().catch(error => App.toast(error.message, "error")));
    }
    document.getElementById("planningAddExerciseBtn")?.addEventListener("click", addTemplateExercise);
  }

  async function init() {
    const preferred = App.training?.hasDraft?.() ? App.training.currentPlanIndex() : null;
    const normalized = NextWorkout.normalizeSingle(preferred);
    if (normalized.changed) await App.persist("plans");
    bindEvents();
  }

  async function refresh(reason) {
    if (reason === "remote") {
      drafts.clear();
      const normalized = NextWorkout.normalizeSingle(App.training?.hasDraft?.() ? App.training.currentPlanIndex() : null);
      if (normalized.changed) await App.persist("plans");
    }
    render();
  }

  async function onPage(id) {
    if (id === "plan") render();
  }

  async function onDataReset() {
    drafts.clear();
  }

  function invalidate(index = currentIndex()) {
    drafts.delete(index);
  }

  App.planning = { render, pushPlan, invalidate };
  App.registerModule({ init, refresh, onPage, onDataReset });
})();
