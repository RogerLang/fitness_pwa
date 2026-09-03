(() => {
  const App = window.FitnessApp;
  const PROGRESSION_VERSION = 1;

  const valueOrNull = value => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

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

  function buildHistoryContext(planName) {
    const sorted = App.state.sessions
      .map((session, index) => ({ session, index }))
      .sort((a, b) => String(b.session?.date || "").localeCompare(String(a.session?.date || "")) || b.index - a.index);
    const all = new Map();
    const same = new Map();
    for (const { session } of sorted) {
      for (const exercise of session?.exercises || []) {
        if (!exercise?.name) continue;
        if (!all.has(exercise.name)) all.set(exercise.name, []);
        all.get(exercise.name).push({ session, exercise });
        if (session.plan === planName) {
          if (!same.has(exercise.name)) same.set(exercise.name, []);
          same.get(exercise.name).push({ session, exercise });
        }
      }
    }
    return {
      history(name) {
        const preferred = same.get(name);
        return preferred?.length ? preferred : (all.get(name) || []);
      },
      latest(name) { return this.history(name)[0]?.exercise || null; }
    };
  }

  function evaluate(historyItem, planExercise) {
    if (!historyItem?.exercise) return null;
    const [min, max] = repRange(planExercise);
    const required = setCount(planExercise);
    const sets = (historyItem.exercise.sets || []).filter(set => valueOrNull(set?.reps) !== null && Number(set.reps) > 0);
    if (!sets.length) return null;
    const observed = sets.slice(0, required);
    const weight = workingWeight(observed);
    const sameWeight = weight === null ? true : observed.every(set => valueOrNull(set?.weight) === weight);
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

  function progressionSuggestion(ex, history) {
    const [min, max] = repRange(ex);
    const count = setCount(ex);
    const step = weightStep(ex);
    const evaluations = history.map(item => evaluate(item, ex)).filter(Boolean);
    const last = evaluations[0] || null;
    const previous = evaluations[1] || null;
    const fallbackWeight = valueOrNull(ex?.defaultWeight);

    if (!last) {
      return {
        version: PROGRESSION_VERSION, status: "first", statusLabel: "首次建立基线",
        weight: fallbackWeight, reps: Array(count).fill(min), repRange: [min, max], weightStep: step, confirmation: 0,
        reason: `选择能完成 ${min}–${max} 次、约 RIR 1–2 的重量。`
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

  function setText(set) {
    if (!set) return "";
    const weight = valueOrNull(set.weight);
    const reps = valueOrNull(set.reps);
    const rir = valueOrNull(set.rir);
    const main = weight !== null && weight > 0 && reps !== null ? `${weight} kg × ${reps}` : reps !== null ? `${reps} 次` : weight !== null ? `${weight} kg` : "";
    return `${main}${rir !== null ? ` · RIR ${rir}` : ""}`;
  }

  function previousSummary(previous) {
    const sets = (previous?.sets || []).filter(set => [set?.weight, set?.reps, set?.rir].some(value => value !== null && value !== undefined));
    if (!sets.length) return null;
    const weights = sets.map(set => valueOrNull(set.weight));
    const reps = sets.map(set => valueOrNull(set.reps));
    const positive = weights.filter(weight => weight !== null && weight > 0);
    const sameWeight = positive.length === sets.length && positive.every(weight => weight === positive[0]);
    const target = sameWeight
      ? `${positive[0]} kg · ${reps.map(rep => rep ?? "–").join(" / ")} 次`
      : sets.map((set, index) => `${weights[index] !== null && weights[index] > 0 ? `${weights[index]}kg` : "–"} × ${reps[index] ?? "–"}`).join(" · ");
    const rirs = sets.map(set => valueOrNull(set.rir));
    return { target, detail: rirs.some(rir => rir !== null) ? `RIR ${rirs.map(rir => rir ?? "–").join(" / ")}` : "" };
  }

  window.TrainingProgression = Object.freeze({
    valueOrNull,
    repRange,
    setCount,
    weightStep,
    workingWeight,
    buildHistoryContext,
    progressionSuggestion,
    setText,
    previousSummary
  });
})();
