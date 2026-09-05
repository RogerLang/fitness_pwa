(() => {
  const App = window.FitnessApp;
  const Progression = window.TrainingProgression;
  const SessionData = window.TrainingSessionData;
  if (!Progression || !SessionData) throw new Error("Progress dependencies must load before TrainingProgress");

  let progressRange = "1y";

  function allExerciseNames() {
    const names = new Set();
    const warmupNames = new Set();
    for (const plan of App.state.plans) {
      for (const ex of plan.exercises || []) {
        if (!ex?.name) continue;
        if (ex.warmup) warmupNames.add(ex.name);
        else names.add(ex.name);
      }
    }
    for (const session of SessionData.orderedSessions()) {
      for (const ex of session.exercises || []) {
        if (ex?.name && ex.warmup !== true && !warmupNames.has(ex.name)) names.add(ex.name);
      }
    }
    return [...names];
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
    const history = SessionData.orderedSessions()
      .filter(session => withinRange(session.date))
      .reverse()
      .map(session => ({ date: session.date, ex: (session.exercises || []).find(ex => ex.name === name) }))
      .filter(item => item.ex);
    const typed = [...history].reverse().find(item => item.ex?.loadType)?.ex || history.at(-1)?.ex || null;
    const type = Progression.loadType(typed);
    const metricType = type === "bodyweight" ? "reps" : type === "added-weight" ? "added-weight" : "e1rm";
    const points = [];

    for (const item of history) {
      const sets = (item.ex.sets || []).filter(set => Number(set.reps) > 0);
      if (!sets.length) continue;
      if (metricType === "e1rm") {
        let best = null;
        for (const set of sets) {
          const weight = Number(set.weight);
          const reps = Number(set.reps);
          if (weight > 0 && reps > 0) {
            const e1rm = weight * (1 + reps / 30);
            if (best === null || e1rm > best) best = e1rm;
          }
        }
        if (best !== null) points.push({ date: item.date, value: best });
      } else if (metricType === "added-weight") {
        const weights = sets.map(set => Number(set.weight)).filter(weight => weight > 0);
        if (weights.length) points.push({ date: item.date, value: Math.max(...weights) });
        else points.push({ date: item.date, value: 0 });
      } else {
        points.push({ date: item.date, value: sets.reduce((sum, set) => sum + Number(set.reps || 0), 0) });
      }
    }
    return { history, metricType, points };
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

    const { history, metricType, points } = progressData(name);
    const weighted = metricType !== "reps";
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const L = 78;
    const R = 24;
    const T = 28;
    const B = 66;
    const plotW = W - L - R;
    const plotH = H - T - B;
    ctx.clearRect(0, 0, W, H);
    ctx.font = "14px system-ui";
    ctx.textBaseline = "middle";

    if (!points.length) {
      ctx.strokeStyle = "#d7dbe2";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(L, T);
      ctx.lineTo(L, H - B);
      ctx.lineTo(W - R, H - B);
      ctx.stroke();
      ctx.fillStyle = "#7a8290";
      ctx.textAlign = "center";
      ctx.font = "22px system-ui";
      ctx.fillText("该时间范围暂无可计算数据", L + plotW / 2, T + plotH / 2);
      summary.textContent = history.length ? `${rangeLabel()}内已有记录，但缺少可计算的数据。` : `${rangeLabel()}内暂无该动作记录。`;
      return;
    }

    const values = points.map(point => point.value);
    let min = Math.min(...values);
    let max = Math.max(...values);
    if (min === max) {
      const pad = Math.max(1, Math.abs(min) * 0.12);
      min -= pad;
      max += pad;
    } else {
      const pad = (max - min) * 0.12;
      min -= pad;
      max += pad;
    }
    if (!weighted) min = Math.max(0, min);
    const x = index => L + plotW * (points.length === 1 ? 0.5 : index / (points.length - 1));
    const y = value => T + plotH * (1 - (value - min) / (max - min || 1));

    ctx.textAlign = "right";
    ctx.font = "13px system-ui";
    for (let i = 0; i <= 4; i++) {
      const value = min + (max - min) * i / 4;
      const yy = y(value);
      ctx.strokeStyle = "#eef0f3";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(L, yy);
      ctx.lineTo(W - R, yy);
      ctx.stroke();
      ctx.fillStyle = "#7a8290";
      ctx.fillText(weighted ? value.toFixed(1) : Math.round(value).toString(), L - 10, yy);
    }

    ctx.strokeStyle = "#cbd0d8";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(L, T);
    ctx.lineTo(L, H - B);
    ctx.lineTo(W - R, H - B);
    ctx.stroke();

    const ticks = [];
    const maxTicks = Math.min(5, points.length);
    if (points.length === 1) ticks.push(0);
    else for (let i = 0; i < maxTicks; i++) ticks.push(Math.round(i * (points.length - 1) / (maxTicks - 1)));
    for (const index of [...new Set(ticks)]) {
      const xx = x(index);
      ctx.strokeStyle = "#cbd0d8";
      ctx.beginPath();
      ctx.moveTo(xx, H - B);
      ctx.lineTo(xx, H - B + 5);
      ctx.stroke();
      ctx.fillStyle = "#7a8290";
      ctx.textAlign = "center";
      ctx.fillText(shortDate(points[index].date), xx, H - B + 20);
    }

    const axisLabel = metricType === "e1rm" ? "估算 1RM (kg)" : metricType === "added-weight" ? "附加重量 (kg)" : "总次数";
    ctx.fillStyle = "#4b5563";
    ctx.textAlign = "center";
    ctx.fillText("日期", L + plotW / 2, H - 14);
    ctx.save();
    ctx.translate(18, T + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(axisLabel, 0, 0);
    ctx.restore();

    ctx.strokeStyle = "#171a21";
    ctx.lineWidth = 3;
    ctx.beginPath();
    points.forEach((point, index) => {
      const xx = x(index);
      const yy = y(point.value);
      if (index) ctx.lineTo(xx, yy);
      else ctx.moveTo(xx, yy);
    });
    ctx.stroke();
    ctx.fillStyle = "#171a21";
    points.forEach((point, index) => {
      ctx.beginPath();
      ctx.arc(x(index), y(point.value), 5.5, 0, Math.PI * 2);
      ctx.fill();
    });

    const metric = metricType === "e1rm" ? "估算 1RM" : metricType === "added-weight" ? "附加重量" : "总次数";
    const unit = weighted ? " kg" : " 次";
    summary.textContent = points.length === 1
      ? `${name} · ${rangeLabel()}：1 次有效记录，${metric} ${points[0].value.toFixed(weighted ? 1 : 0)}${unit}。`
      : `${name} · ${rangeLabel()}：${metric}从 ${points[0].value.toFixed(weighted ? 1 : 0)}${unit} 到 ${points.at(-1).value.toFixed(weighted ? 1 : 0)}${unit}。`;
  }

  function syncRangeButtons() {
    document.querySelectorAll("#progressRange .v16-range-btn").forEach(button => button.classList.toggle("active", button.dataset.range === progressRange));
  }

  function init() {
    const select = document.getElementById("progressExercise");
    if (select) select.onchange = drawProgress;
    document.querySelectorAll("#progressRange .v16-range-btn").forEach(button => {
      button.onclick = () => {
        progressRange = button.dataset.range || "1y";
        syncRangeButtons();
        drawProgress();
      };
    });
    syncRangeButtons();
  }

  function refresh() {
    if (document.getElementById("progress")?.classList.contains("active")) {
      renderProgressOptions();
      drawProgress();
    }
  }

  function onPage(id) {
    if (id === "progress") {
      renderProgressOptions();
      drawProgress();
    }
  }

  window.TrainingProgress = Object.freeze({ init, refresh, onPage, draw: drawProgress });
})();
