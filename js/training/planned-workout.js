(() => {
  const App = window.FitnessApp;
  if (!App) throw new Error("FitnessApp must load before training-next-workout.js");

  const STORE_KEY = "plannedWorkoutV1";
  const CANDIDATES_KEY = "planningCandidatesV1";
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  let plannedWorkout = null;

  function planIndexFor(workout) {
    if (!workout) return -1;
    const planId = String(workout.planId || "").trim();
    const planName = String(workout.planName || "");
    let index = -1;
    if (planId) index = (App.state.plans || []).findIndex(plan => String(plan?.planId || "").trim() === planId);
    if (index < 0 && planName) index = (App.state.plans || []).findIndex(plan => String(plan?.name || "") === planName);
    return index;
  }

  function normalize(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const index = planIndexFor(value);
    const plan = index >= 0 ? App.state.plans[index] : null;
    const normalized = App.schema?.normalizeWorkout
      ? App.schema.normalizeWorkout(value, plan?.planId || value.planId || "", plan?.exercises || [])
      : clone(value);
    if (!Array.isArray(normalized?.exercises)) return null;
    return normalized;
  }

  function isConfirmed(workout = plannedWorkout) {
    return !!workout && workout.status === "confirmed" && Array.isArray(workout.exercises);
  }

  function current() {
    if (!isConfirmed()) return null;
    const index = planIndexFor(plannedWorkout);
    const plan = index >= 0 ? App.state.plans[index] : null;
    return { index, plan, workout: plannedWorkout };
  }

  function snapshot() {
    return clone(plannedWorkout);
  }

  async function write(value) {
    plannedWorkout = normalize(value);
    await App.idbSet(STORE_KEY, plannedWorkout);
    return current();
  }

  async function setConfirmed(value) {
    const next = normalize({ ...clone(value), status: "confirmed" });
    if (!next) throw new Error("当前待训练计划格式无效");
    plannedWorkout = next;
    await App.idbSet(STORE_KEY, plannedWorkout);
    return current();
  }

  async function clear() {
    plannedWorkout = null;
    await App.idbSet(STORE_KEY, null);
  }

  function legacyEntries(plans = App.state.plans || []) {
    return plans
      .map((plan, index) => ({ index, plan, workout: plan?.plannedWorkout }))
      .filter(entry => entry.workout?.status === "confirmed" && Array.isArray(entry.workout.exercises));
  }

  function newestLegacy(entries) {
    return [...entries].sort((a, b) => {
      const at = String(a.workout?.confirmedAt || a.workout?.generatedAt || "");
      const bt = String(b.workout?.confirmedAt || b.workout?.generatedAt || "");
      return bt.localeCompare(at) || b.index - a.index;
    })[0] || null;
  }

  function extractLegacy(plans = App.state.plans || []) {
    const entries = legacyEntries(plans);
    const newest = newestLegacy(entries);
    let changedPlans = false;
    for (const plan of plans) {
      if (!plan || !Object.prototype.hasOwnProperty.call(plan, "plannedWorkout")) continue;
      delete plan.plannedWorkout;
      changedPlans = true;
    }
    return { changedPlans, workout: newest ? normalize(newest.workout) : null };
  }

  async function absorbLegacy({ plans = App.state.plans || [], persistPlans = true, preferExisting = true } = {}) {
    const extracted = extractLegacy(plans);
    let migrated = false;
    if ((!plannedWorkout || !preferExisting) && extracted.workout) {
      plannedWorkout = extracted.workout;
      await App.idbSet(STORE_KEY, plannedWorkout);
      migrated = true;
    }
    if (extracted.changedPlans && persistPlans) await App.persist("plans");
    return { ...extracted, migrated, current: current() };
  }

  async function setFromRemote(value) {
    plannedWorkout = normalize(value);
    await App.idbSet(STORE_KEY, plannedWorkout);
    return current();
  }

  async function init() {
    plannedWorkout = normalize(await App.idbGet(STORE_KEY));
    if (plannedWorkout) await App.idbSet(STORE_KEY, plannedWorkout);
    await absorbLegacy({ persistPlans: true, preferExisting: true });
  }

  async function onDataReset(reason) {
    plannedWorkout = null;
    await App.idbSet(STORE_KEY, null);
    await App.idbSet(CANDIDATES_KEY, {});
    if (reason === "import") await absorbLegacy({ persistPlans: true, preferExisting: false });
  }

  App.registerPersistHook(async reason => {
    if (reason !== "workout" || !isConfirmed()) return;
    const match = (App.state.sessions || []).some(session =>
      String(session?.plannedWorkoutId || "") === String(plannedWorkout.id || "") &&
      String(session?.plannedRevision || "") === String(plannedWorkout.revision || "")
    );
    if (match) await clear();
  });

  const api = {
    current,
    snapshot,
    setConfirmed,
    setFromRemote,
    clear,
    extractLegacy,
    absorbLegacy,
    normalizeSingle() {
      return { changed: false, current: current() };
    },
    replaceOthers() {
      return false;
    }
  };

  window.TrainingNextWorkout = Object.freeze(api);
  App.registerModule({ init, onDataReset, critical: true });
})();
