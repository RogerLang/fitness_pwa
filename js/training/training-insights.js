(() => {
  const History = window.TrainingHistory;
  const Progress = window.TrainingProgress;
  if (!History || !Progress) throw new Error("History and Progress modules must load before TrainingInsights");

  function init() {
    History.init();
    Progress.init();
  }

  function refresh(reason) {
    History.refresh(reason);
    Progress.refresh(reason);
  }

  function onPage(id) {
    History.onPage(id);
    Progress.onPage(id);
  }

  window.TrainingInsights = Object.freeze({ init, refresh, onPage });
})();
