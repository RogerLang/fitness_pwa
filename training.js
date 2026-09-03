(() => {
  const App = window.FitnessApp;
  const Progression = window.TrainingProgression;
  const Insights = window.TrainingInsights;
  const Maintenance = window.TrainingMaintenance;
  if (!Progression || !Insights || !Maintenance) throw new Error("Training modules must load before training.js");

  const DRAFTS_KEY = "workoutDraftsV7";
  const ACTIVE_PLAN_KEY = "workoutActivePlanV7";

  let draftStore = {};
  let draft = { planIndex: 0, sets: {}, completed: {} };
  let draftTimer = null;
  const openEditors = new Set();

  const clone = value => JSON.parse(JSON.stringify(value));
  const draftKey = (ei, si, key) => `${ei}:${si}:${key}`;
  const doneKey = (ei, si) => `${ei}:${si}`;
  const {
    valueOrNull,
    repRange,
    setCount,
    weightStep,
    workingWeight,
    buildHistoryContext,
    progressionSuggestion,
    previousSummary
  } = Progression;

  function currentPlanIndex() {
    const select = document.getElementById("planSelect");
    if (!select || select.disabled) return 0;
    const index = Number(select.value || 0);
    return Number.isInteger(index) && index >= 0 ? index : 0;
  }

  function ensureDraftPlan(index = currentPlanIndex()) {
    if (draft.planIndex !== index) {
      const saved = draftStore[String(index)];
      draft = saved
        ? { planIndex: index, sets: clone(saved.sets || {}), completed: clone(saved.completed || {}) }
        : { planIndex: index, sets: {}, completed: {} };
    }
    return index;
  }

  function captureDraft() {
    const index = ensureDraftPlan();
    document.querySelectorAll('#workoutContainer input[data-e][data-s][data-k]').forEach(input => {
      draft.sets[draftKey(input.dataset.e, input.dataset.s, input.dataset.k)] = input.value;
    });
    document.querySelectorAll('#workoutContainer .workout-set-row[data-e][data-s]').forEach(row => {
      draft.completed[doneKey(row.dataset.e, row.dataset.s)] = row.classList.contains("set-completed");
    });
    draft.planIndex = index;
  }

  async function flushDraft() {
    clearTimeout(draftTimer);
    draftTimer = null;
    if (!App.db || !App.state.plans.length) return;
    draftStore[String(draft.planIndex)] = { ...clone(draft), savedAt: new Date().toISOString() };
    await Promise.all([
      App.idbSet(DRAFTS_KEY, clone(draftStore)),
      App.idbSet(ACTIVE_PLAN_KEY, draft.planIndex)
    ]);
  }

  function queueDraftWrite() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => flushDraft().catch(error => console.warn("draft save", error)), 180);
  }

  async function clearDraft(index = currentPlanIndex()) {
    delete draftStore[String(index)];
    await App.idbSet(DRAFTS_KEY, clone(draftStore));
  }

  function hasDraft() {
    captureDraft();
    return Object.values(draft.sets || {}).some(value => String(value ?? "").trim() !== "") ||
      Object.values(draft.completed || {}).some(Boolean);
  }

  function progressionHtml(suggestion) {
    const weight = suggestion.weight === null || suggestion.weight === undefined ? "自选重量" : `${Number(suggestion.weight)} kg`;
    const confirm = suggestion.confirmation ? `<span class="context-chip">${suggestion.confirmation}/2</span>` : "";
    return `<section class="workout-context progression-context">
      <div class="context-head"><strong>本次计划</strong><span class="context-chip">${App.esc(suggestion.statusLabel)}</span>${confirm}</div>
      <div class="context-target">${App.esc(weight)} · ${App.esc((suggestion.reps || []).join(" / "))} 次</div>
      <div class="context-detail">${App.esc(suggestion.reason)}</div>
    </section>`;
  }

  function previousHtml(summary) {
    if (!summary) return "";
    return `<section class="workout-context previous-context">
      <div class="context-head"><strong>上次记录</strong></div>
      <div class="context-target">${App.esc(summary.target)}</div>
      ${summary.detail ? `<div class="context-detail">${App.esc(summary.detail)}</div>` : ""}
    </section>`;
  }

  function draftValue(ei, si, key) {
    const k = draftKey(ei, si, key);
    return Object.prototype.hasOwnProperty.call(draft.sets, k) ? draft.sets[k] : "";
  }

  function warmupPreset(ex, si) {
    return Array.isArray(ex?.setPresets) ? (ex.setPresets[si] || {}) : {};
  }

  function renderExerciseCard(ex, ei, plan, historyContext) {
    const history = historyContext.history(ex.name);
    const previous = history[0]?.exercise || null;
    const summary = previousSummary(previous);
    const suggestion = ex.warmup ? null : progressionSuggestion(ex, history);
    const [min, max] = repRange(ex);
    const sets = setCount(ex);
    const editorOpen = openEditors.has(ei);
    const meta = ex.warmup ? (ex.note || "专项热身；不计入正式组与进阶") : `${min}–${max} 次${ex.note ? ` · ${ex.note}` : ""}`;
    const contexts = ex.warmup
      ? `<div class="warmup-callout">${App.esc(ex.note || "专项热身；完成后进入正式工作组")}</div>`
      : `<div class="workout-context-grid">${previousHtml(summary)}${progressionHtml(suggestion)}</div>`;

    let rows = "";
    for (let si = 0; si < sets; si++) {
      const prev = previous?.sets?.[si] || null;
      const preset = warmupPreset(ex, si);
      const plannedWeight = ex.warmup ? (preset.weight ?? "") : (suggestion?.weight ?? "");
      const plannedReps = ex.warmup ? (preset.repsLabel ?? preset.reps ?? "") : (suggestion?.reps?.[si] ?? min);
      const weightValue = draftValue(ei, si, "weight");
      const repsValue = draftValue(ei, si, "reps");
      const rirValue = draftValue(ei, si, "rir");
      const done = !!draft.completed[doneKey(ei, si)];
      rows += `<div class="set-row workout-set-row${done ? " set-completed" : ""}" data-e="${ei}" data-s="${si}">
        <span class="set-number">${si + 1}</span>
        <input aria-label="第 ${si + 1} 组重量" type="number" step="0.5" inputmode="decimal" data-e="${ei}" data-s="${si}" data-k="weight" value="${App.esc(weightValue)}" placeholder="${App.esc(plannedWeight)}">
        <input aria-label="第 ${si + 1} 组次数" type="number" step="1" inputmode="numeric" data-e="${ei}" data-s="${si}" data-k="reps" value="${App.esc(repsValue)}" placeholder="${App.esc(plannedReps)}">
        <input aria-label="第 ${si + 1} 组 RIR" type="number" step="1" min="0" max="10" inputmode="numeric" data-e="${ei}" data-s="${si}" data-k="rir" value="${App.esc(rirValue)}" placeholder="${ex.warmup ? "" : App.esc(prev?.rir ?? "1–2")}">
        <button type="button" class="set-complete${done ? "" : " secondary"}" data-e="${ei}" data-s="${si}" aria-pressed="${done}">${done ? "✓" : "完成"}</button>
      </div>`;
    }

    return `<article class="card exercise-card${ex.warmup ? " warmup-card" : ""}" data-e="${ei}">
      <div class="exercise-head">
        <div class="exercise-title-wrap">
          <div class="exercise-title-line"><div class="exercise-title">${App.esc(ex.name || "未命名动作")}</div>${ex.optional ? '<span class="badge">可选</span>' : ""}${ex.warmup ? '<span class="badge warmup-badge">热身</span>' : ""}</div>
          <div class="exercise-meta">${App.esc(meta)}</div>
        </div>
        <button type="button" class="small secondary exercise-edit-toggle" data-e="${ei}">${editorOpen ? "收起" : "调整"}</button>
      </div>
      ${contexts}
      <div class="set-row set-header"><span>组</span><span>重量 kg</span><span>次数</span><span>RIR</span><span>完成</span></div>
      ${rows}
      <div class="exercise-inline-editor${editorOpen ? "" : " hidden"}" data-e="${ei}">
        <div class="inline-editor-grid">
          <label class="wide">动作名称<input data-edit="name" value="${App.esc(ex.name || "")}"></label>
          <label>最低次数<input data-edit="repMin" type="number" min="1" step="1" value="${min}"></label>
          <label>最高次数<input data-edit="repMax" type="number" min="1" step="1" value="${max}"></label>
          <label>默认 kg<input data-edit="defaultWeight" type="number" step="0.5" value="${ex.defaultWeight ?? ""}"></label>
          <label>重量档位 kg<input data-edit="weightStep" type="number" min="0" step="0.5" value="${weightStep(ex)}"></label>
        </div>
        <label>备注<textarea data-edit="note">${App.esc(ex.note || "")}</textarea></label>
        <div class="editor-actions">
          <div class="row wrap">
            <button type="button" class="small secondary remove-set" data-e="${ei}" ${sets <= 1 ? "disabled" : ""}>− 1组</button>
            <button type="button" class="small secondary add-set" data-e="${ei}">+ 1组</button>
          </div>
          <label class="row compact-check"><input data-edit="optional" type="checkbox" ${ex.optional ? "checked" : ""}> 可选动作</label>
          <button type="button" class="small danger delete-exercise-inline" data-e="${ei}">删除动作</button>
        </div>
      </div>
    </article>`;
  }

  function renderPlanSelect() {
    const select = document.getElementById("planSelect");
    if (!select) return;
    const wanted = Math.min(Math.max(0, draft.planIndex || 0), Math.max(0, App.state.plans.length - 1));
    if (!App.state.plans.length) {
      select.innerHTML = "<option>暂无训练计划</option>";
      select.disabled = true;
      return;
    }
    select.disabled = false;
    select.innerHTML = App.state.plans.map((plan, index) => `<option value="${index}">${App.esc(plan.name || `训练计划 ${index + 1}`)}</option>`).join("");
    select.value = String(wanted);
  }

  function renderWorkout() {
    const container = document.getElementById("workoutContainer");
    if (!container) return;
    if (!App.state.plans.length) {
      container.innerHTML = '<div class="card empty-state"><strong>当前没有训练计划</strong><span>可从 GitHub 拉取已有计划，或导入本地备份。</span></div>';
      return;
    }
    const pi = ensureDraftPlan();
    const plan = App.state.plans[pi] || App.state.plans[0];
    const historyContext = buildHistoryContext(plan.name);
    const exercises = plan.exercises || [];
    container.innerHTML = exercises.map((ex, ei) => renderExerciseCard(ex, ei, plan, historyContext)).join("") +
      '<div class="card add-exercise-card"><button id="addExerciseInlineBtn" type="button" class="secondary">+ 添加动作</button></div>';
  }

  async function persistPlanAndRender() {
    await App.persist("plans");
    renderPlanSelect();
    renderWorkout();
  }

  function trimLastSetDraft(ei, lastSi) {
    ["weight", "reps", "rir"].forEach(key => delete draft.sets[draftKey(ei, lastSi, key)]);
    delete draft.completed[doneKey(ei, lastSi)];
  }

  function shiftDraftAfterDeleteExercise(deletedEi) {
    const nextSets = {}, nextCompleted = {};
    for (const [key, value] of Object.entries(draft.sets)) {
      const [e, s, k] = key.split(":");
      const ei = Number(e);
      if (ei === deletedEi) continue;
      nextSets[draftKey(ei > deletedEi ? ei - 1 : ei, s, k)] = value;
    }
    for (const [key, value] of Object.entries(draft.completed)) {
      const [e, s] = key.split(":");
      const ei = Number(e);
      if (ei === deletedEi) continue;
      nextCompleted[doneKey(ei > deletedEi ? ei - 1 : ei, s)] = value;
    }
    draft.sets = nextSets;
    draft.completed = nextCompleted;
    const nextOpen = new Set();
    for (const index of openEditors) if (index !== deletedEi) nextOpen.add(index > deletedEi ? index - 1 : index);
    openEditors.clear();
    for (const index of nextOpen) openEditors.add(index);
  }

  async function workoutClick(event) {
    const button = event.target.closest("button");
    if (!button) return;
    const pi = ensureDraftPlan();
    const plan = App.state.plans[pi];
    if (!plan) return;
    const ei = Number(button.dataset.e);

    if (button.classList.contains("exercise-edit-toggle")) {
      const editor = button.closest(".exercise-card")?.querySelector(".exercise-inline-editor");
      if (!editor) return;
      const opening = editor.classList.contains("hidden");
      editor.classList.toggle("hidden", !opening);
      button.textContent = opening ? "收起" : "调整";
      if (opening) openEditors.add(ei); else openEditors.delete(ei);
      return;
    }

    if (button.classList.contains("set-complete")) {
      const si = Number(button.dataset.s);
      const row = button.closest(".workout-set-row");
      const done = !row.classList.contains("set-completed");
      row.classList.toggle("set-completed", done);
      button.classList.toggle("secondary", !done);
      button.textContent = done ? "✓" : "完成";
      button.setAttribute("aria-pressed", String(done));
      draft.completed[doneKey(ei, si)] = done;
      queueDraftWrite();
      return;
    }

    if (button.classList.contains("add-set")) {
      captureDraft();
      plan.exercises[ei].sets = setCount(plan.exercises[ei]) + 1;
      await persistPlanAndRender();
      queueDraftWrite();
      return;
    }

    if (button.classList.contains("remove-set")) {
      const ex = plan.exercises[ei], sets = setCount(ex);
      if (sets <= 1) return;
      captureDraft();
      trimLastSetDraft(ei, sets - 1);
      ex.sets = sets - 1;
      await persistPlanAndRender();
      queueDraftWrite();
      return;
    }

    if (button.classList.contains("delete-exercise-inline")) {
      if (!confirm("删除这个动作？历史训练记录会保留。")) return;
      captureDraft();
      plan.exercises.splice(ei, 1);
      shiftDraftAfterDeleteExercise(ei);
      await persistPlanAndRender();
      queueDraftWrite();
      return;
    }

    if (button.id === "addExerciseInlineBtn") {
      captureDraft();
      plan.exercises ??= [];
      plan.exercises.push({ name: "新动作", sets: 3, repRange: [8, 12], defaultWeight: null, weightStep: 5, note: "", optional: false });
      await persistPlanAndRender();
      queueDraftWrite();
    }
  }

  function workoutInput(event) {
    const input = event.target;
    if (!input.matches('input[data-e][data-s][data-k]')) return;
    ensureDraftPlan();
    draft.sets[draftKey(input.dataset.e, input.dataset.s, input.dataset.k)] = input.value;
    queueDraftWrite();
  }

  async function workoutChange(event) {
    const input = event.target;
    const editor = input.closest(".exercise-inline-editor");
    if (!editor || !input.dataset.edit) return;
    captureDraft();
    const pi = ensureDraftPlan(), ei = Number(editor.dataset.e);
    const ex = App.state.plans?.[pi]?.exercises?.[ei];
    if (!ex) return;
    const field = input.dataset.edit;
    if (field === "name") ex.name = input.value.trim() || "未命名动作";
    else if (field === "repMin") { ex.repRange ??= [8, 12]; ex.repRange[0] = Math.max(1, Number(input.value) || 1); }
    else if (field === "repMax") { ex.repRange ??= [8, 12]; ex.repRange[1] = Math.max(1, Number(input.value) || 1); }
    else if (field === "defaultWeight") ex.defaultWeight = valueOrNull(input.value);
    else if (field === "weightStep") ex.weightStep = Math.max(0, Number(input.value) || 0);
    else if (field === "note") ex.note = input.value;
    else if (field === "optional") ex.optional = input.checked;
    await App.persist("plans");
    renderWorkout();
    queueDraftWrite();
  }

  async function saveWorkout() {
    if (!App.state.plans.length) return;
    const pi = ensureDraftPlan();
    const plan = App.state.plans[pi];
    captureDraft();
    const historyContext = buildHistoryContext(plan.name);
    const plannedByName = new Map();
    for (const ex of plan.exercises || []) if (!ex.warmup) plannedByName.set(ex.name, progressionSuggestion(ex, historyContext.history(ex.name)));

    const exercises = (plan.exercises || []).map((ex, ei) => {
      const previous = historyContext.latest(ex.name);
      const sets = [];
      for (let si = 0; si < setCount(ex); si++) {
        const raw = {
          weight: draft.sets[draftKey(ei, si, "weight")],
          reps: draft.sets[draftKey(ei, si, "reps")],
          rir: draft.sets[draftKey(ei, si, "rir")]
        };
        const completed = !!draft.completed[doneKey(ei, si)];
        const touched = Object.values(raw).some(value => value !== "" && value !== undefined && value !== null);
        if (!completed && !touched) continue;

        const prev = previous?.sets?.[si] || null;
        const preset = warmupPreset(ex, si);
        let weight = valueOrNull(raw.weight), reps = valueOrNull(raw.reps), rir = valueOrNull(raw.rir);
        if (weight === null && (reps !== null || completed)) {
          if (ex.warmup && valueOrNull(preset.weight) !== null) weight = valueOrNull(preset.weight);
          else if (valueOrNull(prev?.weight) !== null) weight = valueOrNull(prev.weight);
          else if (valueOrNull(ex.defaultWeight) !== null) weight = valueOrNull(ex.defaultWeight);
        }
        if (reps === null && completed) {
          if (ex.warmup && valueOrNull(preset.reps) !== null) reps = valueOrNull(preset.reps);
          else if (valueOrNull(prev?.reps) !== null) reps = valueOrNull(prev.reps);
        }
        sets.push({ weight, reps, rir, completed });
      }
      const result = { name: ex.name, sets };
      if (sets.length && !ex.warmup) {
        const planned = plannedByName.get(ex.name);
        result.planned = {
          version: planned.version, weight: planned.weight, reps: [...planned.reps],
          repRange: [...planned.repRange], weightStep: planned.weightStep, status: planned.status
        };
        const actualWeight = workingWeight(sets);
        result.weightOverride = planned.weight !== null && actualWeight !== null && actualWeight !== planned.weight;
      }
      return result;
    }).filter(ex => ex.sets.length);

    if (!exercises.length) {
      App.toast("还没有输入训练数据", "error");
      return;
    }

    App.state.sessions.push({ id: crypto.randomUUID(), date: App.isoDate(), plan: plan.name, exercises });
    await App.persist("workout");
    await clearDraft(pi);
    draft = { planIndex: pi, sets: {}, completed: {} };
    renderWorkout();
    App.toast("本次训练已保存", "success");
  }

  async function resetWorkout() {
    const pi = currentPlanIndex();
    if (hasDraft() && !confirm("清空本次未保存输入？")) return;
    draft = { planIndex: pi, sets: {}, completed: {} };
    await clearDraft(pi);
    renderWorkout();
  }

  async function changePlan() {
    captureDraft();
    await flushDraft();
    const pi = currentPlanIndex();
    ensureDraftPlan(pi);
    await App.idbSet(ACTIVE_PLAN_KEY, pi);
    openEditors.clear();
    renderWorkout();
  }

  function bindEvents() {
    const workout = document.getElementById("workoutContainer");
    workout.addEventListener("click", workoutClick);
    workout.addEventListener("input", workoutInput);
    workout.addEventListener("change", workoutChange);
    document.getElementById("planSelect").onchange = changePlan;
    document.getElementById("saveWorkoutBtn").onclick = saveWorkout;
    document.getElementById("resetWorkoutBtn").onclick = resetWorkout;
    document.addEventListener("visibilitychange", () => { if (document.hidden) { captureDraft(); flushDraft().catch(() => {}); } });
    window.addEventListener("pagehide", () => { captureDraft(); flushDraft().catch(() => {}); });
  }

  async function init() {
    draftStore = await App.idbGet(DRAFTS_KEY) || {};
    let pi = Number(await App.idbGet(ACTIVE_PLAN_KEY));
    if (!Number.isInteger(pi) || pi < 0 || pi >= App.state.plans.length) pi = 0;
    const saved = draftStore[String(pi)];
    draft = saved ? { planIndex: pi, sets: clone(saved.sets || {}), completed: clone(saved.completed || {}) } : { planIndex: pi, sets: {}, completed: {} };
    bindEvents();
    Insights.init();
    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 600));
    idle(async () => {
      try {
        await Maintenance.cleanupDuplicates();
        if (navigator.storage?.persist) await navigator.storage.persist();
      } catch (error) { console.warn("maintenance", error); }
    }, { timeout: 1800 });
  }

  async function refresh(reason) {
    renderPlanSelect();
    ensureDraftPlan(Math.min(draft.planIndex, Math.max(0, App.state.plans.length - 1)));
    renderWorkout();
    Insights.refresh(reason);
  }

  async function onPage(id) {
    Insights.onPage(id);
  }

  async function onDataReset() {
    clearTimeout(draftTimer);
    draftStore = {};
    draft = { planIndex: 0, sets: {}, completed: {} };
    openEditors.clear();
    await Promise.all([App.idbSet(DRAFTS_KEY, {}), App.idbSet(ACTIVE_PLAN_KEY, 0)]);
  }

  async function prepareRemotePlans(oldPlanName, plansChanged) {
    let index = App.state.plans.findIndex(plan => plan.name === oldPlanName);
    if (index < 0) index = 0;
    if (plansChanged) {
      draftStore = {};
      await App.idbSet(DRAFTS_KEY, {});
    }
    draft = { planIndex: index, sets: {}, completed: {} };
    await App.idbSet(ACTIVE_PLAN_KEY, index);
    openEditors.clear();
  }

  App.training = {
    currentPlanIndex, hasDraft, captureDraft, flushDraft,
    cleanupDuplicates: Maintenance.cleanupDuplicates,
    prepareRemotePlans,
    get currentPlanName() { return App.state.plans[currentPlanIndex()]?.name || ""; }
  };

  App.registerModule({ init, refresh, onPage, onDataReset });
})();
