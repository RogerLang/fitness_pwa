(() => {
  const App = window.FitnessApp;
  if (!App) throw new Error("FitnessApp must load before TrainingSessionData");

  let orderedSessionsCache = null;

  function orderedSessions() {
    if (orderedSessionsCache) return orderedSessionsCache;
    orderedSessionsCache = App.state.sessions
      .map((session, index) => ({ session, index }))
      .sort((a, b) => {
        const at = String(a.session?.completedAt || a.session?.date || "");
        const bt = String(b.session?.completedAt || b.session?.date || "");
        return bt.localeCompare(at) || b.index - a.index;
      })
      .map(entry => entry.session);
    return orderedSessionsCache;
  }

  function invalidate() {
    orderedSessionsCache = null;
  }

  App.registerPersistHook((reason, keys = []) => {
    if (keys.includes("sessions")) invalidate();
  });

  window.TrainingSessionData = Object.freeze({ orderedSessions, invalidate });
})();
