(() => {
  const App = window.FitnessApp;

  function confirmedEntries() {
    return (App.state.plans || [])
      .map((plan, index) => ({ index, plan, workout: plan?.plannedWorkout }))
      .filter(entry => entry.workout?.status === "confirmed" && Array.isArray(entry.workout.exercises));
  }

  function newest(entries) {
    return [...entries].sort((a, b) => {
      const at = String(a.workout?.confirmedAt || a.workout?.generatedAt || "");
      const bt = String(b.workout?.confirmedAt || b.workout?.generatedAt || "");
      return bt.localeCompare(at) || b.index - a.index;
    })[0] || null;
  }

  function current(preferredIndex = null) {
    const entries = confirmedEntries();
    if (!entries.length) return null;
    const preferred = Number(preferredIndex);
    if (Number.isInteger(preferred) && preferred >= 0) {
      const match = entries.find(entry => entry.index === preferred);
      if (match) return match;
    }
    return newest(entries);
  }

  function normalizeSingle(preferredIndex = null) {
    const entries = confirmedEntries();
    if (entries.length <= 1) return { changed: false, current: entries[0] || null };
    const keep = current(preferredIndex);
    const replacedAt = new Date().toISOString();
    for (const entry of entries) {
      if (entry.index === keep.index) continue;
      entry.plan.plannedWorkout = {
        ...entry.workout,
        status: "replaced",
        replacedAt,
        replacedByPlanName: keep.plan?.name || keep.workout?.planName || ""
      };
    }
    return { changed: true, current: keep };
  }

  function replaceOthers(keepIndex, replacement = {}) {
    const replacedAt = new Date().toISOString();
    let changed = false;
    for (const entry of confirmedEntries()) {
      if (entry.index === keepIndex) continue;
      entry.plan.plannedWorkout = {
        ...entry.workout,
        status: "replaced",
        replacedAt,
        ...replacement
      };
      changed = true;
    }
    return changed;
  }

  window.TrainingNextWorkout = Object.freeze({
    confirmedEntries,
    current,
    normalizeSingle,
    replaceOthers
  });
})();
