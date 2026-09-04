(() => {
  const MOBILE_QUERY = window.matchMedia("(max-width:680px)");
  const root = document.documentElement;
  const body = document.body;
  const todayPage = document.getElementById("today");
  const overview = document.querySelector("#today .today-overview");
  const container = document.getElementById("workoutContainer");
  const actions = document.querySelector("#today .sticky-actions");
  if (!todayPage || !overview || !container || !actions) return;

  const SNAP_TOP = 10;
  const SNAP_BOTTOM = 126;
  const OVERVIEW_TOP = 68;
  const OVERVIEW_TOLERANCE = 26;
  const TARGET_TOLERANCE = 8;
  const FALLBACK_SETTLE_DELAY = 120;
  const SUPPORTS_SCROLLEND = "onscrollend" in window;
  const INTERACTIVE_SELECTOR = "input,button,select,textarea,a,label,summary,details,[contenteditable='true'],[role='button']";

  let enabled = false;
  let runtimeListening = false;
  let settleTimer = null;
  let metricsFrame = 0;
  let mode = "overview";
  let cards = [];
  let targets = [];
  let targetByCard = new WeakMap();
  let currentCard = null;
  let overviewCurrent = false;
  let metricsDirty = true;
  let lastSnapHeight = null;
  let overviewTargetY = 0;
  let actionsTargetY = 0;

  const todayActive = () => todayPage.classList.contains("active");

  function snapGeometry() {
    const snapBottom = Math.max(SNAP_TOP + 160, window.innerHeight - SNAP_BOTTOM);
    const snapHeight = Math.max(180, snapBottom - SNAP_TOP);
    return {
      snapTop: SNAP_TOP,
      snapBottom,
      snapHeight,
      snapCenter: SNAP_TOP + snapHeight / 2
    };
  }

  function elementDocumentTop(element) {
    let top = 0;
    let node = element;
    while (node) {
      top += node.offsetTop || 0;
      node = node.offsetParent;
    }
    return top;
  }

  function invalidateMetrics() {
    metricsDirty = true;
    lastSnapHeight = null;
  }

  function refreshCards() {
    const next = [...container.querySelectorAll(".exercise-card")];
    const changed =
      next.length !== cards.length ||
      next.some((card, index) => card !== cards[index]);

    if (!changed) return;
    cards = next;
    if (currentCard && !cards.includes(currentCard)) currentCard = null;
    invalidateMetrics();
  }

  function rebuildMetrics(force = false) {
    const geometry = snapGeometry();
    if (!force && !metricsDirty && lastSnapHeight === geometry.snapHeight) return;

    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const threshold = geometry.snapHeight - 20;
    const nextTargets = [];
    const nextTargetByCard = new WeakMap();

    overviewTargetY = Math.max(0, elementDocumentTop(overview) - OVERVIEW_TOP);

    for (const card of cards) {
      const height = card.offsetHeight;
      const shouldSnapStart = height > threshold;
      if (card.classList.contains("snap-start") !== shouldSnapStart) {
        card.classList.toggle("snap-start", shouldSnapStart);
      }

      const top = elementDocumentTop(card);
      const rawTargetY = shouldSnapStart
        ? top - geometry.snapTop
        : top + height / 2 - geometry.snapCenter;
      const targetY = Math.min(maxScroll, Math.max(0, rawTargetY));
      const entry = { card, targetY };
      nextTargets.push(entry);
      nextTargetByCard.set(card, entry);
    }

    const actionTop = elementDocumentTop(actions);
    actionsTargetY = Math.min(
      maxScroll,
      Math.max(0, actionTop + actions.offsetHeight - geometry.snapBottom)
    );

    targets = nextTargets;
    targetByCard = nextTargetByCard;
    metricsDirty = false;
    lastSnapHeight = geometry.snapHeight;
  }

  function closestCard(y = window.scrollY) {
    let bestCard = null;
    let bestDistance = Infinity;
    for (const entry of targets) {
      const distance = Math.abs(y - entry.targetY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCard = entry.card;
      }
    }
    return bestCard;
  }

  function setCurrentCard(nextCard) {
    if (currentCard === nextCard) return;
    if (currentCard?.isConnected) currentCard.classList.remove("is-current");
    currentCard = nextCard?.isConnected ? nextCard : null;
    currentCard?.classList.add("is-current");
  }

  function setOverviewCurrent(active) {
    if (overviewCurrent === active) return;
    overviewCurrent = active;
    overview.classList.toggle("is-current", active);
  }

  function setMode(nextMode) {
    if (mode === nextMode) return;
    mode = nextMode;
    root.classList.toggle("training-overview-mode", mode === "overview");
    root.classList.toggle("training-exercise-mode", mode === "exercise");
    body.classList.toggle("chrome-hidden", mode === "exercise");
  }

  function updateModeDuringScroll() {
    if (!enabled || metricsDirty) return;
    const y = window.scrollY;
    const leavingOverview = y > overviewTargetY + OVERVIEW_TOLERANCE;
    const returningOverview = y <= overviewTargetY + OVERVIEW_TOLERANCE;

    if (mode === "overview" && leavingOverview) {
      setMode("exercise");
      setOverviewCurrent(false);
      return;
    }

    if (mode === "exercise" && returningOverview) {
      setMode("overview");
      setOverviewCurrent(true);
      setCurrentCard(null);
    }
  }

  function settleScrollState() {
    clearTimeout(settleTimer);
    settleTimer = null;
    if (!enabled) return;

    refreshCards();
    rebuildMetrics();

    const y = window.scrollY;
    if (Math.abs(y - overviewTargetY) <= OVERVIEW_TOLERANCE) {
      setMode("overview");
      setOverviewCurrent(true);
      setCurrentCard(null);
      return;
    }

    setMode("exercise");
    setOverviewCurrent(false);

    const nearBottom = document.documentElement.scrollHeight - (y + window.innerHeight) <= 220;
    if (nearBottom && Math.abs(y - actionsTargetY) <= TARGET_TOLERANCE) {
      setCurrentCard(null);
      return;
    }

    setCurrentCard(closestCard(y));
  }

  function armFallbackSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settleScrollState, FALLBACK_SETTLE_DELAY);
  }

  function onScroll() {
    if (!enabled) return;
    updateModeDuringScroll();
    if (!SUPPORTS_SCROLLEND) armFallbackSettle();
  }

  function onResize() {
    invalidateMetrics();
    scheduleMetricsRefresh();
  }

  function scheduleMetricsRefresh() {
    if (metricsFrame) return;
    metricsFrame = requestAnimationFrame(() => {
      metricsFrame = 0;
      if (!enabled) return;
      refreshCards();
      rebuildMetrics(true);
      settleScrollState();
    });
  }

  function clearTrainingState() {
    clearTimeout(settleTimer);
    settleTimer = null;
    if (metricsFrame) cancelAnimationFrame(metricsFrame);
    metricsFrame = 0;
    root.classList.remove(
      "training-snap-ready",
      "training-overview-mode",
      "training-exercise-mode"
    );
    body.classList.remove("chrome-hidden");
    setOverviewCurrent(false);
    for (const card of cards) card.classList.remove("is-current", "snap-start");
    currentCard = null;
    overviewCurrent = false;
    invalidateMetrics();
  }

  const contentObserver = new MutationObserver(() => {
    refreshCards();
    invalidateMetrics();
    if (enabled) scheduleMetricsRefresh();
  });

  const resizeObserver = window.ResizeObserver ? new ResizeObserver(() => {
    invalidateMetrics();
    if (enabled) scheduleMetricsRefresh();
  }) : null;

  function setRuntimeListening(active) {
    if (runtimeListening === active) return;
    runtimeListening = active;

    if (active) {
      window.addEventListener("scroll", onScroll, { passive: true });
      if (SUPPORTS_SCROLLEND) {
        window.addEventListener("scrollend", settleScrollState, { passive: true });
      }
      window.addEventListener("resize", onResize, { passive: true });
      contentObserver.observe(container, { childList: true, subtree: true });
      resizeObserver?.observe(container);
      resizeObserver?.observe(overview);
      resizeObserver?.observe(actions);
      return;
    }

    window.removeEventListener("scroll", onScroll);
    if (SUPPORTS_SCROLLEND) window.removeEventListener("scrollend", settleScrollState);
    window.removeEventListener("resize", onResize);
    contentObserver.disconnect();
    resizeObserver?.disconnect();
    clearTimeout(settleTimer);
    settleTimer = null;
  }

  function syncState() {
    const shouldEnable =
      MOBILE_QUERY.matches &&
      todayActive() &&
      !body.classList.contains("app-booting") &&
      !document.hidden;

    enabled = shouldEnable;
    root.classList.toggle("training-snap-ready", enabled);
    setRuntimeListening(enabled);

    if (!enabled) {
      clearTrainingState();
      return;
    }

    refreshCards();
    rebuildMetrics(true);
    settleScrollState();
  }

  const pageObserver = new MutationObserver(syncState);
  pageObserver.observe(todayPage, { attributes: true, attributeFilter: ["class"] });

  if (body.classList.contains("app-booting")) {
    const bootObserver = new MutationObserver(() => {
      if (body.classList.contains("app-booting")) return;
      bootObserver.disconnect();
      syncState();
    });
    bootObserver.observe(body, { attributes: true, attributeFilter: ["class"] });
  }

  const isInteractiveTarget = target => !!target.closest(INTERACTIVE_SELECTOR);

  container.addEventListener("click", event => {
    if (!enabled || isInteractiveTarget(event.target)) return;
    const card = event.target.closest(".exercise-card");
    if (!card || !container.contains(card)) return;

    rebuildMetrics();
    const target = targetByCard.get(card);
    if (!target) return;
    setMode("exercise");
    setOverviewCurrent(false);
    setCurrentCard(card);
    window.scrollTo({ top: target.targetY, behavior: "smooth" });
    if (!SUPPORTS_SCROLLEND) armFallbackSettle();
  });

  overview.addEventListener("click", event => {
    if (!enabled || isInteractiveTarget(event.target)) return;
    rebuildMetrics();
    setMode("overview");
    setOverviewCurrent(true);
    setCurrentCard(null);
    window.scrollTo({ top: overviewTargetY, behavior: "smooth" });
    if (!SUPPORTS_SCROLLEND) armFallbackSettle();
  });

  document.addEventListener("visibilitychange", syncState);
  window.addEventListener("pageshow", syncState, { passive: true });
  window.addEventListener("pagehide", () => setRuntimeListening(false), { passive: true });
  MOBILE_QUERY.addEventListener?.("change", syncState);

  refreshCards();
  syncState();
})();

/* Form-editing guard: temporarily releases snap while Android resizes around the soft keyboard. */
(() => {
  const root = document.documentElement;
  const container = document.getElementById("workoutContainer");
  if (!container) return;

  const EDITOR_SELECTOR = ".exercise-card input, .exercise-card textarea, .exercise-card select";
  const RELEASE_DELAY = 280;

  let activeCard = null;
  let releaseTimer = null;
  let releasePending = false;

  function focusedEditor() {
    const active = document.activeElement;
    return active?.matches?.(EDITOR_SELECTOR) ? active : null;
  }

  function beginEditing(target) {
    const card = target?.closest?.(".exercise-card");
    if (!card) return;

    clearTimeout(releaseTimer);
    releasePending = false;

    if (activeCard && activeCard !== card) activeCard.classList.remove("form-editing-card");
    activeCard = card;
    activeCard.classList.add("form-editing-card");
    root.classList.add("training-form-editing");
  }

  function finishEditing() {
    const active = focusedEditor();
    if (active) {
      beginEditing(active);
      return;
    }

    releasePending = false;
    root.classList.remove("training-form-editing");
    activeCard?.classList.remove("form-editing-card");
    activeCard = null;
  }

  function scheduleFinish(delay = RELEASE_DELAY) {
    releasePending = true;
    clearTimeout(releaseTimer);
    releaseTimer = setTimeout(finishEditing, delay);
  }

  container.addEventListener("focusin", event => {
    if (!event.target.matches?.("input,textarea,select")) return;
    if (!event.target.closest(".exercise-card")) return;
    beginEditing(event.target);
  });

  container.addEventListener("focusout", event => {
    if (!event.target.matches?.("input,textarea,select")) return;
    if (!event.target.closest(".exercise-card")) return;
    scheduleFinish();
  });

  window.visualViewport?.addEventListener("resize", () => {
    if (!releasePending || !root.classList.contains("training-form-editing")) return;
    scheduleFinish(260);
  }, { passive: true });

  window.addEventListener("pagehide", () => {
    clearTimeout(releaseTimer);
    root.classList.remove("training-form-editing");
    activeCard?.classList.remove("form-editing-card");
  });
})();
