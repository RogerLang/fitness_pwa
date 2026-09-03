(() => {
  const App = window.FitnessApp;
  const DRAFTS_KEY = "workoutDraftsV7";
  const ACTIVE_PLAN_KEY = "workoutActivePlanV7";
  const PROGRESSION_VERSION = 1;

  let draftStore = {};
  let draft = { planIndex: 0, sets: {}, completed: {} };
  let draftTimer = null;
  let historyLimit = 20;
  let progressRange = "1y";
  const openEditors = new Set();

  const clone = value => JSON.parse(JSON.stringify(value));
  const draftKey = (ei, si, key) => `${ei}:${si}:${key}`;
  const doneKey = (ei, si) => `${ei}:${si}`;
  const valueOrNull = value => {
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };

  function currentPlanIndex() {
    const select = document.getElementById("planSelect");
    if (!select || select.disabled) return 0;
    const index = Number(select.value || 0);
    return Number.isInteger(index) && index >= 0 ? index : 0;
  }

  function ensureDraftPlan(index = currentPlanIndex()) {
    if (draft.planIndex !== index) {
      const saved = draftStore[String(index)];
      draft = saved
        ? { planIndex: index, sets: clone(saved.sets || {}), completed: clone(saved.completed || {}) }
        : { planIndex: index, sets: {}, completed: {} };
    }
    return index;
  }

  function captureDraft() {
    const index = ensureDraftPlan();
    document.querySelectorAll('#workoutContainer input[data-e][data-s][data-k]').forEach(input => {
      draft.sets[draftKey(input.dataset.e, input.dataset.s, input.dataset.k)] = input.value;
    });
    document.querySelectorAll('#workoutContainer .workout-set-row[data-e][data-s]').forEach(row => {
      draft.completed[doneKey(row.dataset.e, row.dataset.s)] = row.classList.contains("set-completed");
    });
    draft.planIndex = index;
  }

  async function flushDraft() {
    clearTimeout(draftTimer);
    draftTimer = null;
    if (!App.db || !App.state.plans.length) return;
    draftStore[String(draft.planIndex)] = { ...clone(draft), savedAt: new Date().toISOString() };
    await Promise.all([
      App.idbSet(DRAFTS_KEY, clone(draftStore)),
      App.idbSet(ACTIVE_PLAN_KEY, draft.planIndex)
    ]);
  }

  function queueDraftWrite() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => flushDraft().catch(error => console.warn("draft save", error)), 180);
  }

  async function clearDraft(index = currentPlanIndex()) {
    delete draftStore[String(index)];
    await App.idbSet(DRAFTS_KEY, clone(draftStore));
  }

  function hasDraft() {
    captureDraft();
    return Object.values(draft.sets || {}).some(value => String(value ?? "").trim() !== "") ||
      Object.values(draft.completed || {}).some(Boolean);
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

  function progressionHtml(suggestion) {
    const weight = suggestion.weight === null || suggestion.weight === undefined ? "自选重量" : `${Number(suggestion.weight)} kg`;
    const confirm = suggestion.confirmation ? `<span class="context-chip">${suggestion.confirmation}/2</span>` : "";
    return `<section class="workout-context progression-context">
      <div class="context-head"><strong>本次计划</strong><span class="context-chip">${App.esc(suggestion.statusLabel)}</span>${confirm}</div>
      <div class="context-target">${App.esc(weight)} · ${App.esc((suggestion.reps || []).join(" / "))} 次</div>
      <div class="context-detail">${App.esc(suggestion.reason)}</div>
    </section>`;
  }

  function previousHtml(summary) {
    if (!summary) return "";
    return `<section class="workout-context previous-context">
      <div class="context-head"><strong>上次记录</strong></div>
      <div class="context-target">${App.esc(summary.target)}</div>
      ${summary.detail ? `<div class="context-detail">${App.esc(summary.detail)}</div>` : ""}
    </section>`;
  }

  function draftValue(ei, si, key) {
    const k = draftKey(ei, si, key);
    return Object.prototype.hasOwnProperty.call(draft.sets, k) ? draft.sets[k] : "";
  }

  function warmupPreset(ex, si) {
    return Array.isArray(ex?.setPresets) ? (ex.setPresets[si] || {}) : {};
  }

  function renderExerciseCard(ex, ei, plan, historyContext) {
    const history = historyContext.history(ex.name);
    const previous = history[0]?.exercise || null;
    const summary = previousSummary(previous);
    const suggestion = ex.warmup ? null : progressionSuggestion(ex, history);
    const [min, max] = repRange(ex);
    const sets = setCount(ex);
    const editorOpen = openEditors.has(ei);
    const meta = ex.warmup ? (ex.note || "专项热身；不计入正式组与进阶") : `${min}–${max} 次${ex.note ? ` · ${ex.note}` : ""}`;
    const contexts = ex.warmup
      ? `<div class="warmup-callout">${App.esc(ex.note || "专项热身；完成后进入正式工作组")}</div>`
      : `<div class="workout-context-grid">${previousHtml(summary)}${progressionHtml(suggestion)}</div>`;

    let rows = "";
    for (let si = 0; si < sets; si++) {
      const prev = previous?.sets?.[si] || null;
      const preset = warmupPreset(ex, si);
      const plannedWeight = ex.warmup ? (preset.weight ?? "") : (suggestion?.weight ?? "");
      const plannedReps = ex.warmup ? (preset.repsLabel ?? preset.reps ?? "") : (suggestion?.reps?.[si] ?? min);
      const weightValue = draftValue(ei, si, "weight");
      const repsValue = draftValue(ei, si, "reps");
      const rirValue = draftValue(ei, si, "rir");
      const done = !!draft.completed[doneKey(ei, si)];
      rows += `<div class="set-row workout-set-row${done ? " set-completed" : ""}" data-e="${ei}" data-s="${si}">
        <span class="set-number">${si + 1}</span>
        <input aria-label="第 ${si + 1} 组重量" type="number" step="0.5" inputmode="decimal" data-e="${ei}" data-s="${si}" data-k="weight" value="${App.esc(weightValue)}" placeholder="${App.esc(plannedWeight)}">
        <input aria-label="第 ${si + 1} 组次数" type="number" step="1" inputmode="numeric" data-e="${ei}" data-s="${si}" data-k="reps" value="${App.esc(repsValue)}" placeholder="${App.esc(plannedReps)}">
        <input aria-label="第 ${si + 1} 组 RIR" type="number" step="1" min="0" max="10" inputmode="numeric" data-e="${ei}" data-s="${si}" data-k="rir" value="${App.esc(rirValue)}" placeholder="${ex.warmup ? "" : App.esc(prev?.rir ?? "1–2")}">
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
      ${contexts}
      <div class="set-row set-header"><span>组</span><span>重量 kg</span><span>次数</span><span>RIR</span><span>完成</span></div>
      ${rows}
      <div class="exercise-inline-editor${editorOpen ? "" : " hidden"}" data-e="${ei}">
        <div class="inline-editor-grid">
          <label class="wide">动作名称<input data-edit="name" value="${App.esc(ex.name || "")}"></label>
          <label>最低次数<input data-edit="repMin" type="number" min="1" step="1" value="${min}"></label>
          <label>最高次数<input data-edit="repMax" type="number" min="1" step="1" value="${max}"></label>
          <label>默认 kg<input data-edit="defaultWeight" type="number" step="0.5" value="${ex.defaultWeight ?? ""}"></label>
          <label>重量档位 kg<input data-edit="weightStep" type="number" min="0" step="0.5" value="${weightStep(ex)}"></label>
        </div>
        <label>备注<textarea data-edit="note">${App.esc(ex.note || "")}</textarea></label>
        <div class="editor-actions">
          <div class="row wrap">
            <button type="button" class="small secondary remove-set" data-e="${ei}" ${sets <= 1 ? "disabled" : ""}>− 1组</button>
            <button type="button" class="small secondary add-set" data-e="${ei}">+ 1组</button>
          </div>
          <label class="row compact-check"><input data-edit="optional" type="checkbox" ${ex.optional ? "checked" : ""}> 可选动作</label>
          <button type="button" class="small danger delete-exercise-inline" data-e="${ei}">删除动作</button>
        </div>
      </div>
    </article>`;
  }

  function renderPlanSelect() {
    const select = document.getElementById("planSelect");
    if (!select) return;
    const wanted = Math.min(Math.max(0, draft.planIndex || 0), Math.max(0, App.state.plans.length - 1));
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
    const pi = ensureDraftPlan();
    const plan = App.state.plans[pi] || App.state.plans[0];
    const historyContext = buildHistoryContext(plan.name);
    const exercises = plan.exercises || [];
    container.innerHTML = exercises.map((ex, ei) => renderExerciseCard(ex, ei, plan, historyContext)).join("") +
      '<div class="card add-exercise-card"><button id="addExerciseInlineBtn" type="button" class="secondary">+ 添加动作</button></div>';
  }

  function allExerciseNames() {
    return [...new Set(App.state.plans.flatMap(plan => (plan.exercises || []).filter(ex => !ex.warmup).map(ex => ex.name)).filter(Boolean))];
  }

  function renderHistory() {
    const box = document.getElementById("historyList");
    if (!box) return;
    const arr = [...App.state.sessions].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    if (!arr.length) {
      box.innerHTML = '<div class="empty">暂无训练记录</div>';
      return;
    }
    const shown = arr.slice(0, historyLimit);
    box.innerHTML = shown.map(session => {
      const exercises = (session.exercises || []).map(ex => {
        const chips = (ex.sets || []).map((set, index) => `<span class="history-set-chip"><b>${index + 1}</b>${App.esc(setText(set) || "未记录")}</span>`).join("");
        return `<div class="history-exercise"><div class="history-exercise-name">${App.esc(ex.name || "")}</div><div class="history-set-list">${chips}</div></div>`;
      }).join("");
      return `<article class="history-card"><div class="history-head"><strong>${App.esc(session.date || "")}</strong><span class="badge">${App.esc(session.plan || "训练")}</span></div>${exercises}</article>`;
    }).join("") + (shown.length < arr.length ? `<div class="load-more-row"><button id="loadMoreHistory" class="secondary">加载更多（${shown.length}/${arr.length}）</button></div>` : "");
    const more = document.getElementById("loadMoreHistory");
    if (more) more.onclick = () => { historyLimit += 20; renderHistory(); };
  }

  function rangeCutoff() {
    if (progressRange === "all") return null;
    const date = new Date();
    if (progressRange === "3m") date.setMonth(date.getMonth() - 3);
    else if (progressRange === "6m") date.setMonth(date.getMonth() - 6);
    else date.setFullYear(date.getFullYear() - 1);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function withinRange(date) {
    const cutoff = rangeCutoff();
    if (!cutoff) return true;
    const parsed = new Date(`${String(date)}T00:00:00`);
    return !Number.isNaN(parsed.getTime()) && parsed >= cutoff;
  }

  function progressData(name) {
    const history = [...App.state.sessions]
      .filter(session => withinRange(session.date))
      .sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")))
      .map(session => ({ date: session.date, ex: (session.exercises || []).find(ex => ex.name === name) }))
      .filter(item => item.ex);
    const weighted = history.some(item => (item.ex.sets || []).some(set => Number(set.weight) > 0 && Number(set.reps) > 0));
    const points = [];
    for (const item of history) {
      const sets = (item.ex.sets || []).filter(set => Number(set.reps) > 0);
      if (!sets.length) continue;
      if (weighted) {
        let best = null;
        for (const set of sets) {
          const weight = Number(set.weight), reps = Number(set.reps);
          if (weight > 0 && reps > 0) {
            const e1rm = weight * (1 + reps / 30);
            if (best === null || e1rm > best) best = e1rm;
          }
        }
        if (best !== null) points.push({ date: item.date, value: best });
      } else {
        points.push({ date: item.date, value: sets.reduce((sum, set) => sum + Number(set.reps || 0), 0) });
      }
    }
    return { history, weighted, points };
  }

  function renderProgressOptions() {
    const select = document.getElementById("progressExercise");
    if (!select) return;
    const old = select.value;
    const names = allExerciseNames();
    select.innerHTML = names.map(name => `<option>${App.esc(name)}</option>`).join("");
    if ([...select.options].some(option => option.value === old)) select.value = old;
  }

  function rangeLabel() {
    return ({ "3m": "近 3 个月", "6m": "近 6 个月", "1y": "近 1 年", all: "全部" })[progressRange] || "近 1 年";
  }

  function shortDate(date) {
    const value = String(date || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value.slice(5) : value;
  }

  function drawProgress() {
    if (!document.getElementById("progress")?.classList.contains("active")) return;
    const select = document.getElementById("progressExercise");
    const name = select?.value || "";
    const canvas = document.getElementById("progressChart");
    const summary = document.getElementById("progressSummary");
    if (!canvas || !summary) return;
    const { history, weighted, points } = progressData(name);
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    const L = 78, R = 24, T = 28, B = 66, plotW = W - L - R, plotH = H - T - B;
    ctx.clearRect(0, 0, W, H);
    ctx.font = "14px system-ui";
    ctx.textBaseline = "middle";

    if (!points.length) {
      ctx.strokeStyle = "#d7dbe2"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, H - B); ctx.lineTo(W - R, H - B); ctx.stroke();
      ctx.fillStyle = "#7a8290"; ctx.textAlign = "center"; ctx.font = "22px system-ui";
      ctx.fillText("该时间范围暂无可计算数据", L + plotW / 2, T + plotH / 2);
      summary.textContent = history.length ? `${rangeLabel()}内已有记录，但缺少可计算的重量/次数组合。` : `${rangeLabel()}内暂无该动作记录。`;
      return;
    }

    const values = points.map(point => point.value);
    let min = Math.min(...values), max = Math.max(...values);
    if (min === max) { const pad = Math.max(1, Math.abs(min) * 0.12); min -= pad; max += pad; }
    else { const pad = (max - min) * 0.12; min -= pad; max += pad; }
    if (!weighted) min = Math.max(0, min);
    const x = index => L + plotW * (points.length === 1 ? 0.5 : index / (points.length - 1));
    const y = value => T + plotH * (1 - (value - min) / (max - min || 1));

    ctx.textAlign = "right"; ctx.font = "13px system-ui";
    for (let i = 0; i <= 4; i++) {
      const value = min + (max - min) * i / 4, yy = y(value);
      ctx.strokeStyle = "#eef0f3"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, yy); ctx.lineTo(W - R, yy); ctx.stroke();
      ctx.fillStyle = "#7a8290"; ctx.fillText(weighted ? value.toFixed(1) : Math.round(value).toString(), L - 10, yy);
    }
    ctx.strokeStyle = "#cbd0d8"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, H - B); ctx.lineTo(W - R, H - B); ctx.stroke();

    const ticks = [];
    const maxTicks = Math.min(5, points.length);
    if (points.length === 1) ticks.push(0);
    else for (let i = 0; i < maxTicks; i++) ticks.push(Math.round(i * (points.length - 1) / (maxTicks - 1)));
    for (const index of [...new Set(ticks)]) {
      const xx = x(index);
      ctx.strokeStyle = "#cbd0d8"; ctx.beginPath(); ctx.moveTo(xx, H - B); ctx.lineTo(xx, H - B + 5); ctx.stroke();
      ctx.fillStyle = "#7a8290"; ctx.textAlign = "center"; ctx.fillText(shortDate(points[index].date), xx, H - B + 20);
    }

    ctx.fillStyle = "#4b5563"; ctx.textAlign = "center"; ctx.fillText("日期", L + plotW / 2, H - 14);
    ctx.save(); ctx.translate(18, T + plotH / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(weighted ? "估算 1RM (kg)" : "总次数", 0, 0); ctx.restore();
    ctx.strokeStyle = "#171a21"; ctx.lineWidth = 3; ctx.beginPath();
    points.forEach((point, index) => { const xx = x(index), yy = y(point.value); index ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy); }); ctx.stroke();
    ctx.fillStyle = "#171a21";
    points.forEach((point, index) => { ctx.beginPath(); ctx.arc(x(index), y(point.value), 5.5, 0, Math.PI * 2); ctx.fill(); });

    const metric = weighted ? "估算 1RM" : "总次数", unit = weighted ? " kg" : " 次";
    summary.textContent = points.length === 1
      ? `${name} · ${rangeLabel()}：1 次有效记录，${metric} ${points[0].value.toFixed(weighted ? 1 : 0)}${unit}。`
      : `${name} · ${rangeLabel()}：${metric}从 ${points[0].value.toFixed(weighted ? 1 : 0)}${unit} 到 ${points.at(-1).value.toFixed(weighted ? 1 : 0)}${unit}。`;
  }

  async function persistPlanAndRender() {
    await App.persist("plans");
    renderPlanSelect();
    renderWorkout();
  }

  function trimLastSetDraft(ei, lastSi) {
    ["weight", "reps", "rir"].forEach(key => delete draft.sets[draftKey(ei, lastSi, key)]);
    delete draft.completed[doneKey(ei, lastSi)];
  }

  function shiftDraftAfterDeleteExercise(deletedEi) {
    const nextSets = {}, nextCompleted = {};
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
    const nextOpen = new Set();
    for (const index of openEditors) if (index !== deletedEi) nextOpen.add(index > deletedEi ? index - 1 : index);
    openEditors.clear();
    for (const index of nextOpen) openEditors.add(index);
  }

  async function workoutClick(event) {
    const button = event.target.closest("button");
    if (!button) return;
    const pi = ensureDraftPlan();
    const plan = App.state.plans[pi];
    if (!plan) return;
    const ei = Number(button.dataset.e);

    if (button.classList.contains("exercise-edit-toggle")) {
      const editor = button.closest(".exercise-card")?.querySelector(".exercise-inline-editor");
      if (!editor) return;
      const opening = editor.classList.contains("hidden");
      editor.classList.toggle("hidden", !opening);
      button.textContent = opening ? "收起" : "调整";
      if (opening) openEditors.add(ei); else openEditors.delete(ei);
      return;
    }

    if (button.classList.contains("set-complete")) {
      const si = Number(button.dataset.s);
      const row = button.closest(".workout-set-row");
      const done = !row.classList.contains("set-completed");
      row.classList.toggle("set-completed", done);
      button.classList.toggle("secondary", !done);
      button.textContent = done ? "✓" : "完成";
      button.setAttribute("aria-pressed", String(done));
      draft.completed[doneKey(ei, si)] = done;
      queueDraftWrite();
      return;
    }

    if (button.classList.contains("add-set")) {
      captureDraft();
      plan.exercises[ei].sets = setCount(plan.exercises[ei]) + 1;
      await persistPlanAndRender();
      queueDraftWrite();
      return;
    }

    if (button.classList.contains("remove-set")) {
      const ex = plan.exercises[ei], sets = setCount(ex);
      if (sets <= 1) return;
      captureDraft();
      trimLastSetDraft(ei, sets - 1);
      ex.sets = sets - 1;
      await persistPlanAndRender();
      queueDraftWrite();
      return;
    }

    if (button.classList.contains("delete-exercise-inline")) {
      if (!confirm("删除这个动作？历史训练记录会保留。")) return;
      captureDraft();
      plan.exercises.splice(ei, 1);
      shiftDraftAfterDeleteExercise(ei);
      await persistPlanAndRender();
      queueDraftWrite();
      return;
    }

    if (button.id === "addExerciseInlineBtn") {
      captureDraft();
      plan.exercises ??= [];
      plan.exercises.push({ name: "新动作", sets: 3, repRange: [8, 12], defaultWeight: null, weightStep: 5, note: "", optional: false });
      await persistPlanAndRender();
      queueDraftWrite();
    }
  }

  function workoutInput(event) {
    const input = event.target;
    if (!input.matches('input[data-e][data-s][data-k]')) return;
    ensureDraftPlan();
    draft.sets[draftKey(input.dataset.e, input.dataset.s, input.dataset.k)] = input.value;
    queueDraftWrite();
  }

  async function workoutChange(event) {
    const input = event.target;
    const editor = input.closest(".exercise-inline-editor");
    if (!editor || !input.dataset.edit) return;
    captureDraft();
    const pi = ensureDraftPlan(), ei = Number(editor.dataset.e);
    const ex = App.state.plans?.[pi]?.exercises?.[ei];
    if (!ex) return;
    const field = input.dataset.edit;
    if (field === "name") ex.name = input.value.trim() || "未命名动作";
    else if (field === "repMin") { ex.repRange ??= [8, 12]; ex.repRange[0] = Math.max(1, Number(input.value) || 1); }
    else if (field === "repMax") { ex.repRange ??= [8, 12]; ex.repRange[1] = Math.max(1, Number(input.value) || 1); }
    else if (field === "defaultWeight") ex.defaultWeight = valueOrNull(input.value);
    else if (field === "weightStep") ex.weightStep = Math.max(0, Number(input.value) || 0);
    else if (field === "note") ex.note = input.value;
    else if (field === "optional") ex.optional = input.checked;
    await App.persist("plans");
    renderWorkout();
    queueDraftWrite();
  }

  async function saveWorkout() {
    if (!App.state.plans.length) return;
    const pi = ensureDraftPlan();
    const plan = App.state.plans[pi];
    captureDraft();
    const historyContext = buildHistoryContext(plan.name);
    const plannedByName = new Map();
    for (const ex of plan.exercises || []) if (!ex.warmup) plannedByName.set(ex.name, progressionSuggestion(ex, historyContext.history(ex.name)));

    const exercises = (plan.exercises || []).map((ex, ei) => {
      const previous = historyContext.latest(ex.name);
      const sets = [];
      for (let si = 0; si < setCount(ex); si++) {
        const raw = {
          weight: draft.sets[draftKey(ei, si, "weight")],
          reps: draft.sets[draftKey(ei, si, "reps")],
          rir: draft.sets[draftKey(ei, si, "rir")]
        };
        const completed = !!draft.completed[doneKey(ei, si)];
        const touched = Object.values(raw).some(value => value !== "" && value !== undefined && value !== null);
        if (!completed && !touched) continue;

        const prev = previous?.sets?.[si] || null;
        const preset = warmupPreset(ex, si);
        let weight = valueOrNull(raw.weight), reps = valueOrNull(raw.reps), rir = valueOrNull(raw.rir);
        if (weight === null && (reps !== null || completed)) {
          if (ex.warmup && valueOrNull(preset.weight) !== null) weight = valueOrNull(preset.weight);
          else if (valueOrNull(prev?.weight) !== null) weight = valueOrNull(prev.weight);
          else if (valueOrNull(ex.defaultWeight) !== null) weight = valueOrNull(ex.defaultWeight);
        }
        if (reps === null && completed) {
          if (ex.warmup && valueOrNull(preset.reps) !== null) reps = valueOrNull(preset.reps);
          else if (valueOrNull(prev?.reps) !== null) reps = valueOrNull(prev.reps);
        }
        sets.push({ weight, reps, rir, completed });
      }
      const result = { name: ex.name, sets };
      if (sets.length && !ex.warmup) {
        const planned = plannedByName.get(ex.name);
        result.planned = {
          version: planned.version, weight: planned.weight, reps: [...planned.reps],
          repRange: [...planned.repRange], weightStep: planned.weightStep, status: planned.status
        };
        const actualWeight = workingWeight(sets);
        result.weightOverride = planned.weight !== null && actualWeight !== null && actualWeight !== planned.weight;
      }
      return result;
    }).filter(ex => ex.sets.length);

    if (!exercises.length) {
      App.toast("还没有输入训练数据", "error");
      return;
    }

    App.state.sessions.push({ id: crypto.randomUUID(), date: App.isoDate(), plan: plan.name, exercises });
    await App.persist("workout");
    await clearDraft(pi);
    draft = { planIndex: pi, sets: {}, completed: {} };
    renderWorkout();
    App.toast("本次训练已保存", "success");
  }

  async function resetWorkout() {
    const pi = currentPlanIndex();
    if (hasDraft() && !confirm("清空本次未保存输入？")) return;
    draft = { planIndex: pi, sets: {}, completed: {} };
    await clearDraft(pi);
    renderWorkout();
  }

  async function changePlan() {
    captureDraft();
    await flushDraft();
    const pi = currentPlanIndex();
    ensureDraftPlan(pi);
    await App.idbSet(ACTIVE_PLAN_KEY, pi);
    openEditors.clear();
    renderWorkout();
  }

  function syncRangeButtons() {
    document.querySelectorAll("#progressRange .v16-range-btn").forEach(button => button.classList.toggle("active", button.dataset.range === progressRange));
  }

  function bindEvents() {
    const workout = document.getElementById("workoutContainer");
    workout.addEventListener("click", workoutClick);
    workout.addEventListener("input", workoutInput);
    workout.addEventListener("change", workoutChange);
    document.getElementById("planSelect").onchange = changePlan;
    document.getElementById("saveWorkoutBtn").onclick = saveWorkout;
    document.getElementById("resetWorkoutBtn").onclick = resetWorkout;
    document.getElementById("progressExercise").onchange = drawProgress;
    document.querySelectorAll("#progressRange .v16-range-btn").forEach(button => {
      button.onclick = () => { progressRange = button.dataset.range || "1y"; syncRangeButtons(); drawProgress(); };
    });
    syncRangeButtons();
    document.addEventListener("visibilitychange", () => { if (document.hidden) { captureDraft(); flushDraft().catch(() => {}); } });
    window.addEventListener("pagehide", () => { captureDraft(); flushDraft().catch(() => {}); });
  }

  function exerciseMap(session) {
    const map = new Map();
    for (const ex of session?.exercises || []) if (ex?.name) map.set(ex.name, ex);
    return map;
  }

  function repVector(ex) {
    return (ex?.sets || []).map(set => set?.reps === null || set?.reps === undefined ? "_" : String(set.reps)).join(",");
  }

  function sessionRichness(session) {
    let score = 0;
    for (const ex of session?.exercises || []) for (const set of ex.sets || []) {
      if (set.weight !== null && set.weight !== undefined) score += 2;
      if (set.reps !== null && set.reps !== undefined) score += 2;
      if (set.rir !== null && set.rir !== undefined) score += 1;
      if (set.completed) score += 0.25;
    }
    return score;
  }

  function duplicatePreference(a, b) {
    if (!a || !b || a.date !== b.date || a.plan !== b.plan) return 0;
    const am = exerciseMap(a), bm = exerciseMap(b);
    const common = [...am.keys()].filter(key => bm.has(key));
    const needed = Math.max(3, Math.min(am.size, bm.size) - 1);
    if (common.length < needed) return 0;
    let comparable = 0, aRepair = 0, bRepair = 0;
    for (const name of common) {
      const ae = am.get(name), be = bm.get(name);
      const ar = repVector(ae), br = repVector(be);
      if (!ar || !br || ar.replaceAll("_", "") === "" || br.replaceAll("_", "") === "") continue;
      comparable++;
      if (ar !== br) return 0;
      const count = Math.min(ae.sets?.length || 0, be.sets?.length || 0);
      for (let i = 0; i < count; i++) {
        const as = ae.sets[i] || {}, bs = be.sets[i] || {};
        if (as.reps === null || as.reps === undefined || bs.reps === null || bs.reps === undefined) continue;
        if ((as.weight === null || as.weight === undefined) && Number(bs.weight) > 0) aRepair++;
        if ((bs.weight === null || bs.weight === undefined) && Number(as.weight) > 0) bRepair++;
      }
    }
    if (comparable < 3) return 0;
    const ar = sessionRichness(a), br = sessionRichness(b);
    if (aRepair >= 2 && aRepair > bRepair && br > ar) return -1;
    if (bRepair >= 2 && bRepair > aRepair && ar > br) return 1;
    return 0;
  }

  async function cleanupDuplicates({ persistChanges = true } = {}) {
    if (!Array.isArray(App.state.sessions) || App.state.sessions.length < 2) return 0;
    const remove = new Set();
    for (let i = 0; i < App.state.sessions.length; i++) {
      if (remove.has(i)) continue;
      for (let j = i + 1; j < App.state.sessions.length; j++) {
        if (remove.has(j)) continue;
        const preference = duplicatePreference(App.state.sessions[i], App.state.sessions[j]);
        if (preference < 0) { remove.add(i); break; }
        if (preference > 0) remove.add(j);
      }
    }
    if (!remove.size) return 0;
    App.state.sessions = App.state.sessions.filter((_, index) => !remove.has(index));
    if (persistChanges) await App.persist("maintenance");
    return remove.size;
  }

  async function init() {
    draftStore = await App.idbGet(DRAFTS_KEY) || {};
    let pi = Number(await App.idbGet(ACTIVE_PLAN_KEY));
    if (!Number.isInteger(pi) || pi < 0 || pi >= App.state.plans.length) pi = 0;
    const saved = draftStore[String(pi)];
    draft = saved ? { planIndex: pi, sets: clone(saved.sets || {}), completed: clone(saved.completed || {}) } : { planIndex: pi, sets: {}, completed: {} };
    bindEvents();
    const idle = window.requestIdleCallback || (fn => setTimeout(fn, 600));
    idle(async () => {
      try {
        await cleanupDuplicates();
        if (navigator.storage?.persist) await navigator.storage.persist();
      } catch (error) { console.warn("maintenance", error); }
    }, { timeout: 1800 });
  }

  async function refresh(reason) {
    renderPlanSelect();
    ensureDraftPlan(Math.min(draft.planIndex, Math.max(0, App.state.plans.length - 1)));
    renderWorkout();
    if (document.getElementById("history")?.classList.contains("active")) renderHistory();
    if (document.getElementById("progress")?.classList.contains("active")) { renderProgressOptions(); drawProgress(); }
    if (reason === "boot") historyLimit = 20;
  }

  async function onPage(id) {
    if (id === "history") renderHistory();
    if (id === "progress") { renderProgressOptions(); drawProgress(); }
  }

  async function onDataReset() {
    clearTimeout(draftTimer);
    draftStore = {};
    draft = { planIndex: 0, sets: {}, completed: {} };
    openEditors.clear();
    await Promise.all([App.idbSet(DRAFTS_KEY, {}), App.idbSet(ACTIVE_PLAN_KEY, 0)]);
  }

  async function prepareRemotePlans(oldPlanName, plansChanged) {
    let index = App.state.plans.findIndex(plan => plan.name === oldPlanName);
    if (index < 0) index = 0;
    if (plansChanged) {
      draftStore = {};
      await App.idbSet(DRAFTS_KEY, {});
    }
    draft = { planIndex: index, sets: {}, completed: {} };
    await App.idbSet(ACTIVE_PLAN_KEY, index);
    openEditors.clear();
  }

  App.training = {
    currentPlanIndex, hasDraft, captureDraft, flushDraft, cleanupDuplicates,
    prepareRemotePlans,
    get currentPlanName() { return App.state.plans[currentPlanIndex()]?.name || ""; }
  };

  App.registerModule({ init, refresh, onPage, onDataReset });
})();
