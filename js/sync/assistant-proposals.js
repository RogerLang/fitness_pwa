(() => {
  const App = window.FitnessApp;
  if (!App) return;

  let core = null;
  let loadPromise = null;

  function loadCore() {
    if (core) return Promise.resolve(core);
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
      const finish = () => {
        try {
          if (!window.FitnessAssistantProposalsV165?.create) throw new Error("assistant-proposals-v165.js did not register");
          core = window.FitnessAssistantProposalsV165.create(App);
          resolve(core);
        } catch (error) {
          reject(error);
        }
      };
      if (window.FitnessAssistantProposalsV165?.create) {
        finish();
        return;
      }
      const script = document.createElement("script");
      script.src = "js/sync/assistant-proposals-v165.js";
      script.async = false;
      script.onload = finish;
      script.onerror = () => reject(new Error("页面模块加载失败：js/sync/assistant-proposals-v165.js"));
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
