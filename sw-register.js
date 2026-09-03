(() => {
  if (!("serviceWorker" in navigator) || window.__fitnessSwRegisterStarted) return;
  window.__fitnessSwRegisterStarted = true;
  navigator.serviceWorker.register("./sw.js").catch(error => {
    window.__fitnessSwRegisterStarted = false;
    console.warn("service worker", error);
  });
})();
