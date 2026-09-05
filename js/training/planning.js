(() => {
  const App = window.FitnessApp;
  if (!App) throw new Error("FitnessApp must load before planning.js");

  let core = null;

  function ensureCore() {
    if (core) return core;
    const create = window.FitnessPlanningCore?.create;
    if (!create) throw new Error("planning-core.js must load before planning.js");
    core = create(App);
    App.planning = core.publicApi;
    return core;
  }

  App.registerModule({
    pages: ["plan"],
    async init() {
      await ensureCore().init();
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
