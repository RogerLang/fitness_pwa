(() => {
  const App = window.FitnessApp;
  const Progression = window.TrainingProgression;
  if (!Progression) throw new Error("TrainingProgression must load before planning.js");

  const {
    valueOrNull,
    repRange,
    setCount,
    weightStep,
    buildHistoryContext,
    progressionSuggestion,
    previousSummary
  } = Progression;

  const drafts = new Map();
  const clone = value => JSON.parse(JSON.stringify(value));

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

  function setStatus(message = "", tone = "") {
    const el = document.getElementById("planningStatus");
    if (!el) return;
    el.textContent = message;
    el.className = `planning-status${tone ? ` ${tone}` : ""}`;
  }

  function warmupSet(ex, si) {
    return Array.isArray(ex?.setPresets) ? (ex.setPresets[si] || {}) : {};
  }

  function suggestionSnapshot(plan) {
    const historyContext = buildHistoryContext(plan.name);
    const exercises = (plan.exercises || []).map(ex => {
      if (ex.warmup) {
        const count = setCount(ex);
        return {
          name: ex.name,
          warmup: true,
          note: ex.note || "",
          repRange: null,
          weightStep: 0,
          suggestionLabel: "专项热身",
          reason: ex.note || "按预设完成后进入正式工作组。",
          sets: Array.from({ length: count }, (_, si) => {
            const preset = warmupSet(ex, si);
            return {
              weight: valueOrNull(preset.weight),
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
        note: ex.note || "",
        repRange: [...suggestion.repRange],
        weightStep: suggestion.weightStep,
        suggestionLabel: suggestion.statusLabel,
        suggestionStatus: suggestion.status,
        reason: suggestion.reason,
        sets: suggestion.reps.map(reps => ({ weight: suggestion.weight, reps }))
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
    if (drafts.has(index)) return drafts.get(index);
    const plan = App.state.plans[index];
    if (!plan) return null;
    const existing = plan.plannedWorkout?.status === "confirmed" ? clone(plan.plannedWorkout) : suggestionSnapshot(plan);
    drafts.set(index, existing);
    return existing;
  }

  function previousPanel(summary) {
    if (!summary) return `<div class="planning-context planning-previous"><span>上次记录</span><strong>暂无历史记录</strong><small>完成一次训练后会显示</small></div>`;
    return `<div class="planning-context planning-previous"><span>上次记录</span><strong>${App.esc(summary.target)}</strong><small>${App.esc(summary.detail || "最近一次有效训练")}</small></div>`;
  }

  function suggestionPanel(ex) {
    return `<div class="planning-context planning-suggestion"><span>${ex.warmup ? "热身预设" : "系统建议"}</span><strong>${App.esc(ex.suggestionLabel || "已确认")}</strong><small>${App.esc(ex.reason || "")}</small></div>`;
  }

  function plannedRows(ex, ei) {
    return (ex.sets || []).map((set, si) => `<div class="planning-set-row">
      <span class="planning-set-number">${si + 1}</span>
      <label><span>重量 kg</span><input type="text" inputmode="decimal" autocomplete="off" data-plan-e="${ei}" data-plan-s="${si}" data-plan-key="weight" value="${App.esc(set.weight ?? "")}"></label>
      <label><span>次数</span><input type="text" inputmode="numeric" autocomplete="off" data-plan-e="${ei}" data-plan-s="${si}" data-plan-key="reps" value="${App.esc(set.reps ?? "")}"></label>
    </div>`).join("");
  }

  function renderCurrentPlan() {
    const root = document.getElementById("planningWorkoutList");
    if (!root) return;
    const plan = currentPlan();
    const draft = draftFor();
    if (!plan || !draft) {
      root.innerHTML = '<div class="empty-state"><strong>暂无训练模板</strong></div>';
      return;
    }

    const historyContext = buildHistoryContext(plan.name);
    root.innerHTML = draft.exercises.map((ex, ei) => {
      const previous = historyContext.latest(ex.name);
      const summary = previousSummary(previous);
      const count = Math.max(1, ex.sets?.length || 1);
      return `<article class="planning-exercise-card">
        <div class="planning-exercise-head">
          <div><h3>${App.esc(ex.name || "未命名动作")}</h3><p>${App.esc(ex.note || (ex.warmup ? "专项热身" : ""))}</p></div>
          ${ex.warmup ? '<span class="badge warmup-badge">热身</span>' : ""}
        </div>
        <div class="planning-context-grid">
          ${previousPanel(summary)}
          ${suggestionPanel(ex)}
        </div>
        <div class="planning-target-panel">
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

    const confirmed = plan.plannedWorkout?.status === "confirmed";
    setStatus(confirmed ? `已确认 · ${new Date(plan.plannedWorkout.confirmedAt).toLocaleString("zh-CN")}` : "当前为未确认建议，可修改后确认。", confirmed ? "is-confirmed" : "");
  }

  function templateField(label, edit, value, extra = "") {
    return `<label>${label}<input data-template-edit="${edit}" ${extra} value="${App.esc(value ?? "")}"></label>`;
  }

  function renderWarmupPresets(ex, ei) {
    const count = setCount(ex);
    return `<div class="template-preset-list">${Array.from({ length: count }, (_, si) => {
      const preset = warmupSet(ex, si);
      return `<div class="template-preset-row"><span>${si + 1}</span>
        <label>重量<input type="number" step="0.5" inputmode="decimal" data-template-preset="weight" data-e="${ei}" data-s="${si}" value="${App.esc(preset.weight ?? "")}"></label>
        <label>次数<input type="number" step="1" inputmode="numeric" data-template-preset="reps" data-e="${ei}" data-s="${si}" value="${App.esc(preset.reps ?? "")}"></label>
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
      const common = `<div class="template-card-head"><div><strong>${App.esc(ex.name || "未命名动作")}</strong><small>${ex.warmup ? "专项热身模板" : "长期训练模板"}</small></div><span>${sets} 组</span></div>`;
      const countControl = `<div class="template-setting-row"><span>计划组数</span><div class="planning-set-control"><button type="button" class="small secondary template-remove-set" data-e="${ei}" ${sets <= 1 ? "disabled" : ""}>−</button><span>${sets}</span><button type="button" class="small secondary template-add-set" data-e="${ei}">+</button></div></div>`;
      const body = ex.warmup
        ? `${templateField("动作名称", "name", ex.name, 'autocomplete="off"')}${countControl}${renderWarmupPresets(ex, ei)}<label>备注<textarea data-template-edit="note" rows="2">${App.esc(ex.note || "")}</textarea></label>`
        : `${templateField("动作名称", "name", ex.name, 'autocomplete="off"')}<div class="template-grid"><label>目标次数下限<input data-template-edit="repMin" type="number" min="1" step="1" inputmode="numeric" value="${min}"></label><label>目标次数上限<input data-template-edit="repMax" type="number" min="1" step="1" inputmode="numeric" value="${max}"></label><label>起始重量 kg<input data-template-edit="defaultWeight" type="number" step="0.5" inputmode="decimal" value="${App.esc(ex.defaultWeight ?? "")}"></label><label>升档重量 kg<input data-template-edit="weightStep" type="number" min="0" step="0.5" inputmode="decimal" value="${weightStep(ex)}"></label></div>${countControl}<label>备注<textarea data-template-edit="note" rows="2">${App.esc(ex.note || "")}</textarea></label><p class="template-hint">修改动作名称会影响历史记录的名称匹配。</p>`;
      return `<article class="template-card" data-e="${ei}">${common}${body}<button type="button" class="small template-delete" data-e="${ei}">删除动作</button></article>`;
    }).join("");
  }

  function renderSelect() {
    const el = select();
    if (!el) return;
    const previous = Number(el.value || App.training?.currentPlanIndex?.() || 0);
    if (!App.state.plans.length) {
      el.innerHTML = "<option>暂无训练模板</option>";
      el.disabled = true;
      return;
    }
    el.disabled = false;
    el.innerHTML = App.state.plans.map((plan, index) => `<option value="${index}">${App.esc(plan.name || `训练模板 ${index + 1}`)}</option>`).join("");
    el.value = String(Math.min(Math.max(0, previous), App.state.plans.length - 1));
  }

  function render() {
    renderSelect();
    renderCurrentPlan();
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
  }

  async function persistTemplateChange(input) {
    const plan = currentPlan();
    const ei = Number(input.closest(".template-card")?.dataset.e);
    const ex = plan?.exercises?.[ei];
    if (!ex) return;
    const field = input.dataset.templateEdit;
    if (field === "name") ex.name = input.value.trim() || "未命名动作";
    else if (field === "repMin") { ex.repRange ??= [8, 12]; ex.repRange[0] = Math.max(1, Number(input.value) || 1); }
    else if (field === "repMax") { ex.repRange ??= [8, 12]; ex.repRange[1] = Math.max(1, Number(input.value) || 1); }
    else if (field === "defaultWeight") ex.defaultWeight = valueOrNull(input.value);
    else if (field === "weightStep") ex.weightStep = Math.max(0, Number(input.value) || 0);
    else if (field === "note") ex.note = input.value;
    await App.persist("plans");
    if (plan.plannedWorkout?.status !== "confirmed") drafts.delete(currentIndex());
    render();
  }

  async function persistPresetChange(input) {
    const plan = currentPlan();
    const ei = Number(input.dataset.e);
    const si = Number(input.dataset.s);
    const ex = plan?.exercises?.[ei];
    if (!ex?.warmup) return;
    ex.setPresets ??= [];
    ex.setPresets[si] ??= {};
    ex.setPresets[si][input.dataset.templatePreset] = valueOrNull(input.value);
    await App.persist("plans");
    if (plan.plannedWorkout?.status !== "confirmed") drafts.delete(currentIndex());
    render();
  }

  function adjustDraftSets(ei, delta) {
    const draft = draftFor();
    const ex = draft?.exercises?.[ei];
    if (!ex) return;
    ex.sets ??= [];
    if (delta > 0) ex.sets.push({ ...(ex.sets[ex.sets.length - 1] || { weight: null, reps: null }) });
    else if (ex.sets.length > 1) ex.sets.pop();
    renderCurrentPlan();
  }

  async function adjustTemplateSets(ei, delta) {
    const plan = currentPlan();
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
    if (plan.plannedWorkout?.status !== "confirmed") drafts.delete(currentIndex());
    render();
  }

  async function confirmPlan(syncAfter = false) {
    const index = currentIndex();
    const plan = App.state.plans[index];
    const draft = draftFor(index);
    if (!plan || !draft) return;

    if (App.training?.currentPlanIndex?.() === index && App.training?.hasDraft?.()) {
      App.toast("当前这套训练还有未保存记录，请先保存或清空后再重新确认计划", "error");
      return;
    }

    const old = plan.plannedWorkout;
    const now = new Date().toISOString();
    plan.plannedWorkout = {
      id: old?.status === "confirmed" && old.id ? old.id : crypto.randomUUID(),
      revision: crypto.randomUUID(),
      status: "confirmed",
      planName: plan.name,
      generatedAt: draft.generatedAt || now,
      confirmedAt: now,
      exercises: clone(draft.exercises || [])
    };
    drafts.set(index, clone(plan.plannedWorkout));
    await App.persist("plans");
    await App.refresh("planned-workout");
    setStatus("本次计划已确认。训练页将读取这一版。", "is-confirmed");
    App.toast(syncAfter ? "本次计划已确认，正在同步" : "本次计划已确认", "success");

    if (syncAfter) {
      if (App.sync?.push) await App.sync.push();
      else App.toast("已保存本机；同步模块尚未就绪", "error");
    }
  }

  async function deleteTemplateExercise(ei) {
    const plan = currentPlan();
    if (!plan?.exercises?.[ei]) return;
    if (!confirm("删除这个模板动作？历史训练记录会保留。")) return;
    plan.exercises.splice(ei, 1);
    await App.persist("plans");
    drafts.delete(currentIndex());
    render();
  }

  async function addTemplateExercise() {
    const plan = currentPlan();
    if (!plan) return;
    plan.exercises ??= [];
    plan.exercises.push({ name: "新动作", sets: 3, repRange: [8, 12], defaultWeight: null, weightStep: 5, note: "", optional: false });
    await App.persist("plans");
    drafts.delete(currentIndex());
    render();
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
      if (button.classList.contains("planning-remove-set")) adjustDraftSets(ei, -1);
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
    document.getElementById("planningRegenerateBtn")?.addEventListener("click", () => {
      const plan = currentPlan();
      if (!plan) return;
      drafts.set(currentIndex(), suggestionSnapshot(plan));
      renderCurrentPlan();
      App.toast("已按最新历史重新生成建议", "success");
    });
    document.getElementById("planningConfirmBtn")?.addEventListener("click", () => confirmPlan(false));
    document.getElementById("planningConfirmSyncBtn")?.addEventListener("click", () => confirmPlan(true));
    document.getElementById("planningGoTrainBtn")?.addEventListener("click", () => App.switchPage("today", { historyMode: "replace" }));
    document.getElementById("planningAddExerciseBtn")?.addEventListener("click", addTemplateExercise);
  }

  async function init() {
    bindEvents();
  }

  async function refresh() {
    render();
  }

  async function onPage(id) {
    if (id === "plan") render();
  }

  async function onDataReset() {
    drafts.clear();
  }

  App.planning = { render, confirmPlan };
  App.registerModule({ init, refresh, onPage, onDataReset });
})();
