(() => {
  const STORE_KEY = "planningCandidatesV1";

  function create(App, Progression = window.TrainingProgression) {
    if (!App || !Progression) throw new Error("Candidate Workout dependencies are missing");

    const {
      valueOrNull,
      loadType,
      usesWeight,
      setCount,
      buildHistoryContext,
      progressionSuggestion
    } = Progression;

    const clone = value => JSON.parse(JSON.stringify(value));
    let candidates = {};
    let savePromise = Promise.resolve();
    const warnedStale = new Set();

    function fingerprint(value) {
      const text = JSON.stringify(value ?? null);
      let h1 = 0x811c9dc5;
      let h2 = 0x9e3779b9;
      for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ code, 0x01000193);
        h2 = Math.imul(h2 ^ code, 0x85ebca6b);
      }
      return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
    }

    function templateSig(plan) {
      if (!plan) return "";
      return fingerprint({ planId: plan.planId || "", name: plan.name || "", exercises: plan.exercises || [] });
    }

    function historySig(plan) {
      if (!plan) return "";
      const planId = String(plan.planId || "");
      const name = String(plan.name || "");
      const records = (App.state.sessions || [])
        .filter(session => (planId && String(session?.planId || "") === planId) || (!planId && String(session?.plan || "") === name) || String(session?.plan || "") === name)
        .map(session => [String(session?.id || ""), String(session?.completedAt || session?.date || "")])
        .sort((a, b) => a[0].localeCompare(b[0]));
      return fingerprint(records);
    }

    function basis(plan) {
      return { templateSig: templateSig(plan), historySig: historySig(plan) };
    }

    function keyForPlan(plan) {
      return String(plan?.planId || plan?.name || "").trim();
    }

    function queueSave() {
      const snapshot = clone(candidates);
      savePromise = savePromise.catch(() => {}).then(() => App.idbSet(STORE_KEY, snapshot));
      return savePromise;
    }

    function warmupSet(exercise, setIndex) {
      return Array.isArray(exercise?.setPresets) ? (exercise.setPresets[setIndex] || {}) : {};
    }

    function suggestionSnapshot(plan) {
      const historyContext = buildHistoryContext(plan);
      const exercises = (plan.exercises || []).map(exercise => {
        const type = loadType(exercise);
        if (exercise.warmup) {
          const count = setCount(exercise);
          return {
            name: exercise.name,
            exerciseId: exercise.exerciseId || "",
            warmup: true,
            loadType: type,
            note: exercise.note || "",
            repRange: null,
            weightStep: 0,
            suggestionLabel: "专项热身",
            reason: exercise.note || "按预设完成后进入正式工作组。",
            sets: Array.from({ length: count }, (_, setIndex) => {
              const preset = warmupSet(exercise, setIndex);
              return {
                weight: usesWeight(exercise) ? valueOrNull(preset.weight) : null,
                reps: valueOrNull(preset.reps ?? preset.repsLabel)
              };
            })
          };
        }

        const history = historyContext.history(exercise);
        const suggestion = progressionSuggestion(exercise, history);
        return {
          name: exercise.name,
          exerciseId: exercise.exerciseId || "",
          warmup: false,
          loadType: type,
          note: exercise.note || "",
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
        planId: plan.planId || "",
        planName: plan.name,
        generatedAt: new Date().toISOString(),
        exercises
      };
    }

    function newEntry(plan) {
      return {
        planId: plan.planId || "",
        planName: plan.name || "",
        workout: suggestionSnapshot(plan),
        edited: false,
        stale: false,
        staleReason: "",
        ...basis(plan)
      };
    }

    function entryForPlan(plan, { notify = true } = {}) {
      if (!plan) return null;
      const key = keyForPlan(plan);
      let entry = candidates[key];
      const currentBasis = basis(plan);

      if (!entry?.workout || String(entry.planId || "") !== String(plan.planId || "")) {
        entry = newEntry(plan);
        candidates[key] = entry;
        queueSave();
        return entry;
      }

      const templateChanged = entry.templateSig !== currentBasis.templateSig;
      const historyChanged = entry.historySig !== currentBasis.historySig;
      if (templateChanged || historyChanged) {
        if (entry.edited) {
          entry.stale = true;
          entry.staleReason = templateChanged ? "训练模板已更新" : "训练记录已更新";
          candidates[key] = entry;
          queueSave();
          if (notify && !warnedStale.has(key)) {
            warnedStale.add(key);
            App.toast("训练依据已更新，已保留你的当前调整", "info");
          }
        } else {
          entry = newEntry(plan);
          candidates[key] = entry;
          warnedStale.delete(key);
          queueSave();
        }
      }
      return entry;
    }

    function draftForPlan(plan) {
      return entryForPlan(plan)?.workout || null;
    }

    function markEdited(plan) {
      const entry = entryForPlan(plan, { notify: false });
      if (!plan || !entry) return;
      entry.edited = true;
      entry.stale = false;
      entry.staleReason = "";
      Object.assign(entry, basis(plan));
      candidates[keyForPlan(plan)] = entry;
      warnedStale.delete(keyForPlan(plan));
      queueSave();
    }

    function regenerate(plan) {
      if (!plan) return null;
      const entry = newEntry(plan);
      candidates[keyForPlan(plan)] = entry;
      warnedStale.delete(keyForPlan(plan));
      queueSave();
      return entry;
    }

    function keep(plan) {
      const entry = entryForPlan(plan, { notify: false });
      if (!plan || !entry) return null;
      Object.assign(entry, basis(plan), { stale: false, staleReason: "", edited: true });
      candidates[keyForPlan(plan)] = entry;
      warnedStale.delete(keyForPlan(plan));
      queueSave();
      return entry;
    }

    function invalidate(plan, options = {}) {
      if (!plan) return null;
      if (options?.force || options?.regenerate) return regenerate(plan);

      const key = keyForPlan(plan);
      const entry = candidates[key];
      if (!entry) return null;
      const currentBasis = basis(plan);
      if (entry.edited) {
        entry.stale = true;
        entry.staleReason = entry.templateSig !== currentBasis.templateSig ? "训练模板已更新" : "训练记录已更新";
        candidates[key] = entry;
        queueSave();
        return entry;
      }
      return regenerate(plan);
    }

    function refreshPlans(plans = []) {
      for (const plan of plans) entryForPlan(plan, { notify: false });
    }

    async function init() {
      const stored = await App.idbGet(STORE_KEY);
      candidates = stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
    }

    async function reset() {
      candidates = {};
      warnedStale.clear();
      await App.idbSet(STORE_KEY, {});
    }

    return Object.freeze({
      init,
      reset,
      entryForPlan,
      draftForPlan,
      markEdited,
      regenerate,
      keep,
      invalidate,
      refreshPlans,
      templateSig
    });
  }

  window.TrainingCandidateWorkout = Object.freeze({ create });
})();
