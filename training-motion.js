(() => {
  const MOBILE_QUERY = window.matchMedia("(max-width:680px)");
  const root = document.documentElement;
  const body = document.body;
  const todayPage = document.getElementById("today");
  const overview = document.querySelector("#today .today-overview");
  const container = document.getElementById("workoutContainer");
  if (!todayPage || !overview || !container) return;

  const SNAP_TOP = 10;
  const SNAP_BOTTOM = 126;
  const OVERVIEW_TOP = 68;
  const OVERVIEW_TOLERANCE = 26;
  const SCROLL_SETTLE_DELAY = 140;

  let enabled = false;
  let mode = "overview";
  let ticking = false;
  let settleTimer = null;
  let lastY = window.scrollY;

  const cards = () => [...container.querySelectorAll(".exercise-card")];
  const todayActive = () => todayPage.classList.contains("active");

  function snapGeometry() {
    const snapTop = SNAP_TOP;
    const snapBottom = Math.max(snapTop + 160, window.innerHeight - SNAP_BOTTOM);
    const snapHeight = Math.max(180, snapBottom - snapTop);
    return {
      snapTop,
      snapBottom,
      snapHeight,
      snapCenter: snapTop + snapHeight / 2
    };
  }

  function overviewSettled() {
    if (!todayActive()) return false;
    return Math.abs(overview.getBoundingClientRect().top - OVERVIEW_TOP) <= OVERVIEW_TOLERANCE;
  }

  function setMode(nextMode) {
    if (mode === nextMode) return;
    mode = nextMode;
    root.classList.toggle("training-overview-mode", mode === "overview");
    root.classList.toggle("training-exercise-mode", mode === "exercise");
    overview.classList.toggle("is-current", mode === "overview");

    if (mode === "overview") body.classList.remove("chrome-hidden");
  }

  function classifyCards(geometry = snapGeometry()) {
    for (const card of cards()) {
      /* offsetHeight is layout height and is unaffected by the card's scale animation. */
      card.classList.toggle("snap-start", card.offsetHeight > geometry.snapHeight - 20);
    }
  }

  function clearTrainingState() {
    clearTimeout(settleTimer);
    settleTimer = null;
    root.classList.remove("training-snap-ready", "training-overview-mode", "training-exercise-mode");
    overview.classList.remove("is-current");
    for (const card of cards()) card.classList.remove("is-current", "snap-start");
  }

  function syncState() {
    enabled = MOBILE_QUERY.matches && todayActive() && !body.classList.contains("app-booting");
    root.classList.toggle("training-snap-ready", enabled);

    if (!enabled) {
      clearTrainingState();
      return;
    }

    classifyCards();
    mode = overviewSettled() ? "exercise" : "overview";
    setMode(overviewSettled() ? "overview" : "exercise");
    lastY = window.scrollY;
    scheduleUpdate();
  }

  function updateCurrentCard() {
    ticking = false;
    if (!enabled) return;

    const geometry = snapGeometry();
    classifyCards(geometry);

    if (mode === "overview") {
      for (const card of cards()) card.classList.remove("is-current");
      return;
    }

    const actions = document.querySelector("#today .sticky-actions");
    if (actions) {
      const rect = actions.getBoundingClientRect();
      if (Math.abs(rect.bottom - geometry.snapBottom) <= 54 && rect.top < geometry.snapBottom) {
        for (const card of cards()) card.classList.remove("is-current");
        return;
      }
    }

    let bestCard = null;
    let bestDistance = Infinity;

    for (const card of cards()) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom <= geometry.snapTop || rect.top >= geometry.snapBottom) continue;

      const distance = card.classList.contains("snap-start")
        ? Math.abs(rect.top - geometry.snapTop)
        : Math.abs((rect.top + rect.bottom) / 2 - geometry.snapCenter);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestCard = card;
      }
    }

    for (const card of cards()) card.classList.toggle("is-current", card === bestCard);
  }

  function scheduleUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateCurrentCard);
  }

  function settleScrollState() {
    clearTimeout(settleTimer);
    settleTimer = null;
    if (!enabled) return;

    if (overviewSettled()) setMode("overview");
    else setMode("exercise");
    scheduleUpdate();
  }

  function onScroll() {
    if (!enabled) return;

    const y = window.scrollY;
    const delta = y - lastY;
    lastY = y;

    /* Leaving the overview immediately enters the final no-header exercise layout.
       Exercise snap coordinates never depend on the header animation. */
    if (mode === "overview" && delta > 1) {
      setMode("exercise");
      body.classList.add("chrome-hidden");
    } else if (mode === "exercise" && delta < -1 && overviewSettled()) {
      setMode("overview");
    }

    scheduleUpdate();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settleScrollState, SCROLL_SETTLE_DELAY);
  }

  const contentObserver = new MutationObserver(() => {
    if (!enabled) return;
    classifyCards();
    scheduleUpdate();
  });
  contentObserver.observe(container, { childList: true, subtree: true });

  const pageObserver = new MutationObserver(syncState);
  pageObserver.observe(todayPage, { attributes: true, attributeFilter: ["class"] });

  let bootObserver = null;
  if (body.classList.contains("app-booting")) {
    bootObserver = new MutationObserver(() => {
      if (body.classList.contains("app-booting")) return;
      bootObserver.disconnect();
      syncState();
    });
    bootObserver.observe(body, { attributes: true, attributeFilter: ["class"] });
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  if ("onscrollend" in window) window.addEventListener("scrollend", settleScrollState, { passive: true });
  window.addEventListener("resize", () => {
    if (enabled) classifyCards();
    syncState();
  }, { passive: true });
  container.addEventListener("click", () => requestAnimationFrame(() => {
    if (enabled) classifyCards();
    scheduleUpdate();
  }), { passive: true });
  MOBILE_QUERY.addEventListener?.("change", syncState);

  syncState();
})();
