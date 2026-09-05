(() => {
  const App = window.FitnessApp;
  const Progression = window.TrainingProgression;
  const SessionData = window.TrainingSessionData;
  if (!Progression || !SessionData) throw new Error("History dependencies must load before TrainingHistory");

  let historyLimit = 20;
  let historyPlanFilter = "all";

  function planKey(session) {
    const id = String(session?.planId || "");
    const name = String(session?.plan || "");
    return id ? `id:${id}` : `name:${name}`;
  }

  function historyPlans() {
    const currentNames = new Map(App.state.plans
      .filter(plan => plan?.planId)
      .map(plan => [String(plan.planId), String(plan.name || "训练")]));
    const plans = new Map();
    for (const session of SessionData.orderedSessions()) {
      const key = planKey(session);
      if (!key || key === "name:") continue;
      const currentName = session?.planId ? currentNames.get(String(session.planId)) : "";
      const label = currentName || String(session?.plan || "训练");
      if (!plans.has(key)) plans.set(key, label);
    }
    return [...plans.entries()]
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "zh-CN"));
  }

  function renderHistoryFilter() {
    const select = document.getElementById("historyPlanFilter");
    if (!select) return;
    const plans = historyPlans();
    const current = historyPlanFilter;
    select.innerHTML = '<option value="all">全部训练</option>' + plans.map(plan => `<option value="${App.esc(plan.key)}">${App.esc(plan.label)}</option>`).join("");
    historyPlanFilter = current === "all" || plans.some(plan => plan.key === current) ? current : "all";
    select.value = historyPlanFilter;
  }

  function sessionStats(session) {
    const exercises = session.exercises || [];
    let setCount = 0;
    let volume = 0;
    for (const ex of exercises) {
      for (const set of ex.sets || []) {
        setCount++;
        const weight = Number(set.weight);
        const reps = Number(set.reps);
        if (Progression.usesWeight(ex) && weight > 0 && reps > 0) volume += weight * reps;
      }
    }
    return { exerciseCount: exercises.length, setCount, volume };
  }

  function historyDetailsHtml(session) {
    return (session.exercises || []).map(ex => {
      const chips = (ex.sets || []).map((set, index) => `<span class="history-set-chip"><b>${index + 1}</b>${App.esc(Progression.setText(set, ex) || "未记录")}</span>`).join("");
      return `<div class="history-exercise"><div class="history-exercise-name">${App.esc(ex.name || "")}</div><div class="history-set-list">${chips}</div></div>`;
    }).join("");
  }

  function bindHistoryDetails(details, session) {
    details.addEventListener("toggle", () => {
      if (!details.open || details.dataset.loaded === "true") return;
      const body = details.querySelector(".history-details-body");
      if (!body) return;
      body.innerHTML = historyDetailsHtml(session);
      details.dataset.loaded = "true";
    });
  }

  function renderHistory() {
    const box = document.getElementById("historyList");
    if (!box) return;
    renderHistoryFilter();
    const arr = SessionData.orderedSessions().filter(session => historyPlanFilter === "all" || planKey(session) === historyPlanFilter);
    if (!arr.length) {
      box.innerHTML = `<div class="card empty">${historyPlanFilter === "all" ? "暂无训练记录" : "暂无此训练计划的记录"}</div>`;
      return;
    }

    const shown = arr.slice(0, historyLimit);
    box.innerHTML = shown.map(session => {
      const stats = sessionStats(session);
      const volumeText = stats.volume > 0 ? `<span>训练量 ${Math.round(stats.volume).toLocaleString("zh-CN")} kg</span>` : "";
      return `<article class="history-card">
        <div class="history-head">
          <div class="history-head-copy"><strong>${App.esc(session.plan || "训练")}</strong><span>${App.esc(session.date || "")}</span></div>
          <span class="badge">${stats.exerciseCount} 个动作</span>
        </div>
        <div class="history-summary-meta"><span>${stats.setCount} 组</span>${volumeText}</div>
        <details class="history-details">
          <summary>查看详情</summary>
          <div class="history-details-body"></div>
        </details>
      </article>`;
    }).join("") + (shown.length < arr.length ? `<div class="load-more-row"><button id="loadMoreHistory" class="secondary">加载更多（${shown.length}/${arr.length}）</button></div>` : "");

    box.querySelectorAll(".history-details").forEach((details, index) => bindHistoryDetails(details, shown[index]));
    const more = document.getElementById("loadMoreHistory");
    if (more) more.onclick = () => { historyLimit += 20; renderHistory(); };
  }

  function init() {
    const select = document.getElementById("historyPlanFilter");
    if (select) select.onchange = () => {
      historyPlanFilter = select.value || "all";
      historyLimit = 20;
      renderHistory();
    };
  }

  function refresh(reason) {
    if (reason === "boot") historyLimit = 20;
    if (document.getElementById("history")?.classList.contains("active")) renderHistory();
  }

  function onPage(id) {
    if (id === "history") renderHistory();
  }

  const module = { init, refresh, onPage };
  App.registerModule(module);
  window.TrainingHistory = Object.freeze({ ...module, render: renderHistory });
})();