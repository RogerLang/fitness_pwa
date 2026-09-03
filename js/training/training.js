(() => {
  const App = window.FitnessApp;
  const Progression = window.TrainingProgression;
  const Draft = window.TrainingDraft;
  const Renderer = window.TrainingRenderer;
  const Insights = window.TrainingInsights;
  const Maintenance = window.TrainingMaintenance;
  if (!Progression || !Draft || !Renderer || !Insights || !Maintenance) {
    throw new Error("Training modules must load before training.js");
  }

  const {
    valueOrNull,
    setCount,
    workingWeight,
    buildHistoryContext,
    progressionSuggestion
  } = Progression;

  async function persistPlanAndRender() {
    await App.persist("plans");
    Renderer.renderPlanSelect();
    Renderer.renderWorkout();
  }

  async function workoutClick(event) {
    const button = event.target.closest("button");
    if (!button) return;
    const pi = Draft.ensurePlan();
    const plan = App.state.plans[pi];
    if (!plan) return;
    const ei = Number(button.dataset.e);

    if (button.classList.contains("exercise-edit-toggle")) {
      Renderer.toggleEditor(button, ei);
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
      Draft.setCompleted(ei, si, done);
      Draft.queueWrite();
      return;
    }

    if (button.classList.contains("add-set")) {
      Draft.capture();
      plan.exercises[ei].sets = setCount(plan.exercises[ei]) + 1;
      await persistPlanAndRender();
      Draft.queueWrite();
      return;
    }

    if (button.classList.contains("remove-set")) {
      const ex = plan.exercises[ei];
      const sets = setCount(ex);
      if (sets <= 1) return;
      Draft.capture();
      Draft.trimLastSet(ei, sets - 1);
      ex.sets = sets - 1;
      await persistPlanAndRender();
      Draft.queueWrite();
      return;
    }

    if (button.classList.contains("delete-exercise-inline")) {
      if (!confirm("删除这个动作？历史训练记录会保留。")) return;
      Draft.capture();
      plan.exercises.splice(ei, 1);
      Draft.shiftAfterDeleteExercise(ei);
      Renderer.shiftEditorsAfterDeleteExercise(ei);
      await persistPlanAndRender();
      Draft.queueWrite();
      return;
    }

    if (button.id === "addExerciseInlineBtn") {
      Draft.capture();
      plan.exercises ??= [];
      plan.exercises.push({ name: "新动作", sets: 3, repRange: [8, 12], defaultWeight: null, weightStep: 5, note: "", optional: false });
      await persistPlanAndRender();
      Draft.queueWrite();
    }
  }

  function workoutInput(event) {
    const input = event.target;
    if (!input.matches('input[data-e][data-s][data-k]')) return;
    Draft.ensurePlan();
    Draft.setValue(input.dataset.e, input.dataset.s, input.dataset.k, input.value);
    Draft.queueWrite();
  }

  async function workoutChange(event) {
    const input = event.target;
    const editor = input.closest(".exercise-inline-editor");
    if (!editor || !input.dataset.edit) return;
    Draft.capture();
    const pi = Draft.ensurePlan();
    const ei = Number(editor.dataset.e);
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
    Renderer.renderWorkout();
    Draft.queueWrite();
  }

  async function saveWorkout() {
    if (!App.state.plans.length) return;
    const pi = Draft.ensurePlan();
    const plan = App.state.plans[pi];
    Draft.capture();
    const historyContext = buildHistoryContext(plan.name);
    const plannedByName = new Map();
    for (const ex of plan.exercises || []) {
      if (!ex.warmup) plannedByName.set(ex.name, progressionSuggestion(ex, historyContext.history(ex.name)));
    }

    const exercises = (plan.exercises || []).map((ex, ei) => {
      const previous = historyContext.latest(ex.name);
      const sets = [];
      for (let si = 0; si < setCount(ex); si++) {
        const raw = {
          weight: Draft.getValue(ei, si, "weight"),
          reps: Draft.getValue(ei, si, "reps"),
          rir: Draft.getValue(ei, si, "rir")
        };
        const completed = Draft.isCompleted(ei, si);
        const touched = Object.values(raw).some(value => value !== "" && value !== undefined && value !== null);
        if (!completed && !touched) continue;

        const prev = previous?.sets?.[si] || null;
        const preset = Renderer.warmupPreset(ex, si);
        let weight = valueOrNull(raw.weight);
        let reps = valueOrNull(raw.reps);
        const rir = valueOrNull(raw.rir);
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
          version: planned.version,
          weight: planned.weight,
          reps: [...planned.reps],
          repRange: [...planned.repRange],
          weightStep: planned.weightStep,
          status: planned.status
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
    await Draft.resetPlan(pi);
    Renderer.renderWorkout();
    App.toast("本次训练已保存", "success");
  }

  async function resetWorkout() {
    const pi = Draft.currentPlanIndex();
    if (Draft.hasData() && !confirm("清空本次未保存输入？")) return;
    await Draft.resetPlan(pi);
    Renderer.renderWorkout();
  }

  async function changePlan() {
    Draft.capture();
    await Draft.flush();
    const pi = Draft.currentPlanIndex();
    Draft.ensurePlan(pi);
    await Draft.setActivePlan(pi);
    Renderer.clearEditors();
    Renderer.renderWorkout();
  }

  function bindEvents() {
    const workout = document.getElementById("workoutContainer");
    workout.addEventListener("click", workoutClick);
    workout.addEventListener("input", workoutInput);
    workout.addEventListener("change", workoutChange);
    document.getElementById("planSelect").onchange = changePlan;
    document.getElementById("saveWorkoutBtn").onclick = saveWorkout;
    document.getElementById("resetWorkoutBtn").onclick = resetWorkout;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        Draft.capture();
        Draft.flush().catch(() => {});
      }
    });
    window.addEventListener("pagehide", () => {
      Draft.capture();
      Draft.flush().catch(() => {});
    });
  }

  async function init() {
    await Draft.init();
    bindEvents();
    Insights.init();
    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 600));
    idle(async () => {
      try {
        await Maintenance.cleanupDuplicates();
        if (navigator.storage?.persist) await navigator.storage.persist();
      } catch (error) {
        console.warn("maintenance", error);
      }
    }, { timeout: 1800 });
  }

  async function refresh(reason) {
    Renderer.renderPlanSelect();
    Draft.ensurePlan(Math.min(Draft.planIndex, Math.max(0, App.state.plans.length - 1)));
    Renderer.renderWorkout();
    Insights.refresh(reason);
  }

  async function onPage(id) {
    Insights.onPage(id);
  }

  async function onDataReset() {
    await Draft.resetAll();
    Renderer.clearEditors();
  }

  async function prepareRemotePlans(oldPlanName, plansChanged) {
    await Draft.prepareRemotePlans(oldPlanName, plansChanged);
    Renderer.clearEditors();
  }

  App.training = {
    currentPlanIndex: Draft.currentPlanIndex,
    hasDraft: Draft.hasData,
    captureDraft: Draft.capture,
    flushDraft: Draft.flush,
    cleanupDuplicates: Maintenance.cleanupDuplicates,
    prepareRemotePlans,
    get currentPlanName() { return App.state.plans[Draft.currentPlanIndex()]?.name || ""; }
  };

  App.registerModule({ init, refresh, onPage, onDataReset });
})();
