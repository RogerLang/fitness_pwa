(() => {
  const noop = () => {};
  window.TrainingInsights = Object.freeze({ init: noop, refresh: noop, onPage: noop });

  const App = window.FitnessApp;
  if (!App) return;

  let handoffLoad = null;

  function loadPlanningHandoff() {
    if (window.PlanningHandoff) return Promise.resolve(window.PlanningHandoff);
    if (handoffLoad) return handoffLoad;

    handoffLoad = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "js/training/planning-handoff.js";
      script.async = false;
      script.dataset.fitnessPageModule = "true";
      script.onload = () => resolve(window.PlanningHandoff);
      script.onerror = () => {
        handoffLoad = null;
        reject(new Error("模板协助接口加载失败"));
      };
      document.body.appendChild(script);
    });
    return handoffLoad;
  }

  App.registerModule({
    pages: ["plan"],
    async init() {
      const handoff = await loadPlanningHandoff();
      if (!handoff) throw new Error("模板协助接口初始化失败");
      await handoff.init?.();
    },
    async refresh(reason) {
      await window.PlanningHandoff?.refresh?.(reason);
    },
    async onPage(id) {
      if (id === "plan") await window.PlanningHandoff?.onPage?.(id);
    },
    async onDataReset(reason) {
      await window.PlanningHandoff?.onDataReset?.(reason);
    }
  });
})();
