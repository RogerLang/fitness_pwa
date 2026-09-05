(() => {
  const App = window.FitnessApp;
  const Remote = window.FitnessSyncRemote;
  if (!App || !Remote) throw new Error("Sync dependencies must load before sync.js");

  let core = null;
  let loadPromise = null;

  function loadCore() {
    if (core) return Promise.resolve(core);
    if (loadPromise) return loadPromise;
    loadPromise = new Promise((resolve, reject) => {
      const finish = () => {
        try {
          if (!window.FitnessSyncV165?.create) throw new Error("sync-v165.js did not register");
          core = window.FitnessSyncV165.create(App, Remote);
          resolve(core);
        } catch (error) {
          reject(error);
        }
      };
      if (window.FitnessSyncV165?.create) {
        finish();
        return;
      }
      const script = document.createElement("script");
      script.src = "js/sync/sync-v165.js";
      script.async = false;
      script.onload = finish;
      script.onerror = () => reject(new Error("页面模块加载失败：js/sync/sync-v165.js"));
      document.body.appendChild(script);
    });
    return loadPromise;
  }

  const invoke = (method, ...args) => core
    ? core[method](...args)
    : loadCore().then(module => module[method](...args));

  App.sync = {
    push: options => invoke("push", options || {}),
    pull: options => invoke("pull", options || {}),
    hasCredentials: () => invoke("hasCredentials"),
    suppressNextAutoPull: () => {
      if (core) return core.suppressNextAutoPull();
      loadCore().then(module => module.suppressNextAutoPull()).catch(() => {});
    }
  };

  App.registerModule({
    async init() {
      const module = await loadCore();
      await module.init();
    },
    async onPage(id) {
      if (core?.onPage) await core.onPage(id);
    },
    async onDataReset(reason) {
      if (core?.onDataReset) await core.onDataReset(reason);
    },
    critical: true
  });
})();
