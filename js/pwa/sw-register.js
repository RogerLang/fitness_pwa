(() => {
  if (!("serviceWorker" in navigator) || window.__fitnessSwRegisterStarted) return;
  window.__fitnessSwRegisterStarted = true;

  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  let promptedWorker = null;

  function requestActivation(worker) {
    if (!worker || worker === promptedWorker) return;
    promptedWorker = worker;
    if (!window.confirm("练了么有新版本可用，立即更新并重新打开当前页面？")) return;
    worker.postMessage({ type: "SKIP_WAITING" });
  }

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  navigator.serviceWorker.register("./sw.js").then(registration => {
    if (registration.waiting && navigator.serviceWorker.controller) {
      requestActivation(registration.waiting);
    }

    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          requestActivation(worker);
        }
      });
    });
  }).catch(error => {
    window.__fitnessSwRegisterStarted = false;
    console.warn("service worker", error);
  });
})();
