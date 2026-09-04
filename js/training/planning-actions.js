(() => {
  const App = window.FitnessApp;
  const banner = document.getElementById("planningCurrentPlan");
  const button = document.getElementById("planningGoTrainTopBtn");
  if (!App || !banner || !button) return;

  function sync() {
    const active = banner.classList.contains("is-confirmed");
    button.classList.toggle("hidden", !active);
    button.disabled = !active;
  }

  button.addEventListener("click", () => {
    App.switchPage("today", { historyMode: "replace" });
  });

  new MutationObserver(sync).observe(banner, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: true
  });

  sync();
})();
