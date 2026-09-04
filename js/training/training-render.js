(() => {
  const App = window.FitnessApp;
  const Progression = window.TrainingProgression;
  const Draft = window.TrainingDraft;
  if (!Progression || !Draft) throw new Error("TrainingProgression and TrainingDraft must load before TrainingRenderer");

  const openEditors = new Set();
  const {
    repRange,
    setCount,
    weightStep,
    buildHistoryContext,
    progressionSuggestion,
    previousSummary
  } = Progression;

  function progressionHtml(suggestion, ex) {
    if (!suggestion) {
      return `<section class="exercise-panel exercise-summary-panel exercise-plan-panel">
        <div class="context-head"><strong>本次计划</strong><span class="context-chip">专项热身</span></div>
        <div class="context-target">${setCount(ex)} 组专项热身</div>
        <div class="context-detail">${App.esc(ex.note || "按预设完成后进入正式工作组。")}</div>
      </section>`;
    }

    const weight = suggestion.weight === null || suggestion.weight === undefined ? "自选重量" : `${Number(suggestion.weight)} kg`;
    const confirm = suggestion.confirmation ? `<span class="context-chip">${suggestion.confirmation}/2</span>` : "";
    return `<section class="exercise-panel exercise-summary-panel exercise-plan-panel">
      <div class="context-head"><strong>本次计划</strong><span class="context-chip">${App.esc(suggestion.statusLabel)}</span>${confirm}</div>
      <div class="context-target">${App.esc(weight)} · ${App.esc((suggestion.reps || []).join(" / "))} 次</div>
      <div class="context-detail">${App.esc(suggestion.reason)}</div>
    </section>`;
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

  function warmupPreset(ex, si) {
    return Array.isArray(ex?.setPresets) ? (ex.setPresets[si] || {}) : {};
  }

  function workoutNumberInput({ label, ei, si, key, value, placeholder, decimal = false, done = false }) {
    return `<input class="workout-number-input" aria-label="${App.esc(label)}" type="text" inputmode="${decimal ? "decimal" : "numeric"}" autocomplete="off" autocapitalize="off" spellcheck="false" enterkeyhint="${done ? "done" : "next"}" data-e="${ei}" data-s="${si}" data-k="${key}" value="${App.esc(value)}" placeholder="${App.esc(placeholder)}">`;
  }

  function renderEditor(ex, ei, sets, min, max) {
    return `<div class="exercise-inline-editor${openEditors.has(ei) ? "" : " hidden"}" data-e="${ei}">
      <div class="exercise-editor-panel">
        <div class="editor-section-label">动作设置</div>

        <label class="editor-name-field">动作名称
          <input data-edit="name" autocomplete="off" value="${App.esc(ex.name || "")}">
        </label>

        <div class="editor-parameter-grid">
          <section class="editor-parameter-card">
            <div class="editor-parameter-title">次数范围</div>
            <div class="editor-range-fields">
              <label><span>最低</span><input data-edit="repMin" type="number" min="1" step="1" inputmode="numeric" value="${min}"></label>
              <span class="editor-range-divider">—</span>
              <label><span>最高</span><input data-edit="repMax" type="number" min="1" step="1" inputmode="numeric" value="${max}"></label>
            </div>
          </section>

          <section class="editor-parameter-card">
            <div class="editor-parameter-title">重量设置</div>
            <div class="editor-weight-fields">
              <label><span>默认重量</span><input data-edit="defaultWeight" type="number" step="0.5" inputmode="decimal" value="${ex.defaultWeight ?? ""}"></label>
              <label><span>递增档位</span><input data-edit="weightStep" type="number" min="0" step="0.5" inputmode="decimal" value="${weightStep(ex)}"></label>
            </div>
          </section>
        </div>

        <div class="editor-option-list">
          <div class="editor-setting-row editor-set-count-row">
            <div class="editor-setting-copy">
              <strong>组数</strong>
              <span>当前动作</span>
            </div>
            <div class="set-count-control" aria-label="调整动作组数">
              <button type="button" class="small secondary remove-set" data-e="${ei}" ${sets <= 1 ? "disabled" : ""} aria-label="减少一组">−</button>
              <span class="set-count-value">${sets}</span>
              <button type="button" class="small secondary add-set" data-e="${ei}" aria-label="增加一组">+</button>
            </div>
          </div>

          <label class="optional-toggle">
            <span class="editor-setting-copy">
              <strong>可选动作</strong>
              <span>训练时可按情况跳过</span>
            </span>
            <input class="optional-toggle-input" data-edit="optional" type="checkbox" ${ex.optional ? "checked" : ""}>
          </label>
        </div>

        <label class="editor-note-field">备注
          <textarea data-edit="note" rows="2">${App.esc(ex.note || "")}</textarea>
        </label>
      </div>

      <div class="editor-footer-actions">
        <button type="button" class="small editor-delete delete-exercise-inline" data-e="${ei}">删除动作</button>
        <button type="button" class="small exercise-edit-toggle editor-finish" data-e="${ei}">完成</button>
      </div>
    </div>`;
  }

  function renderExerciseCard(ex, ei, historyContext) {
    const history = historyContext.history(ex.name);
    const previous = history[0]?.exercise || null;
    const summary = previousSummary(previous);
    const suggestion = ex.warmup ? null : progressionSuggestion(ex, history);
    const [min, max] = repRange(ex);
    const sets = setCount(ex);
    const editorOpen = openEditors.has(ei);
    const meta = ex.note || (ex.warmup ? "专项热身" : "");
    const setsMeta = ex.warmup ? `${sets} 组 · 专项热身` : `${sets} 组 · ${min}–${max} 次`;

    let rows = "";
    for (let si = 0; si < sets; si++) {
      const prev = previous?.sets?.[si] || null;
      const preset = warmupPreset(ex, si);
      const plannedWeight = ex.warmup ? (preset.weight ?? "") : (suggestion?.weight ?? "");
      const plannedReps = ex.warmup ? (preset.repsLabel ?? preset.reps ?? "") : (suggestion?.reps?.[si] ?? min);
      const weightValue = Draft.getValue(ei, si, "weight");
      const repsValue = Draft.getValue(ei, si, "reps");
      const rirValue = Draft.getValue(ei, si, "rir");
      const done = Draft.isCompleted(ei, si);
      rows += `<div class="set-row workout-set-row${done ? " set-completed" : ""}" data-e="${ei}" data-s="${si}">
        <span class="set-number">${si + 1}</span>
        ${workoutNumberInput({ label: `第 ${si + 1} 组重量`, ei, si, key: "weight", value: weightValue, placeholder: plannedWeight, decimal: true })}
        ${workoutNumberInput({ label: `第 ${si + 1} 组次数`, ei, si, key: "reps", value: repsValue, placeholder: plannedReps })}
        ${workoutNumberInput({ label: `第 ${si + 1} 组 RIR`, ei, si, key: "rir", value: rirValue, placeholder: ex.warmup ? "" : (prev?.rir ?? "1–2"), done: true })}
        <button type="button" class="set-complete${done ? "" : " secondary"}" data-e="${ei}" data-s="${si}" aria-pressed="${done}">${done ? "✓" : "完成"}</button>
      </div>`;
    }

    return `<article class="card exercise-card${ex.warmup ? " warmup-card" : ""}" data-e="${ei}">
      <div class="exercise-head">
        <div class="exercise-title-wrap">
          <div class="exercise-title-line"><div class="exercise-title">${App.esc(ex.name || "未命名动作")}</div>${ex.optional ? '<span class="badge">可选</span>' : ""}${ex.warmup ? '<span class="badge warmup-badge">热身</span>' : ""}</div>
          <div class="exercise-meta">${App.esc(meta)}</div>
        </div>
        <button type="button" class="small secondary exercise-edit-toggle" data-e="${ei}">${editorOpen ? "收起" : "调整"}</button>
      </div>

      <div class="exercise-card-layout">
        <div class="exercise-summary-grid">
          ${previousHtml(summary)}
          ${progressionHtml(suggestion, ex)}
        </div>

        <section class="exercise-panel exercise-sets-panel">
          <div class="exercise-panel-heading">
            <div class="exercise-panel-title">动作组</div>
            <div class="exercise-panel-meta">${App.esc(setsMeta)}</div>
          </div>
          <div class="set-row set-header"><span>组</span><span>重量 kg</span><span>次数</span><span>RIR</span><span>完成</span></div>
          ${rows}
        </section>
      </div>

      ${renderEditor(ex, ei, sets, min, max)}
    </article>`;
  }

  function renderPlanSelect() {
    const select = document.getElementById("planSelect");
    if (!select) return;
    const wanted = Math.min(Math.max(0, Draft.planIndex || 0), Math.max(0, App.state.plans.length - 1));
    if (!App.state.plans.length) {
      select.innerHTML = "<option>暂无训练计划</option>";
      select.disabled = true;
      return;
    }
    select.disabled = false;
    select.innerHTML = App.state.plans.map((plan, index) => `<option value="${index}">${App.esc(plan.name || `训练计划 ${index + 1}`)}</option>`).join("");
    select.value = String(wanted);
  }

  function renderWorkout() {
    const container = document.getElementById("workoutContainer");
    if (!container) return;
    if (!App.state.plans.length) {
      container.innerHTML = '<div class="card empty-state"><strong>当前没有训练计划</strong><span>可从 GitHub 拉取已有计划，或导入本地备份。</span></div>';
      return;
    }
    const plan = App.state.plans[Draft.planIndex] || App.state.plans[0];
    const historyContext = buildHistoryContext(plan.name);
    const exercises = plan.exercises || [];
    container.innerHTML = exercises.map((ex, ei) => renderExerciseCard(ex, ei, historyContext)).join("") +
      '<div class="card add-exercise-card"><button id="addExerciseInlineBtn" type="button" class="secondary">+ 添加动作</button></div>';
  }

  function toggleEditor(button, ei) {
    const card = button.closest(".exercise-card");
    const editor = card?.querySelector(".exercise-inline-editor");
    if (!card || !editor) return false;

    const forceClose = button.classList.contains("editor-finish");
    const opening = forceClose ? false : editor.classList.contains("hidden");
    editor.classList.toggle("hidden", !opening);

    const headerToggle = card.querySelector(".exercise-head .exercise-edit-toggle");
    if (headerToggle) headerToggle.textContent = opening ? "收起" : "调整";

    if (opening) openEditors.add(ei); else openEditors.delete(ei);
    return true;
  }

  function clearEditors() {
    openEditors.clear();
  }

  function shiftEditorsAfterDeleteExercise(deletedEi) {
    const nextOpen = new Set();
    for (const index of openEditors) {
      if (index === deletedEi) continue;
      nextOpen.add(index > deletedEi ? index - 1 : index);
    }
    openEditors.clear();
    for (const index of nextOpen) openEditors.add(index);
  }

  window.TrainingRenderer = Object.freeze({
    renderPlanSelect,
    renderWorkout,
    toggleEditor,
    clearEditors,
    shiftEditorsAfterDeleteExercise,
    warmupPreset
  });
})();
