(() => {
  const App = window.FitnessApp;
  const COOLDOWN_MS = 60000;
  let lastCheckAt = 0;
  let checking = false;

  async function hasCredentials() {
    const saved = await App.idbGet("syncCredentialsV7") || await App.idbGet("syncConfig") || {};
    return !!(saved.owner && saved.repo && saved.token);
  }

  async function checkLatest() {
    if (checking || Date.now() - lastCheckAt < COOLDOWN_MS) return;
    if (App.training?.hasDraft?.()) return;
    if (!await hasCredentials()) return;
    if (!App.sync?.pull) return;

    checking = true;
    lastCheckAt = Date.now();
    try {
      await App.sync.pull({ source: "today" });
    } finally {
      checking = false;
    }
  }

  async function init() {
    const page = window.location.hash.slice(1).split("/")[0] || "today";
    if (page === "today") setTimeout(() => checkLatest().catch(() => {}), 250);
  }

  async function onPage(id) {
    if (id === "today") checkLatest().catch(() => {});
  }

  App.registerModule({ init, onPage });
})();
