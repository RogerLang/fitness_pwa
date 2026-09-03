(() => {
  const MOBILE_QUERY = window.matchMedia("(max-width:680px)");
  const container = document.getElementById("workoutContainer");
  const todayPage = document.getElementById("today");
  if (!container || !todayPage) return;

  const SNAP_TOP = 10;
  const SNAP_BOTTOM = 126;
  let ticking = false;
  let snapReady = false;

  function todayActive() {
    return todayPage.classList.contains("active");
  }

  function syncSnapState() {
    const enabled = MOBILE_QUERY.matches && todayActive() && !document.body.classList.contains("app-booting");
    snapReady = enabled;
    document.documentElement.classList.toggle("training-snap-ready", enabled);

    if (!enabled) {
      container.querySelectorAll(".exercise-card").forEach(card => {
        card.classList.remove("is-current");
        card.classList.remove("snap-start");
      });
    }
  }

  function overviewAtTop() {
    const overview = document.querySelector("#today .today-overview");
    if (!overview || !todayActive()) return false;
    const rect = overview.getBoundingClientRect();
    const threshold = Math.min(150, Math.max(92, window.innerHeight * .2));
    return rect.top <= threshold && rect.bottom > 64;
  }

  function updateCurrentCard() {
    ticking = false;
    const cards = [...container.querySelectorAll(".exercise-card")];
    if (!cards.length) return;

    if (!snapReady || !MOBILE_QUERY.matches || !todayActive()) {
      cards.forEach(card => {
        card.classList.remove("is-current");
        card.classList.remove("snap-start");
      });
      return;
    }

    const atOverview = overviewAtTop();

    /* The overview owns the top state and restores the app header. */
    if (atOverview) document.body.classList.remove("chrome-hidden");

    /* Exercise snap geometry is fixed, so header animation cannot move the target. */
    const snapTop = SNAP_TOP;
    const snapBottom = Math.max(snapTop + 160, window.innerHeight - SNAP_BOTTOM);
    const snapHeight = Math.max(180, snapBottom - snapTop);
    const snapCenter = snapTop + snapHeight / 2;

    for (const card of cards) {
      card.classList.toggle("snap-start", card.getBoundingClientRect().height > snapHeight - 20);
    }

    if (atOverview) {
      cards.forEach(card => card.classList.remove("is-current"));
      return;
    }

    const actions = document.querySelector("#today .sticky-actions");
    if (actions) {
      const rect = actions.getBoundingClientRect();
      if (Math.abs(rect.bottom - snapBottom) <= 54 && rect.top < snapBottom) {
        cards.forEach(card => card.classList.remove("is-current"));
        return;
      }
    }

    let bestCard = null;
    let bestDistance = Infinity;

    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom <= snapTop || rect.top >= snapBottom) continue;

      const distance = card.classList.contains("snap-start")
        ? Math.abs(rect.top - snapTop)
        : Math.abs((rect.top + rect.bottom) / 2 - snapCenter);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestCard = card;
      }
    }

    cards.forEach(card => card.classList.toggle("is-current", card === bestCard));
  }

  function scheduleUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateCurrentCard);
  }

  const contentObserver = new MutationObserver(scheduleUpdate);
  contentObserver.observe(container, { childList: true, subtree: true });

  const stateObserver = new MutationObserver(() => {
    syncSnapState();
    scheduleUpdate();
  });
  stateObserver.observe(todayPage, { attributes: true, attributeFilter: ["class"] });
  stateObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", () => {
    syncSnapState();
    scheduleUpdate();
  }, { passive: true });
  container.addEventListener("click", () => setTimeout(scheduleUpdate, 0), { passive: true });
  MOBILE_QUERY.addEventListener?.("change", () => {
    syncSnapState();
    scheduleUpdate();
  });

  /* Snap is already active before the first user gesture once the training page is visible. */
  syncSnapState();
  scheduleUpdate();
})();
