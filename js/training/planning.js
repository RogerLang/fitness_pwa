(() => {
  const App = window.FitnessApp;
  if (!App) throw new Error("FitnessApp must load before planning.js");

  let core = null;
  let loadPromise = null;

  function loadCore() {
    if (core) return Promise.resolve(core);
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
      const finish = () => {
        try {
          if (!window.FitnessPlanningV165?.create) throw new Error("planning-v165.js did not register");
          core = window.FitnessPlanningV165.create(App);
          App.planning = core.publicApi;
          resolve(core);
        } catch (error) {
          reject(error);
        }
      };
      if (window.FitnessPlanningV165?.create) {
        finish();
        return;
      }
      const script = document.createElement("script");
      script.src = "js/training/planning-v165.js";
      script.async = false;
      script.onload = finish;
      script.onerror = () => reject(new Error("页面模块加载失败：js/training/planning-v165.js"));
      document.body.appendChild(script);
    });
    return loadPromise;
  }

  App.registerModule({
    pages: ["plan"],
    async init() {
      const module = await loadCore();
      await module.init();
    },
    async refresh(reason) {
      if (core?.refresh) await core.refresh(reason);
    },
    async onPage(id) {
      if (core?.onPage) await core.onPage(id);
    },
    async onDataReset(reason) {
      if (core?.onDataReset) await core.onDataReset(reason);
    }
  });
})();
