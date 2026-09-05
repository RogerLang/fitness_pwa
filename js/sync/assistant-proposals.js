(() => {
  const App = window.FitnessApp;
  if (!App) return;

  let core = null;

  function ensureCore() {
    if (core) return core;
    const create = window.FitnessAssistantProposalsCore?.create;
    if (!create) throw new Error("assistant-proposals-core.js must load before assistant-proposals.js");
    core = create(App);
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
