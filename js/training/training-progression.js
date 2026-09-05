(() => {
  const App = window.FitnessApp;
  const PROGRESSION_VERSION = 2;
  const LOAD_TYPES = new Set(["weight", "bodyweight", "added-weight"]);
  let historyIndexCache = null;

  const valueOrNull = value => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  function loadType(ex) {
    const value = typeof ex === "string" ? ex : ex?.loadType;
    return LOAD_TYPES.has(value) ? value : "weight";
  }

  function usesWeight(ex) {
    return loadType(ex) !== "bodyweight";
  }

  function loadLabel(ex) {
    const type = loadType(ex);
    if (type === "added-weight") return "附加重量";
    if (type === "bodyweight") return "";
    return "重量";
  }

  function repRange(ex) {
    let min = Number(ex?.repRange?.[0]);
    let max = Number(ex?.repRange?.[1]);
    if (!Number.isFinite(min) || min < 1) min = 8;
    if (!Number.isFinite(max) || max < min) max = Math.max(min, 12);
    return [Math.round(min), Math.round(max)];
  }

  function setCount(ex) {
    const n = Math.round(Number(ex?.sets));
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  function weightStep(ex) {
    if (ex?.weightStep !== undefined && ex?.weightStep !== null && ex.weightStep !== "") {
      const n = Number(ex.weightStep);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return /硬拉/.test(String(ex?.name || "")) ? 6 : 5;
  }

  function workingWeight(sets) {
    const weights = (sets || []).map(set => valueOrNull(set?.weight)).filter(weight => weight !== null && weight > 0);
    if (!weights.length) return null;
    const counts = new Map();
    for (const weight of weights) counts.set(weight, (counts.get(weight) || 0) + 1);
    let best = weights[0];
    let count = 0;
    for (const [weight, n] of counts) if (n > count) { best = weight; count = n; }
    return best;
  }

  function lastRir(sets) {
    for (let i = (sets || []).length - 1; i >= 0; i--) {
      const value = valueOrNull(sets[i]?.rir);
      if (value !== null) return value;
    }
    return null;
  }

  function appendHistory(map, key, item) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }

  function historyBucket() {
    return { byId: new Map(), byName: new Map() };
  }

  function appendExercise(bucket, exercise, item) {
    appendHistory(bucket.byId, String(exercise?.exerciseId || ""), item);
    appendHistory(bucket.byName, String(exercise?.name || ""), item);
  }

  function bucketFor(map, key) {
    if (!key) return null;
    if (!map.has(key)) map.set(key, historyBucket());
    return map.get(key);
  }

  function buildHistoryIndex() {
    const sorted = App.state.sessions
      .map((session, index) => ({ session, index }))
      .sort((a, b) => {
        const at = String(a.session?.completedAt || a.session?.date || "");
        const bt = String(b.session?.completedAt || b.session?.date || "");
        return bt.localeCompare(at) || b.index - a.index;
      });
    const all = historyBucket();
    const byPlanId = new Map();
    const byPlanName = new Map();

    for (const { session } of sorted) {
      const planId = String(session?.planId || "");
      const planName = String(session?.plan || "");
      const planIdBucket = bucketFor(byPlanId, planId);
      const planNameBucket = bucketFor(byPlanName, planName);
      for (const exercise of session?.exercises || []) {
        if (!exercise?.name && !exercise?.exerciseId) continue;
        const item = { session, exercise };
        appendExercise(all, exercise, item);
        if (planIdBucket) appendExercise(planIdBucket, exercise, item);
        if (planNameBucket) appendExercise(planNameBucket, exercise, item);
      }
    }

    historyIndexCache = { all, byPlanId, byPlanName };
    return historyIndexCache;
  }

  function historyIndex() {
    return historyIndexCache || buildHistoryIndex();
  }

  function invalidateHistoryIndex() {
    historyIndexCache = null;
  }

  function planIdentity(ref) {
    if (typeof ref === "string") return { id: "", name: ref };
    return {
      id: String(ref?.planId || ""),
      name: String(ref?.name || ref?.planName || "")
    };
  }

  function exerciseIdentity(ref) {
    if (typeof ref === "string") return { id: "", name: ref };
    return {
      id: String(ref?.exerciseId || ""),
      name: String(ref?.name || "")
    };
  }

  function firstHistory(...candidates) {
    return candidates.find(items => items?.length) || [];
  }

  function historyFromBucket(bucket, exercise) {
    if (!bucket) return [];
    return firstHistory(
      exercise.id ? bucket.byId.get(exercise.id) : null,
      exercise.name ? bucket.byName.get(exercise.name) : null
    );
  }

  function buildHistoryContext(planRef) {
    const index = historyIndex();
    const plan = planIdentity(planRef);
    const sameId = plan.id ? index.byPlanId.get(plan.id) : null;
    const sameName = plan.name ? index.byPlanName.get(plan.name) : null;
    return {
      history(exerciseRef) {
        const exercise = exerciseIdentity(exerciseRef);
        return firstHistory(
          historyFromBucket(sameId, exercise),
          historyFromBucket(sameName, exercise),
          exercise.id ? index.all.byId.get(exercise.id) : null,
          exercise.name ? index.all.byName.get(exercise.name) : null
        );
      },
      latest(exerciseRef) { return this.history(exerciseRef)[0]?.exercise || null; }
    };
  }

  function evaluate(historyItem, planExercise) {
    if (!historyItem?.exercise) return null;
    const [min, max] = repRange(planExercise);
    const required = setCount(planExercise);
    const sets = (historyItem.exercise.sets || []).filter(set => valueOrNull(set?.reps) !== null && Number(set.reps) > 0);
    if (!sets.length) return null;
    const observed = sets.slice(0, required);
    const weight = usesWeight(planExercise) ? workingWeight(observed) : null;
    const sameWeight = !usesWeight(planExercise) || weight === null ? true : observed.every(set => valueOrNull(set?.weight) === weight);
    const complete = observed.length >= required;
    const allTop = complete && sameWeight && observed.every(set => Number(set.reps) >= max);
    const rir = lastRir(observed);
    return { historyItem, observed, weight, complete, allTop, rirAllowsProgress: rir === null || rir >= 1, min, max, required };
  }

  function nextRepTargets(evaluation, ex) {
    const [min, max] = repRange(ex);
    return Array.from({ length: setCount(ex) }, (_, index) => {
      const reps = valueOrNull(evaluation?.observed?.[index]?.reps);
      if (reps === null || reps <= 0) return min;
      return Math.min(max, Math.max(min, Math.round(reps) + 1));
    });
  }

  function bodyweightSuggestion(ex, last, previous, min, max, count) {
    if (!last) {
      return {
        version: PROGRESSION_VERSION, status: "first", statusLabel: "首次建立基线",
        weight: null, reps: Array(count).fill(min), repRange: [min, max], weightStep: 0, confirmation: 0,
        reason: `从 ${min}–${max} 次区间下部建立自重基线，约 RIR 1–2。`
      };
    }

    const lastBelowMin = last.complete && last.observed.every(set => Number(set.reps) < min);
    const previousBelowMin = previous && previous.complete && previous.observed.every(set => Number(set.reps) < min);
    if (lastBelowMin && previousBelowMin) {
      return {
        version: PROGRESSION_VERSION, status: "review", statusLabel: "检查疲劳",
        weight: null, reps: Array(count).fill(min), repRange: [min, max], weightStep: 0, confirmation: 0,
        reason: "连续两次全部工作组低于目标次数下限；优先检查恢复、动作质量和组间休息。"
      };
    }

    if (last.allTop) {
      return {
        version: PROGRESSION_VERSION, status: "maintain", statusLabel: last.rirAllowsProgress ? "维持上限" : "再确认一次",
        weight: null, reps: Array(count).fill(max), repRange: [min, max], weightStep: 0, confirmation: last.rirAllowsProgress ? 2 : 1,
        reason: last.rirAllowsProgress
          ? `已达到 ${max} 次上限；保持自重，以动作质量和目标 RIR 为优先。`
          : "已达到次数上限，但最后一组为 RIR 0；本次保持目标次数再次确认。"
      };
    }

    return {
      version: PROGRESSION_VERSION, status: "build", statusLabel: "累计次数",
      weight: null, reps: nextRepTargets(last, ex), repRange: [min, max], weightStep: 0, confirmation: 0,
      reason: `保持自重，在 ${min}–${max} 次区间内继续增加总次数。`
    };
  }

  function progressionSuggestion(ex, history) {
    const [min, max] = repRange(ex);
    const count = setCount(ex);
    const type = loadType(ex);
    const step = type === "bodyweight" ? 0 : weightStep(ex);
    const evaluations = history.map(item => evaluate(item, ex)).filter(Boolean);
    const last = evaluations[0] || null;
    const previous = evaluations[1] || null;

    if (type === "bodyweight") return bodyweightSuggestion(ex, last, previous, min, max, count);

    const fallbackWeight = valueOrNull(ex?.defaultWeight);
    if (!last) {
      const loadCopy = type === "added-weight" ? "附加重量" : "重量";
      return {
        version: PROGRESSION_VERSION, status: "first", statusLabel: "首次建立基线",
        weight: fallbackWeight, reps: Array(count).fill(min), repRange: [min, max], weightStep: step, confirmation: 0,
        reason: `选择能完成 ${min}–${max} 次、约 RIR 1–2 的${loadCopy}。`
      };
    }

    const baseWeight = last.weight ?? fallbackWeight;
    const lastBelowMin = last.complete && last.observed.every(set => Number(set.reps) < min);
    const previousBelowMin = previous && previous.complete && previous.observed.every(set => Number(set.reps) < min);
    const sameReviewWeight = previous && ((baseWeight === null && previous.weight === null) || previous.weight === baseWeight);

    if (lastBelowMin && previousBelowMin && sameReviewWeight && !last.historyItem.exercise?.weightOverride && !previous.historyItem.exercise?.weightOverride) {
      return {
        version: PROGRESSION_VERSION, status: "review", statusLabel: "检查疲劳",
        weight: baseWeight, reps: Array(count).fill(min), repRange: [min, max], weightStep: step, confirmation: 0,
        reason: "连续两次全部工作组低于目标次数下限；优先检查恢复和动作状态，必要时再考虑降低一档。"
      };
    }

    if (last.allTop) {
      if (!last.rirAllowsProgress) {
        return {
          version: PROGRESSION_VERSION, status: "confirm", statusLabel: "再确认一次",
          weight: baseWeight, reps: Array(count).fill(max), repRange: [min, max], weightStep: step, confirmation: 1,
          reason: "已达到次数上限，但最后一组为 RIR 0；本次保持重量确认。"
        };
      }
      const confirmed = previous && previous.allTop && previous.rirAllowsProgress &&
        ((baseWeight === null && previous.weight === null) || previous.weight === baseWeight);
      if (confirmed && baseWeight !== null && step > 0) {
        return {
          version: PROGRESSION_VERSION, status: "increase", statusLabel: "升档",
          weight: baseWeight + step, reps: Array(count).fill(min), repRange: [min, max], weightStep: step, confirmation: 2,
          reason: `连续两次达到 ${max} 次上限，下一次增加 ${step} kg，并从次数区间下部重新推进。`
        };
      }
      return {
        version: PROGRESSION_VERSION, status: "confirm", statusLabel: "进阶确认 1/2",
        weight: baseWeight, reps: Array(count).fill(max), repRange: [min, max], weightStep: step, confirmation: 1,
        reason: "第一次完成全部工作组次数上限；保持当前重量，再完成一次即可进入升档判断。"
      };
    }

    return {
      version: PROGRESSION_VERSION, status: "build", statusLabel: "累计次数",
      weight: baseWeight, reps: nextRepTargets(last, ex), repRange: [min, max], weightStep: step, confirmation: 0,
      reason: `保持当前重量，在 ${min}–${max} 次区间内继续增加总次数。`
    };
  }

  function setText(set, exerciseOrType = "weight") {
    if (!set) return "";
    const type = loadType(exerciseOrType);
    const weight = valueOrNull(set.weight);
    const reps = valueOrNull(set.reps);
    const rir = valueOrNull(set.rir);
    let main = "";
    if (type === "bodyweight") main = reps !== null ? `${reps} 次` : "";
    else if (type === "added-weight") {
      if (weight !== null && weight > 0 && reps !== null) main = `+${weight} kg × ${reps}`;
      else if (reps !== null) main = `${reps} 次`;
      else if (weight !== null && weight > 0) main = `+${weight} kg`;
    } else {
      main = weight !== null && weight > 0 && reps !== null ? `${weight} kg × ${reps}` : reps !== null ? `${reps} 次` : weight !== null ? `${weight} kg` : "";
    }
    return `${main}${rir !== null ? ` · RIR ${rir}` : ""}`;
  }

  function previousSummary(previous, exerciseOrType = "weight") {
    const type = loadType(exerciseOrType);
    const sets = (previous?.sets || []).filter(set => [set?.weight, set?.reps, set?.rir].some(value => value !== null && value !== undefined));
    if (!sets.length) return null;
    const weights = sets.map(set => valueOrNull(set.weight));
    const reps = sets.map(set => valueOrNull(set.reps));
    let target = "";

    if (type === "bodyweight") {
      target = `${reps.map(rep => rep ?? "–").join(" / ")} 次`;
    } else {
      const positive = weights.filter(weight => weight !== null && weight > 0);
      const sameWeight = positive.length === sets.length && positive.every(weight => weight === positive[0]);
      const prefix = type === "added-weight" ? "+" : "";
      target = sameWeight
        ? `${prefix}${positive[0]} kg · ${reps.map(rep => rep ?? "–").join(" / ")} 次`
        : sets.map((set, index) => `${weights[index] !== null && weights[index] > 0 ? `${prefix}${weights[index]}kg` : "–"} × ${reps[index] ?? "–"}`).join(" · ");
    }

    const rirs = sets.map(set => valueOrNull(set.rir));
    return { target, detail: rirs.some(rir => rir !== null) ? `RIR ${rirs.map(rir => rir ?? "–").join(" / ")}` : "" };
  }

  App.registerPersistHook((reason, keys = []) => {
    if (keys.includes("sessions")) invalidateHistoryIndex();
  });

  window.TrainingProgression = Object.freeze({
    valueOrNull,
    loadType,
    usesWeight,
    loadLabel,
    repRange,
    setCount,
    weightStep,
    workingWeight,
    buildHistoryContext,
    progressionSuggestion,
    setText,
    previousSummary,
    invalidateHistoryIndex
  });
})();
