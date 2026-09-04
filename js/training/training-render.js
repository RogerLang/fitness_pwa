(() => {
  const App = window.FitnessApp;
  const Progression = window.TrainingProgression;
  const Draft = window.TrainingDraft;
  const NextWorkout = window.TrainingNextWorkout;
  if (!Progression || !Draft || !NextWorkout) throw new Error("Training dependencies must load before TrainingRenderer");

  const { buildHistoryContext, previousSummary, valueOrNull } = Progression;

  function currentWorkoutEntry() {
    return NextWorkout.current(Draft.planIndex);
  }

  function previousHtml(summary) {
    if (!summary) {
      return `<section class="exercise-panel exercise-summary-panel exercise-previous-panel">
        <div class="context-head"><strong>上次记录</strong></div>
        <div class="context-target is-empty">暂无历史记录</div>
        <div class="context-detail">完成一次训练后会自动显示。</div>
      </section>`;
    }

    return `<section class="exercise-panel exercise-summary-panel exercise-previous-panel">
      <div class="context-head"><strong>上次记录</strong></div>
      <div class="context-target">${App.esc(summary.target)}</div>
      ${summary.detail ? `<div class="context-detail">${App.esc(summary.detail)}</div>` : '<div class="context-detail">最近一次有效训练记录</div>'}
    </section>`;
  }

  function plannedSetText(set) {
    const weight = valueOrNull(set?.weight);
    const reps = valueOrNull(set?.reps);
    if (weight !== null && reps !== null) return `${weight}kg × ${reps}`;
    if (weight !== null) return `${weight}kg`;
    if (reps !== null) return `${reps}次`;
    return "待定";
  }

  function plannedSummary(ex) {
    const sets = Array.isArray(ex?.sets) ? ex.sets : [];
    if (!sets.length) return "暂无目标";
    const weights = sets.map(set => valueOrNull(set?.weight));
    const reps = sets.map(set => valueOrNull(set?.reps));
    const first = weights[0];
    const sameWeight = first !== null && weights.every(weight => weight === first);
    return sameWeight
      ? `${first} kg · ${reps.map(rep => rep ?? "–").join(" / ")} 次`
      : sets.map(plannedSetText).join(" · ");
  }

  function plannedHtml(ex, workout) {
    const label = ex.warmup ? "专项热身" : (ex.suggestionLabel || "已确认");
    const time = workout?.confirmedAt ? new Date(workout.confirmedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";
    const detail = ex.reason || (time ? `已确认 · ${time}` : "已确认本次计划");
    return `<section class="exercise-panel exercise-summary-panel exercise-plan-panel">
      <div class="context-head"><strong>本次计划</strong><span class="context-chip">${App.esc(label)}</span></div>
      <div class="context-target">${App.esc(plannedSummary(ex))}</div>
      <div class="context-detail">${App.esc(detail)}</div>
    </section>`;
  }

  function workoutNumberInput({ label, ei, si, key, value, placeholder, decimal = false, done = false }) {
    return `<input class="workout-number-input" aria-label="${App.esc(label)}" type="text" inputmode="${decimal ? "decimal" : "numeric"}" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-autocomplete="none" data-form-type="other" data-lpignore="true" data-1p-ignore enterkeyhint="${done ? "done" : "next"}" data-e="${ei}" data-s="${si}" data-k="${key}" value="${App.esc(value)}" placeholder="${App.esc(placeholder ?? "")}">`;
  }

  function plannedSetFor(ex, si) {
    const sets = Array.isArray(ex?.sets) ? ex.sets : [];
    return sets[si] || sets[sets.length - 1] || {};
  }

  function renderExerciseCard(ex, ei, historyContext, workout) {
    const history = historyContext.history(ex.name);
    const previous = history[0]?.exercise || null;
    const summary = previousSummary(previous);
    const baseSets = Math.max(1, ex.sets?.length || 1);
    const sets = Draft.effectiveSetCount(ei, baseSets);
    const meta = ex.note || (ex.warmup ? "专项热身" : "");
    const repRange = Array.isArray(ex.repRange) ? ex.repRange : null;
    const setsMeta = ex.warmup
      ? `${sets} 组 · 专项热身${sets !== baseSets ? " · 临时调整" : ""}`
      : `${sets} 组${repRange ? ` · ${repRange[0]}–${repRange[1]} 次` : ""}${sets !== baseSets ? " · 临时调整" : ""}`;

    let rows = "";
    for (let si = 0; si < sets; si++) {
      const prev = previous?.sets?.[si] || null;
      const target = plannedSetFor(ex, si);
      const weightValue = Draft.getValue(ei, si, "weight");
      const repsValue = Draft.getValue(ei, si, "reps");
      const rirValue = Draft.getValue(ei, si, "rir");
      const done = Draft.isCompleted(ei, si);
      rows += `<div class="set-row workout-set-row${done ? " set-completed" : ""}" data-e="${ei}" data-s="${si}">
        <span class="set-number">${si + 1}</span>
        ${workoutNumberInput({ label: `第 ${si + 1} 组重量`, ei, si, key: "weight", value: weightValue, placeholder: target.weight, decimal: true })}
        ${workoutNumberInput({ label: `第 ${si + 1} 组次数`, ei, si, key: "reps", value: repsValue, placeholder: target.reps })}
        ${workoutNumberInput({ label: `第 ${si + 1} 组 RIR`, ei, si, key: "rir", value: rirValue, placeholder: ex.warmup ? "" : (prev?.rir ?? "1–2"), done: true })}
        <button type="button" class="set-complete${done ? "" : " secondary"}" data-e="${ei}" data-s="${si}" aria-pressed="${done}">${done ? "✓" : "完成"}</button>
      </div>`;
    }

    return `<article class="card exercise-card${ex.warmup ? " warmup-card" : ""}" data-e="${ei}">
      <div class="exercise-head">
        <div class="exercise-title-wrap">
          <div class="exercise-title-line"><div class="exercise-title">${App.esc(ex.name || "未命名动作")}</div>${ex.warmup ? '<span class="badge warmup-badge">热身</span>' : ""}</div>
          <div class="exercise-meta">${App.esc(meta)}</div>
        </div>
      </div>

      <div class="exercise-card-layout">
        <div class="exercise-summary-grid">
          ${previousHtml(summary)}
          ${plannedHtml(ex, workout)}
        </div>

        <section class="exercise-panel exercise-sets-panel">
          <div class="exercise-panel-heading training-set-heading">
            <div>
              <div class="exercise-panel-title">动作组</div>
              <div class="exercise-panel-meta">${App.esc(setsMeta)}</div>
            </div>
            <div class="training-set-adjust" aria-label="临时调整本次训练组数">
              <button type="button" class="small secondary remove-set" data-e="${ei}" ${sets <= 1 ? "disabled" : ""} aria-label="本次训练减少一组">−</button>
              <span>${sets}</span>
              <button type="button" class="small secondary add-set" data-e="${ei}" aria-label="本次训练增加一组">+</button>
            </div>
          </div>
          <div class="set-row set-header"><span>组</span><span>重量 kg</span><span>次数</span><span>RIR</span><span>完成</span></div>
          ${rows}
        </section>
      </div>
    </article>`;
  }

  function renderPlanStatus() {
    const name = document.getElementById("todayPlanName");
    const meta = document.getElementById("todayPlanMeta");
    const active = currentWorkoutEntry();
    if (!name || !meta) return;
    if (!active) {
      name.textContent = "尚未推送下一次训练";
      meta.textContent = "先到计划页选择模板并推送训练计划";
      return;
    }
    name.textContent = active.plan?.name || active.workout.planName || "本次训练";
    const time = active.workout.confirmedAt
      ? new Date(active.workout.confirmedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
      : "已推送";
    meta.textContent = `${time} · 当前待训练计划`;
  }

  function renderWorkout() {
    const container = document.getElementById("workoutContainer");
    if (!container) return;
    if (!App.state.plans.length) {
      container.innerHTML = '<div class="card empty-state"><strong>当前没有训练模板</strong><span>可从 GitHub 拉取已有模板，或导入本地备份。</span></div>';
      renderPlanStatus();
      return;
    }

    const active = currentWorkoutEntry();
    if (!active) {
      container.innerHTML = `<div class="card training-plan-empty">
        <strong>还没有待训练计划</strong>
        <span>在计划页选择训练模板，检查系统建议并推送后，这里会直接显示那一份计划。</span>
        <button type="button" class="go-plan-page">去制定计划</button>
      </div>`;
      renderPlanStatus();
      return;
    }

    Draft.ensurePlan(active.index);
    const historyContext = buildHistoryContext(active.plan.name);
    container.innerHTML = active.workout.exercises.map((ex, ei) => renderExerciseCard(ex, ei, historyContext, active.workout)).join("");
    renderPlanStatus();
  }

  window.TrainingRenderer = Object.freeze({
    renderWorkout,
    currentWorkoutEntry
  });
})();
