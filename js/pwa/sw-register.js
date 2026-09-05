(() => {
  if (!("serviceWorker" in navigator) || window.__fitnessSwRegisterStarted) return;
  window.__fitnessSwRegisterStarted = true;

  const UPDATE_CHECK_COOLDOWN = 60 * 60 * 1000;
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  let promptedWorker = null;
  let pendingWorker = null;
  let registrationRef = null;
  let lastUpdateCheckAt = 0;
  let updateBanner = null;

  function ensureUpdateStyles() {
    if (document.querySelector('link[data-fitness-pwa-update-style]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "assets/css/pwa-update.css";
    link.dataset.fitnessPwaUpdateStyle = "true";
    document.head.appendChild(link);
  }

  function ensureUpdateBanner() {
    if (updateBanner) return updateBanner;
    const banner = document.createElement("div");
    banner.className = "pwa-update-banner";
    banner.setAttribute("role", "status");
    banner.setAttribute("aria-live", "polite");
    banner.innerHTML = `
      <div class="pwa-update-copy">
        <p class="pwa-update-title">练了么有新版本</p>
        <p class="pwa-update-meta">更新前会先保存当前训练输入</p>
      </div>
      <div class="pwa-update-actions">
        <button type="button" class="secondary" data-pwa-update-later>稍后</button>
        <button type="button" data-pwa-update-now>更新</button>
      </div>
    `;
    banner.querySelector("[data-pwa-update-later]").addEventListener("click", () => {
      banner.classList.remove("show");
    });
    banner.querySelector("[data-pwa-update-now]").addEventListener("click", async () => {
      const worker = pendingWorker;
      if (!worker) return;
      const updateButton = banner.querySelector("[data-pwa-update-now]");
      const laterButton = banner.querySelector("[data-pwa-update-later]");
      updateButton.disabled = true;
      laterButton.disabled = true;
      updateButton.textContent = "保存中…";

      try {
        const training = window.FitnessApp?.training;
        training?.captureDraft?.();
        if (training?.flushDraft) await training.flushDraft();
        updateButton.textContent = "更新中…";
        worker.postMessage({ type: "SKIP_WAITING" });
      } catch (error) {
        console.warn("service worker draft flush", error);
        updateButton.disabled = false;
        laterButton.disabled = false;
        updateButton.textContent = "重试";
        window.FitnessApp?.toast?.("训练输入保存失败，已暂停更新", "error");
      }
    });
    document.body.appendChild(banner);
    updateBanner = banner;
    return banner;
  }

  function offerUpdate(worker) {
    if (!worker || worker === promptedWorker) return;
    promptedWorker = worker;
    pendingWorker = worker;
    const banner = ensureUpdateBanner();
    const updateButton = banner.querySelector("[data-pwa-update-now]");
    const laterButton = banner.querySelector("[data-pwa-update-later]");
    updateButton.disabled = false;
    laterButton.disabled = false;
    updateButton.textContent = "更新";
    banner.classList.add("show");
  }

  function checkForUpdate(registration) {
    if (!registration || document.hidden) return;
    const now = Date.now();
    if (now - lastUpdateCheckAt < UPDATE_CHECK_COOLDOWN) return;
    lastUpdateCheckAt = now;
    registration.update().catch(error => console.warn("service worker update check", error));
  }

  ensureUpdateStyles();

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || reloading) return;
    reloading = true;
    window.location.reload();
  });

  navigator.serviceWorker.register("./sw.js").then(registration => {
    registrationRef = registration;
    lastUpdateCheckAt = Date.now();

    if (registration.waiting && navigator.serviceWorker.controller) {
      offerUpdate(registration.waiting);
    }

    registration.addEventListener("updatefound", () => {
      const worker = registration.installing;
      if (!worker) return;
      worker.addEventListener("statechange", () => {
        if (worker.state === "installed" && navigator.serviceWorker.controller) {
          offerUpdate(worker);
        }
      });
    });
  }).catch(error => {
    window.__fitnessSwRegisterStarted = false;
    console.warn("service worker", error);
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) checkForUpdate(registrationRef);
  });
})();
