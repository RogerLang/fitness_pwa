(() => {
  const App = window.FitnessApp;
  const Remote = window.FitnessSyncRemote;
  if (!App || !Remote) throw new Error("Sync dependencies must load before sync.js");

  let core = null;

  function ensureCore() {
    if (core) return core;
    const create = window.FitnessSyncCore?.create;
    if (!create) throw new Error("sync-core.js must load before sync.js");
    core = create(App, Remote);
    return core;
  }

  const invoke = (method, ...args) => ensureCore()[method](...args);

  App.sync = {
    push: options => invoke("push", options || {}),
    pull: options => invoke("pull", options || {}),
    hasCredentials: () => invoke("hasCredentials"),
    suppressNextAutoPull: () => ensureCore().suppressNextAutoPull()
  };

  App.registerModule({
    async init() {
      await ensureCore().init();
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
