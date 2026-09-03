(() => {
  const App = window.FitnessApp;
  const DRAFTS_KEY = "workoutDraftsV7";
  const ACTIVE_PLAN_KEY = "workoutActivePlanV7";

  let draftStore = {};
  let draft = emptyDraft(0);
  let draftTimer = null;

  const clone = value => JSON.parse(JSON.stringify(value));
  const draftKey = (ei, si, key) => `${ei}:${si}:${key}`;
  const doneKey = (ei, si) => `${ei}:${si}`;

  function emptyDraft(planIndex) {
    return { planIndex, sets: {}, completed: {} };
  }

  function currentPlanIndex() {
    const select = document.getElementById("planSelect");
    if (!select || select.disabled) return 0;
    const index = Number(select.value || 0);
    return Number.isInteger(index) && index >= 0 ? index : 0;
  }

  function ensurePlan(index = currentPlanIndex()) {
    if (draft.planIndex !== index) {
      const saved = draftStore[String(index)];
      draft = saved
        ? { planIndex: index, sets: clone(saved.sets || {}), completed: clone(saved.completed || {}) }
        : emptyDraft(index);
    }
    return index;
  }

  function capture() {
    const index = ensurePlan();
    document.querySelectorAll('#workoutContainer input[data-e][data-s][data-k]').forEach(input => {
      draft.sets[draftKey(input.dataset.e, input.dataset.s, input.dataset.k)] = input.value;
    });
    document.querySelectorAll('#workoutContainer .workout-set-row[data-e][data-s]').forEach(row => {
      draft.completed[doneKey(row.dataset.e, row.dataset.s)] = row.classList.contains("set-completed");
    });
    draft.planIndex = index;
  }

  async function flush() {
    clearTimeout(draftTimer);
    draftTimer = null;
    if (!App.db || !App.state.plans.length) return;
    draftStore[String(draft.planIndex)] = { ...clone(draft), savedAt: new Date().toISOString() };
    await Promise.all([
      App.idbSet(DRAFTS_KEY, clone(draftStore)),
      App.idbSet(ACTIVE_PLAN_KEY, draft.planIndex)
    ]);
  }

  function queueWrite() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => flush().catch(error => console.warn("draft save", error)), 180);
  }

  async function clearPlan(index = currentPlanIndex()) {
    delete draftStore[String(index)];
    await App.idbSet(DRAFTS_KEY, clone(draftStore));
  }

  function hasData() {
    capture();
    return Object.values(draft.sets || {}).some(value => String(value ?? "").trim() !== "") ||
      Object.values(draft.completed || {}).some(Boolean);
  }

  function getValue(ei, si, key) {
    const k = draftKey(ei, si, key);
    return Object.prototype.hasOwnProperty.call(draft.sets, k) ? draft.sets[k] : "";
  }

  function setValue(ei, si, key, value) {
    draft.sets[draftKey(ei, si, key)] = value;
  }

  function isCompleted(ei, si) {
    return !!draft.completed[doneKey(ei, si)];
  }

  function setCompleted(ei, si, completed) {
    draft.completed[doneKey(ei, si)] = completed;
  }

  function trimLastSet(ei, lastSi) {
    ["weight", "reps", "rir"].forEach(key => delete draft.sets[draftKey(ei, lastSi, key)]);
    delete draft.completed[doneKey(ei, lastSi)];
  }

  function shiftAfterDeleteExercise(deletedEi) {
    const nextSets = {};
    const nextCompleted = {};

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
  }

  async function init() {
    draftStore = await App.idbGet(DRAFTS_KEY) || {};
    let pi = Number(await App.idbGet(ACTIVE_PLAN_KEY));
    if (!Number.isInteger(pi) || pi < 0 || pi >= App.state.plans.length) pi = 0;
    const saved = draftStore[String(pi)];
    draft = saved
      ? { planIndex: pi, sets: clone(saved.sets || {}), completed: clone(saved.completed || {}) }
      : emptyDraft(pi);
  }

  async function setActivePlan(index) {
    await App.idbSet(ACTIVE_PLAN_KEY, index);
  }

  async function resetPlan(index = currentPlanIndex()) {
    draft = emptyDraft(index);
    await clearPlan(index);
  }

  async function resetAll() {
    clearTimeout(draftTimer);
    draftTimer = null;
    draftStore = {};
    draft = emptyDraft(0);
    await Promise.all([
      App.idbSet(DRAFTS_KEY, {}),
      App.idbSet(ACTIVE_PLAN_KEY, 0)
    ]);
  }

  async function prepareRemotePlans(oldPlanName, plansChanged) {
    let index = App.state.plans.findIndex(plan => plan.name === oldPlanName);
    if (index < 0) index = 0;
    if (plansChanged) {
      draftStore = {};
      await App.idbSet(DRAFTS_KEY, {});
    }
    draft = emptyDraft(index);
    await App.idbSet(ACTIVE_PLAN_KEY, index);
    return index;
  }

  window.TrainingDraft = Object.freeze({
    init,
    currentPlanIndex,
    ensurePlan,
    capture,
    flush,
    queueWrite,
    clearPlan,
    hasData,
    getValue,
    setValue,
    isCompleted,
    setCompleted,
    trimLastSet,
    shiftAfterDeleteExercise,
    setActivePlan,
    resetPlan,
    resetAll,
    prepareRemotePlans,
    get planIndex() { return draft.planIndex; }
  });
})();
