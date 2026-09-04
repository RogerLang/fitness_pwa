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

  const { valueOrNull, workingWeight, buildHistoryContext } = Progression;

  function currentPlan() {
    const active = Renderer.currentWorkoutEntry();
    if (!active) return { pi: Draft.ensurePlan(), plan: null, workout: null };
    Draft.ensurePlan(active.index);
    return { pi: active.index, plan: active.plan, workout: active.workout };
  }

  async function workoutClick(event) {
    const button = event.target.closest("button");
    if (!button) return;

    if (button.classList.contains("go-plan-page")) {
      await App.switchPage("plan", { historyMode: "replace" });
      return;
    }

    const { plan, workout } = currentPlan();
    if (!plan || !workout) return;
    const ei = Number(button.dataset.e);
    const plannedExercise = workout.exercises?.[ei];
    if (!plannedExercise) return;

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
      const base = Math.max(1, plannedExercise.sets?.length || 1);
      const next = Draft.effectiveSetCount(ei, base) + 1;
      if (next === base) Draft.clearSetCount(ei);
      else Draft.setSetCount(ei, next);
      Renderer.renderWorkout();
      Draft.queueWrite();
      return;
    }

    if (button.classList.contains("remove-set")) {
      Draft.capture();
      const base = Math.max(1, plannedExercise.sets?.length || 1);
      const current = Draft.effectiveSetCount(ei, base);
      if (current <= 1) return;
      const next = current - 1;
      Draft.trimFromSet(ei, next);
      if (next === base) Draft.clearSetCount(ei);
      else Draft.setSetCount(ei, next);
      Renderer.renderWorkout();
      Draft.queueWrite();
    }
  }

  function workoutInput(event) {
    const input = event.target;
    if (!input.matches('input[data-e][data-s][data-k]')) return;
    const active = Renderer.currentWorkoutEntry();
    if (!active) return;
    Draft.ensurePlan(active.index);
    Draft.setValue(input.dataset.e, input.dataset.s, input.dataset.k, input.value);
    Draft.queueWrite();
  }

  function plannedTarget(ex, si) {
    const sets = Array.isArray(ex?.sets) ? ex.sets : [];
    return sets[si] || sets[sets.length - 1] || {};
  }

  async function saveWorkout() {
    if (!App.state.plans.length) return;
    const { pi, plan, workout } = currentPlan();
    if (!plan || !workout) {
      App.toast("请先在计划页推送训练计划", "error");
      return;
    }

    Draft.capture();
    const sessionPlanName = workout.planName || plan.name;
    const historyContext = buildHistoryContext(sessionPlanName);
    const exercises = (workout.exercises || []).map((ex, ei) => {
      const previous = historyContext.latest(ex.name);
      const baseCount = Math.max(1, ex.sets?.length || 1);
      const count = Draft.effectiveSetCount(ei, baseCount);
      const sets = [];

      for (let si = 0; si < count; si++) {
        const raw = {
          weight: Draft.getValue(ei, si, "weight"),
          reps: Draft.getValue(ei, si, "reps"),
          rir: Draft.getValue(ei, si, "rir")
        };
        const completed = Draft.isCompleted(ei, si);
        const touched = Object.values(raw).some(value => value !== "" && value !== undefined && value !== null);
        if (!completed && !touched) continue;

        const target = plannedTarget(ex, si);
        const prev = previous?.sets?.[si] || null;
        let weight = valueOrNull(raw.weight);
        let reps = valueOrNull(raw.reps);
        const rir = valueOrNull(raw.rir);

        if (weight === null && (reps !== null || completed)) {
          if (valueOrNull(target.weight) !== null) weight = valueOrNull(target.weight);
          else if (valueOrNull(prev?.weight) !== null) weight = valueOrNull(prev.weight);
        }
        if (reps === null && completed) {
          if (valueOrNull(target.reps) !== null) reps = valueOrNull(target.reps);
          else if (valueOrNull(prev?.reps) !== null) reps = valueOrNull(prev.reps);
        }
        sets.push({ weight, reps, rir, completed });
      }

      const result = {
        name: ex.name,
        sets,
        planned: {
          workoutId: workout.id,
          revision: workout.revision,
          sets: Array.from({ length: count }, (_, si) => ({ ...plannedTarget(ex, si) }))
        }
      };

      if (sets.length && !ex.warmup) {
        const plannedWeight = workingWeight(result.planned.sets);
        const actualWeight = workingWeight(sets);
        result.weightOverride = plannedWeight !== null && actualWeight !== null && actualWeight !== plannedWeight;
      }
      return result;
    }).filter(ex => ex.sets.length);

    if (!exercises.length) {
      App.toast("还没有输入训练数据", "error");
      return;
    }

    const sessionId = crypto.randomUUID();
    App.state.sessions.push({
      id: sessionId,
      date: App.isoDate(),
      plan: sessionPlanName,
      plannedWorkoutId: workout.id,
      plannedRevision: workout.revision,
      exercises
    });

    if (plan.plannedWorkout?.status === "confirmed" && plan.plannedWorkout.revision === workout.revision) {
      plan.plannedWorkout = {
        ...workout,
        status: "completed",
        completedAt: new Date().toISOString(),
        completedSessionId: sessionId
      };
    }

    await App.persist("plans");
    App.planning?.invalidate?.(pi);
    await Draft.resetPlan(pi);
    Renderer.renderWorkout();
    App.toast("本次训练已保存，下一次可重新制定计划", "success");
  }

  async function resetWorkout() {
    const active = Renderer.currentWorkoutEntry();
    const pi = active?.index ?? Draft.currentPlanIndex();
    Draft.ensurePlan(pi);
    if (Draft.hasData() && !confirm("清空本次未保存输入和临时组数调整？")) return;
    await Draft.resetPlan(pi);
    Renderer.renderWorkout();
  }

  function bindEvents() {
    const workout = document.getElementById("workoutContainer");
    workout.addEventListener("click", workoutClick);
    workout.addEventListener("input", workoutInput);
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
    const active = Renderer.currentWorkoutEntry();
    if (active) Draft.ensurePlan(active.index);
    Renderer.renderWorkout();
    Insights.refresh(reason);
  }

  async function onPage(id) {
    Insights.onPage(id);
  }

  async function onDataReset() {
    await Draft.resetAll();
  }

  async function prepareRemotePlans(oldPlanName, plansChanged) {
    await Draft.prepareRemotePlans(oldPlanName, plansChanged);
  }

  App.training = {
    currentPlanIndex: Draft.currentPlanIndex,
    hasDraft: Draft.hasData,
    captureDraft: Draft.capture,
    flushDraft: Draft.flush,
    cleanupDuplicates: Maintenance.cleanupDuplicates,
    prepareRemotePlans,
    get currentPlanName() {
      const active = Renderer.currentWorkoutEntry();
      return active?.plan?.name || active?.workout?.planName || "";
    }
  };

  App.registerModule({ init, refresh, onPage, onDataReset });
})();
