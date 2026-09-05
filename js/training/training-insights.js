(() => {
  const noop = () => {};
  window.TrainingInsights = Object.freeze({ init: noop, refresh: noop, onPage: noop });
})();
