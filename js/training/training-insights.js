(() => {
  const App = window.FitnessApp;
  const Progression = window.TrainingProgression;
  if (!Progression) throw new Error("TrainingProgression must load before TrainingInsights");

  let historyLimit = 20;
  let progressRange = "1y";

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
        const chips = (ex.sets || []).map((set, index) => `<span class="history-set-chip"><b>${index + 1}</b>${App.esc(Progression.setText(set) || "未记录")}</span>`).join("");
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

  function syncRangeButtons() {
    document.querySelectorAll("#progressRange .v16-range-btn").forEach(button => button.classList.toggle("active", button.dataset.range === progressRange));
  }

  function init() {
    document.getElementById("progressExercise").onchange = drawProgress;
    document.querySelectorAll("#progressRange .v16-range-btn").forEach(button => {
      button.onclick = () => { progressRange = button.dataset.range || "1y"; syncRangeButtons(); drawProgress(); };
    });
    syncRangeButtons();
  }

  function refresh(reason) {
    if (document.getElementById("history")?.classList.contains("active")) renderHistory();
    if (document.getElementById("progress")?.classList.contains("active")) { renderProgressOptions(); drawProgress(); }
    if (reason === "boot") historyLimit = 20;
  }

  function onPage(id) {
    if (id === "history") renderHistory();
    if (id === "progress") { renderProgressOptions(); drawProgress(); }
  }

  window.TrainingInsights = Object.freeze({ init, refresh, onPage });
})();
