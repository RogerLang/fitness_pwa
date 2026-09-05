(() => {
  const App = window.FitnessApp;
  const NextWorkout = window.TrainingNextWorkout;
  if (!NextWorkout) throw new Error("TrainingNextWorkout must load before TrainingDraft");

  const DRAFTS_KEY = "workoutDraftsV9";
  const LEGACY_DRAFTS_KEYS = ["workoutDraftsV8", "workoutDraftsV7"];
  const ACTIVE_PLAN_KEY = "workoutActivePlanV8";
  const LEGACY_ACTIVE_PLAN_KEY = "workoutActivePlanV7";

  let draftStore = {};
  let draft = emptyDraft("");
  let draftTimer = null;

  const clone = value => JSON.parse(JSON.stringify(value));
  const draftKey = (exerciseId, si, key) => `${exerciseId}:${si}:${key}`;
  const doneKey = (exerciseId, si) => `${exerciseId}:${si}`;
  const countKey = exerciseId => String(exerciseId || "");

  function normalizedId(value) {
    return String(value || "").trim();
  }

  function planById(planId) {
    const id = normalizedId(planId);
    return id ? (App.state.plans || []).find(plan => normalizedId(plan?.planId) === id) || null : null;
  }

  function planIdFromIndex(index) {
    return normalizedId(App.state.plans?.[Number(index)]?.planId);
  }

  function emptyDraft(planId) {
    return { planId: normalizedId(planId), sets: {}, completed: {}, setCounts: {} };
  }

  function normalizeDraft(saved, planId) {
    return {
      planId: normalizedId(planId),
      sets: clone(saved?.sets || {}),
      completed: clone(saved?.completed || {}),
      setCounts: clone(saved?.setCounts || {})
    };
  }

  function draftHasData(source = draft) {
    return Object.values(source?.sets || {}).some(value => String(value ?? "").trim() !== "") ||
      Object.values(source?.completed || {}).some(Boolean) ||
      Object.keys(source?.setCounts || {}).length > 0;
  }

  function activePlanId() {
    const active = NextWorkout.current();
    return normalizedId(active?.workout?.planId || active?.planId);
  }

  function currentPlanId() {
    const active = activePlanId();
    if (active) return active;
    if (draftHasData(draft) && draft.planId && planById(draft.planId)) return draft.planId;
    if (draft.planId && planById(draft.planId)) return draft.planId;
    return normalizedId(App.state.plans?.[0]?.planId);
  }

  function ensurePlan(planId = currentPlanId()) {
    const nextId = normalizedId(planId) || normalizedId(App.state.plans?.[0]?.planId);
    if (draft.planId !== nextId) {
      const saved = draftStore[nextId];
      draft = saved ? normalizeDraft(saved, nextId) : emptyDraft(nextId);
    }
    return nextId;
  }

  function capture() {
    const planId = ensurePlan();
    document.querySelectorAll('#workoutContainer input[data-exercise-id][data-s][data-k]').forEach(input => {
      const exerciseId = normalizedId(input.dataset.exerciseId);
      if (!exerciseId) return;
      draft.sets[draftKey(exerciseId, input.dataset.s, input.dataset.k)] = input.value;
    });
    document.querySelectorAll('#workoutContainer .workout-set-row[data-exercise-id][data-s]').forEach(row => {
      const exerciseId = normalizedId(row.dataset.exerciseId);
      if (!exerciseId) return;
      draft.completed[doneKey(exerciseId, row.dataset.s)] = row.classList.contains("set-completed");
    });
    draft.planId = planId;
  }

  async function flush() {
    clearTimeout(draftTimer);
    draftTimer = null;
    if (!App.db || !App.state.plans.length) return;
    const planId = ensurePlan();
    if (!planId) return;
    draftStore[planId] = { ...clone(draft), savedAt: new Date().toISOString() };
    await Promise.all([
      App.idbSet(DRAFTS_KEY, clone(draftStore)),
      App.idbSet(ACTIVE_PLAN_KEY, planId)
    ]);
  }

  function queueWrite() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => flush().catch(error => console.warn("draft save", error)), 180);
  }

  async function clearPlan(planId = currentPlanId()) {
    const id = normalizedId(planId);
    if (!id) return;
    delete draftStore[id];
    await App.idbSet(DRAFTS_KEY, clone(draftStore));
  }

  function hasData() {
    capture();
    return draftHasData(draft);
  }

  function getValue(exerciseId, si, key) {
    const k = draftKey(normalizedId(exerciseId), si, key);
    return Object.prototype.hasOwnProperty.call(draft.sets, k) ? draft.sets[k] : "";
  }

  function setValue(exerciseId, si, key, value) {
    const id = normalizedId(exerciseId);
    if (!id) return;
    draft.sets[draftKey(id, si, key)] = value;
  }

  function isCompleted(exerciseId, si) {
    return !!draft.completed[doneKey(normalizedId(exerciseId), si)];
  }

  function setCompleted(exerciseId, si, completed) {
    const id = normalizedId(exerciseId);
    if (!id) return;
    draft.completed[doneKey(id, si)] = completed;
  }

  function effectiveSetCount(exerciseId, baseCount) {
    const value = Number(draft.setCounts[countKey(exerciseId)]);
    return Number.isInteger(value) && value > 0 ? value : Math.max(1, Number(baseCount) || 1);
  }

  function setSetCount(exerciseId, count) {
    const id = normalizedId(exerciseId);
    if (!id) return;
    draft.setCounts[countKey(id)] = Math.max(1, Math.round(Number(count) || 1));
  }

  function clearSetCount(exerciseId) {
    delete draft.setCounts[countKey(exerciseId)];
  }

  function trimFromSet(exerciseId, fromSi) {
    const id = normalizedId(exerciseId);
    if (!id) return;
    const prefix = `${id}:`;
    for (const key of Object.keys(draft.sets)) {
      if (!key.startsWith(prefix)) continue;
      const parts = key.slice(prefix.length).split(":");
      if (Number(parts[0]) >= Number(fromSi)) delete draft.sets[key];
    }
    for (const key of Object.keys(draft.completed)) {
      if (!key.startsWith(prefix)) continue;
      const si = Number(key.slice(prefix.length));
      if (si >= Number(fromSi)) delete draft.completed[key];
    }
  }

  function exerciseIdsForLegacyPlan(planId) {
    const active = NextWorkout.current();
    if (normalizedId(active?.workout?.planId) === normalizedId(planId)) {
      return (active.workout.exercises || []).map(ex => normalizedId(ex?.exerciseId));
    }
    return (planById(planId)?.exercises || []).map(ex => normalizedId(ex?.exerciseId));
  }

  function migrateLegacyDraft(saved, planId) {
    const exerciseIds = exerciseIdsForLegacyPlan(planId);
    const next = emptyDraft(planId);
    for (const [key, value] of Object.entries(saved?.sets || {})) {
      const [ei, si, field] = key.split(":");
      const exerciseId = exerciseIds[Number(ei)];
      if (exerciseId && field) next.sets[draftKey(exerciseId, si, field)] = value;
    }
    for (const [key, value] of Object.entries(saved?.completed || {})) {
      const [ei, si] = key.split(":");
      const exerciseId = exerciseIds[Number(ei)];
      if (exerciseId) next.completed[doneKey(exerciseId, si)] = value;
    }
    for (const [ei, value] of Object.entries(saved?.setCounts || {})) {
      const exerciseId = exerciseIds[Number(ei)];
      if (exerciseId) next.setCounts[countKey(exerciseId)] = value;
    }
    if (saved?.savedAt) next.savedAt = saved.savedAt;
    return next;
  }

  function migrateLegacyStore(source) {
    const migrated = {};
    if (!source || typeof source !== "object" || Array.isArray(source)) return migrated;
    for (const [key, saved] of Object.entries(source)) {
      const planId = normalizedId(saved?.planId) || planIdFromIndex(saved?.planIndex ?? key);
      if (!planId) continue;
      migrated[planId] = saved?.planId ? normalizeDraft(saved, planId) : migrateLegacyDraft(saved, planId);
    }
    return migrated;
  }

  async function init() {
    try {
      const [storedDrafts, legacyV8, legacyV7, storedPlanId, legacyPlanIndex] = await Promise.all([
        App.idbGet(DRAFTS_KEY),
        App.idbGet(LEGACY_DRAFTS_KEYS[0]),
        App.idbGet(LEGACY_DRAFTS_KEYS[1]),
        App.idbGet(ACTIVE_PLAN_KEY),
        App.idbGet(LEGACY_ACTIVE_PLAN_KEY)
      ]);
      const storedHasEntries = storedDrafts && typeof storedDrafts === "object" && !Array.isArray(storedDrafts) && Object.keys(storedDrafts).length > 0;
      if (storedHasEntries) {
        draftStore = storedDrafts;
      } else {
        const legacy = legacyV8 && typeof legacyV8 === "object" && Object.keys(legacyV8).length ? legacyV8 : legacyV7;
        draftStore = migrateLegacyStore(legacy);
        if (Object.keys(draftStore).length) await App.idbSet(DRAFTS_KEY, clone(draftStore));
      }

      const preferred = activePlanId() || normalizedId(storedPlanId) || planIdFromIndex(Number(legacyPlanIndex)) || normalizedId(App.state.plans?.[0]?.planId);
      const saved = draftStore[preferred];
      draft = saved ? normalizeDraft(saved, preferred) : emptyDraft(preferred);
      if (preferred) await App.idbSet(ACTIVE_PLAN_KEY, preferred);
    } catch (error) {
      console.warn("draft restore", error);
      draftStore = {};
      draft = emptyDraft(activePlanId() || normalizedId(App.state.plans?.[0]?.planId));
    }
  }

  async function resetPlan(planId = currentPlanId()) {
    const id = normalizedId(planId);
    draft = emptyDraft(id);
    await clearPlan(id);
  }

  async function resetAll() {
    clearTimeout(draftTimer);
    draftTimer = null;
    draftStore = {};
    draft = emptyDraft("");
    await Promise.all([
      App.idbSet(DRAFTS_KEY, {}),
      App.idbSet(ACTIVE_PLAN_KEY, "")
    ]);
  }

  async function prepareRemotePlans(oldPlanId, plansChanged) {
    const active = activePlanId();
    const fallback = normalizedId(oldPlanId) && planById(oldPlanId) ? normalizedId(oldPlanId) : normalizedId(App.state.plans?.[0]?.planId);
    const planId = active || fallback;
    if (plansChanged) {
      draftStore = {};
      await App.idbSet(DRAFTS_KEY, {});
    }
    draft = emptyDraft(planId);
    await App.idbSet(ACTIVE_PLAN_KEY, planId);
    return planId;
  }

  window.TrainingDraft = Object.freeze({
    init,
    currentPlanId,
    ensurePlan,
    capture,
    flush,
    queueWrite,
    hasData,
    getValue,
    setValue,
    isCompleted,
    setCompleted,
    effectiveSetCount,
    setSetCount,
    clearSetCount,
    trimFromSet,
    resetPlan,
    resetAll,
    prepareRemotePlans,
    get planId() { return draft.planId; }
  });
})();