(() => {
  const LOCAL_STATE_SCHEMA_VERSION = 2;

  function objectValue(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function normalizedString(value) {
    return value === undefined || value === null ? "" : String(value);
  }

  function normalizedId(value) {
    return normalizedString(value).trim();
  }

  function legacyId(prefix, ...parts) {
    const seed = parts.map(part => normalizedString(part).trim()).join("\u001f");
    let h1 = 0x811c9dc5;
    let h2 = 0x9e3779b9;
    for (let i = 0; i < seed.length; i++) {
      const code = seed.charCodeAt(i);
      h1 = Math.imul(h1 ^ code, 0x01000193);
      h2 = Math.imul(h2 ^ code, 0x85ebca6b);
    }
    return `${prefix}-${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
  }

  function normalizeSet(value) {
    return { ...objectValue(value) };
  }

  function normalizeTemplateExercise(value, planId = "", legacyIndex = 0) {
    const exercise = objectValue(value);
    const name = normalizedString(exercise.name);
    const normalized = {
      ...exercise,
      name,
      exerciseId: normalizedId(exercise.exerciseId) || legacyId("exercise", planId, name, legacyIndex)
    };
    if (Object.prototype.hasOwnProperty.call(exercise, "setPresets")) {
      normalized.setPresets = Array.isArray(exercise.setPresets) ? exercise.setPresets.map(normalizeSet) : [];
    }
    return normalized;
  }

  function exerciseLookup(exercises = []) {
    const byId = new Map();
    const byName = new Map();
    for (const exercise of exercises) {
      const id = normalizedId(exercise?.exerciseId);
      const name = normalizedString(exercise?.name);
      if (id && !byId.has(id)) byId.set(id, exercise);
      if (name && !byName.has(name)) byName.set(name, exercise);
    }
    return { byId, byName };
  }

  function normalizeWorkoutExercise(value, planId = "", templates = null, positionalTemplate = null, legacyIndex = 0) {
    const exercise = objectValue(value);
    const name = normalizedString(exercise.name);
    const existingId = normalizedId(exercise.exerciseId);
    const positionalMatch = positionalTemplate && normalizedString(positionalTemplate.name) === name ? positionalTemplate : null;
    const matched = existingId
      ? templates?.byId?.get(existingId)
      : positionalMatch || templates?.byName?.get(name);
    return {
      ...exercise,
      name,
      exerciseId: existingId || normalizedId(matched?.exerciseId) || legacyId("exercise", planId, name, legacyIndex),
      sets: Array.isArray(exercise.sets) ? exercise.sets.map(normalizeSet) : []
    };
  }

  function normalizeWorkout(value, fallbackPlanId = "", templateExercises = []) {
    const workout = objectValue(value);
    const planName = normalizedString(workout.planName);
    const planId = normalizedId(workout.planId) || normalizedId(fallbackPlanId) || legacyId("plan", planName);
    const templates = exerciseLookup(templateExercises);
    return {
      ...workout,
      planName,
      planId,
      exercises: Array.isArray(workout.exercises)
        ? workout.exercises.map((exercise, index) => normalizeWorkoutExercise(exercise, planId, templates, templateExercises[index], index))
        : []
    };
  }

  function normalizePlan(value) {
    const plan = objectValue(value);
    const name = normalizedString(plan.name);
    const planId = normalizedId(plan.planId) || legacyId("plan", name);
    const exercises = Array.isArray(plan.exercises)
      ? plan.exercises.map((exercise, index) => normalizeTemplateExercise(exercise, planId, index))
      : [];
    const normalized = {
      ...plan,
      name,
      planId,
      exercises
    };
    if (plan.plannedWorkout && typeof plan.plannedWorkout === "object" && !Array.isArray(plan.plannedWorkout)) {
      normalized.plannedWorkout = normalizeWorkout(plan.plannedWorkout, planId, exercises);
    }
    return normalized;
  }

  function normalizeSessionExercise(value, planId = "", templates = null, positionalTemplate = null, legacyIndex = 0) {
    const exercise = normalizeWorkoutExercise(value, planId, templates, positionalTemplate, legacyIndex);
    if (exercise.planned && typeof exercise.planned === "object" && !Array.isArray(exercise.planned)) {
      exercise.planned = {
        ...exercise.planned,
        sets: Array.isArray(exercise.planned.sets) ? exercise.planned.sets.map(normalizeSet) : []
      };
    }
    return exercise;
  }

  function planLookup(plans = []) {
    const byId = new Map();
    const byName = new Map();
    for (const plan of plans) {
      const id = normalizedId(plan?.planId);
      const name = normalizedString(plan?.name);
      if (id && !byId.has(id)) byId.set(id, plan);
      if (name && !byName.has(name)) byName.set(name, plan);
    }
    return { byId, byName };
  }

  function normalizeSession(value, plans = null) {
    const session = objectValue(value);
    const planName = normalizedString(session.plan);
    const existingPlanId = normalizedId(session.planId);
    const matchedPlan = existingPlanId ? plans?.byId?.get(existingPlanId) : plans?.byName?.get(planName);
    const planId = existingPlanId || normalizedId(matchedPlan?.planId) || legacyId("plan", planName);
    const templateExercises = matchedPlan?.exercises || [];
    const templates = exerciseLookup(templateExercises);
    const normalized = {
      ...session,
      date: normalizedString(session.date),
      plan: planName,
      planId,
      exercises: Array.isArray(session.exercises)
        ? session.exercises.map((exercise, index) => normalizeSessionExercise(exercise, planId, templates, templateExercises[index], index))
        : []
    };
    if (session.id !== undefined && session.id !== null) normalized.id = String(session.id);
    if (session.completedAt !== undefined && session.completedAt !== null) normalized.completedAt = String(session.completedAt);
    return normalized;
  }

  function normalizeBodyRecord(value) {
    const record = { ...objectValue(value) };
    if (record.id !== undefined && record.id !== null) record.id = String(record.id);
    if (record.date !== undefined && record.date !== null) record.date = String(record.date);
    if (record.recordedAt !== undefined && record.recordedAt !== null) record.recordedAt = String(record.recordedAt);
    return record;
  }

  function normalizeState(next) {
    const value = objectValue(next);
    const plans = Array.isArray(value.plans) ? value.plans.map(normalizePlan) : [];
    const plansByIdentity = planLookup(plans);
    return {
      plans,
      sessions: Array.isArray(value.sessions) ? value.sessions.map(session => normalizeSession(session, plansByIdentity)) : [],
      body: Array.isArray(value.body) ? value.body.map(normalizeBodyRecord) : []
    };
  }

  window.FitnessSchema = Object.freeze({
    version: LOCAL_STATE_SCHEMA_VERSION,
    legacyId,
    normalizeSet,
    normalizeTemplateExercise,
    normalizeWorkoutExercise,
    normalizeWorkout,
    normalizePlan,
    normalizeSession,
    normalizeBodyRecord,
    normalizeState
  });
})();
