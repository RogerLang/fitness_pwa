(() => {
  const MOBILE_QUERY = window.matchMedia("(max-width:680px)");
  const REDUCED_MOTION_QUERY = window.matchMedia("(prefers-reduced-motion: reduce)");
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
  const AREA_TIE_TOLERANCE = 18;
  const SETTLE_TOLERANCE = 3;
  const SETTLE_MIN_DURATION = 96;
  const SETTLE_MAX_DURATION = 168;
  const SETTLE_DISTANCE_FOR_MAX = 220;
  const FALLBACK_SETTLE_DELAY = 120;
  const USER_SCROLL_THRESHOLD = 6;
  const SUPPORTS_SCROLLEND = "onscrollend" in window;
  const SUPPORTS_VIEW_TIMELINE = !!window.CSS?.supports?.("animation-timeline: view()");
  const INTERACTIVE_SELECTOR = "input,button,select,textarea,a,label,summary,details,[contenteditable='true'],[role='button']";

  let enabled = false;
  let runtimeListening = false;
  let settleTimer = null;
  let settleFrame = 0;
  let metricsFrame = 0;
  let gestureActive = false;
  let pointerStartY = null;
  let userScrollIntent = false;
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
  let settlingTargetY = null;

  const todayActive = () => todayPage.classList.contains("active");
  const canActivate = () =>
    MOBILE_QUERY.matches &&
    todayActive() &&
    !body.classList.contains("app-booting");

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

  function largestVisibleCard() {
    const geometry = snapGeometry();
    let best = null;

    for (const entry of targets) {
      const rect = entry.card.getBoundingClientRect();
      const visibleTop = Math.max(rect.top, geometry.snapTop);
      const visibleBottom = Math.min(rect.bottom, geometry.snapBottom);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);
      if (visibleHeight <= 0) continue;

      const centerDistance = Math.abs((rect.top + rect.bottom) / 2 - geometry.snapCenter);
      const candidate = { entry, rect, visibleHeight, centerDistance };

      if (!best || visibleHeight > best.visibleHeight + AREA_TIE_TOLERANCE) {
        best = candidate;
        continue;
      }

      if (
        Math.abs(visibleHeight - best.visibleHeight) <= AREA_TIE_TOLERANCE &&
        centerDistance < best.centerDistance
      ) {
        best = candidate;
      }
    }

    if (!best) return null;

    const isLongCard = best.entry.card.classList.contains("snap-start");
    if (isLongCard && best.rect.top < geometry.snapTop - SETTLE_TOLERANCE) {
      return { hold: true, entry: best.entry };
    }

    return { hold: false, entry: best.entry };
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

  function setMode(nextMode, { syncChrome = false } = {}) {
    if (mode !== nextMode) {
      mode = nextMode;
      root.classList.toggle("training-overview-mode", mode === "overview");
      root.classList.toggle("training-exercise-mode", mode === "exercise");
    }
    if (syncChrome) body.classList.toggle("chrome-hidden", nextMode === "exercise");
  }

  function updateModeDuringScroll() {
    if (!enabled || metricsDirty) return;
    const y = window.scrollY;
    const leavingOverview = y > overviewTargetY + OVERVIEW_TOLERANCE;
    const returningOverview = y <= overviewTargetY + OVERVIEW_TOLERANCE;

    if (mode === "overview" && leavingOverview) {
      setMode("exercise", { syncChrome: true });
      setOverviewCurrent(false);
      return;
    }

    if (mode === "exercise" && returningOverview) {
      setMode("overview", { syncChrome: true });
      setOverviewCurrent(true);
      setCurrentCard(null);
      return;
    }

    setMode(mode, { syncChrome: true });
  }

  function cancelSettle() {
    if (settleFrame) cancelAnimationFrame(settleFrame);
    settleFrame = 0;
    settlingTargetY = null;
  }

  function settleDuration(distance) {
    const ratio = Math.min(1, Math.abs(distance) / SETTLE_DISTANCE_FOR_MAX);
    return SETTLE_MIN_DURATION + (SETTLE_MAX_DURATION - SETTLE_MIN_DURATION) * ratio;
  }

  function animateSettleTo(targetY) {
    cancelSettle();

    const startY = window.scrollY;
    const distance = targetY - startY;
    if (Math.abs(distance) <= SETTLE_TOLERANCE) return;

    userScrollIntent = false;

    if (REDUCED_MOTION_QUERY.matches) {
      settlingTargetY = targetY;
      window.scrollTo({ top: targetY, behavior: "instant" });
      return;
    }

    settlingTargetY = targetY;
    const duration = settleDuration(distance);
    const startedAt = performance.now();

    const step = now => {
      if (
        !enabled ||
        document.hidden ||
        gestureActive ||
        settlingTargetY !== targetY
      ) {
        settleFrame = 0;
        return;
      }

      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = progress * progress * (3 - 2 * progress);
      window.scrollTo({
        top: startY + distance * eased,
        behavior: "instant"
      });

      if (progress < 1) {
        settleFrame = requestAnimationFrame(step);
        return;
      }

      settleFrame = 0;
      window.scrollTo({ top: targetY, behavior: "instant" });
    };

    settleFrame = requestAnimationFrame(step);
  }

  function settleScrollState({ allowAreaSettle = false } = {}) {
    clearTimeout(settleTimer);
    settleTimer = null;
    if (!enabled || document.hidden || gestureActive) return;

    refreshCards();
    rebuildMetrics();

    const y = window.scrollY;
    if (y <= overviewTargetY + OVERVIEW_TOLERANCE) {
      setMode("overview");
      setOverviewCurrent(true);
      setCurrentCard(null);
      if (allowAreaSettle && !root.classList.contains("training-form-editing")) {
        animateSettleTo(overviewTargetY);
      }
      return;
    }

    setMode("exercise");
    setOverviewCurrent(false);

    if (!SUPPORTS_VIEW_TIMELINE) {
      const nearBottom = document.documentElement.scrollHeight - (y + window.innerHeight) <= 220;
      if (nearBottom && Math.abs(y - actionsTargetY) <= TARGET_TOLERANCE) {
        setCurrentCard(null);
        return;
      }
      setCurrentCard(closestCard(y));
      return;
    }

    setCurrentCard(null);
    if (!allowAreaSettle || root.classList.contains("training-form-editing")) return;

    if (settlingTargetY !== null) {
      if (Math.abs(y - settlingTargetY) <= SETTLE_TOLERANCE) {
        settlingTargetY = null;
        return;
      }
      cancelSettle();
    }

    const winner = largestVisibleCard();
    if (!winner || winner.hold) return;
    animateSettleTo(winner.entry.targetY);
  }

  function armFallbackSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      userScrollIntent = false;
      settleScrollState({ allowAreaSettle: SUPPORTS_VIEW_TIMELINE });
    }, FALLBACK_SETTLE_DELAY);
  }

  function onScroll() {
    if (!enabled) return;
    if (userScrollIntent && settlingTargetY === null) updateModeDuringScroll();
    if (!SUPPORTS_SCROLLEND && !settleFrame) armFallbackSettle();
  }

  function onScrollEnd() {
    if (settleFrame) return;
    userScrollIntent = false;
    settleScrollState({ allowAreaSettle: SUPPORTS_VIEW_TIMELINE });
  }

  function onPointerDown(event) {
    gestureActive = true;
    pointerStartY = Number.isFinite(event.clientY) ? event.clientY : null;
    userScrollIntent = false;
    cancelSettle();
  }

  function onPointerMove(event) {
    if (!gestureActive || pointerStartY === null || userScrollIntent) return;
    if (Math.abs(event.clientY - pointerStartY) >= USER_SCROLL_THRESHOLD) userScrollIntent = true;
  }

  function onPointerEnd() {
    gestureActive = false;
    pointerStartY = null;
  }

  function onResize() {
    invalidateMetrics();
    scheduleMetricsRefresh();
  }

  function scheduleMetricsRefresh() {
    if (metricsFrame) return;
    metricsFrame = requestAnimationFrame(() => {
      metricsFrame = 0;
      if (!enabled || document.hidden) return;
      refreshCards();
      rebuildMetrics(true);
      settleScrollState();
    });
  }

  function applyTrainingClasses() {
    root.classList.add("training-snap-ready");
    root.classList.toggle("training-view-timeline", SUPPORTS_VIEW_TIMELINE);
  }

  function rebindViewTimeline() {
    if (!SUPPORTS_VIEW_TIMELINE) return;
    root.classList.remove("training-view-timeline");
    void root.offsetWidth;
    root.classList.add("training-view-timeline");
  }

  function clearTrainingState() {
    clearTimeout(settleTimer);
    settleTimer = null;
    if (metricsFrame) cancelAnimationFrame(metricsFrame);
    metricsFrame = 0;
    gestureActive = false;
    pointerStartY = null;
    userScrollIntent = false;
    cancelSettle();
    root.classList.remove(
      "training-snap-ready",
      "training-view-timeline",
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
    if (enabled && !document.hidden) scheduleMetricsRefresh();
  });

  const resizeObserver = window.ResizeObserver ? new ResizeObserver(() => {
    invalidateMetrics();
    if (enabled && !document.hidden) scheduleMetricsRefresh();
  }) : null;

  function setRuntimeListening(active) {
    if (runtimeListening === active) return;
    runtimeListening = active;

    if (active) {
      window.addEventListener("scroll", onScroll, { passive: true });
      if (SUPPORTS_SCROLLEND) {
        window.addEventListener("scrollend", onScrollEnd, { passive: true });
      }
      window.addEventListener("pointerdown", onPointerDown, { passive: true });
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      window.addEventListener("pointerup", onPointerEnd, { passive: true });
      window.addEventListener("pointercancel", onPointerEnd, { passive: true });
      window.addEventListener("resize", onResize, { passive: true });
      contentObserver.observe(container, { childList: true, subtree: true });
      resizeObserver?.observe(container);
      resizeObserver?.observe(overview);
      resizeObserver?.observe(actions);
      return;
    }

    window.removeEventListener("scroll", onScroll);
    if (SUPPORTS_SCROLLEND) window.removeEventListener("scrollend", onScrollEnd);
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerEnd);
    window.removeEventListener("pointercancel", onPointerEnd);
    window.removeEventListener("resize", onResize);
    contentObserver.disconnect();
    resizeObserver?.disconnect();
    clearTimeout(settleTimer);
    settleTimer = null;
    gestureActive = false;
    pointerStartY = null;
    userScrollIntent = false;
    cancelSettle();
  }

  function resumeTrainingMotion({ hard = false } = {}) {
    if (!enabled || document.hidden) return;
    applyTrainingClasses();
    if (hard) rebindViewTimeline();
    setRuntimeListening(true);
    refreshCards();
    rebuildMetrics(true);
    settleScrollState();
  }

  function syncState({ hardResume = false } = {}) {
    if (!canActivate()) {
      enabled = false;
      setRuntimeListening(false);
      clearTrainingState();
      return;
    }

    enabled = true;
    applyTrainingClasses();

    if (document.hidden) {
      setRuntimeListening(false);
      return;
    }

    resumeTrainingMotion({ hard: hardResume });
  }

  function onVisibilityChange() {
    if (!enabled) {
      syncState({ hardResume: !document.hidden });
      return;
    }

    if (document.hidden) {
      setRuntimeListening(false);
      return;
    }

    resumeTrainingMotion({ hard: true });
  }

  function onFormEditingEnded() {
    if (!enabled || document.hidden) return;
    resumeTrainingMotion({ hard: true });
  }

  const pageObserver = new MutationObserver(() => syncState());
  pageObserver.observe(todayPage, { attributes: true, attributeFilter: ["class"] });

  if (body.classList.contains("app-booting")) {
    const bootObserver = new MutationObserver(() => {
      if (body.classList.contains("app-booting")) return;
      bootObserver.disconnect();
      syncState({ hardResume: true });
    });
    bootObserver.observe(body, { attributes: true, attributeFilter: ["class"] });
  }

  const isInteractiveTarget = target => !!target.closest(INTERACTIVE_SELECTOR);

  container.addEventListener("click", event => {
    if (!enabled || document.hidden || isInteractiveTarget(event.target)) return;
    const card = event.target.closest(".exercise-card");
    if (!card || !container.contains(card)) return;

    rebuildMetrics();
    const target = targetByCard.get(card);
    if (!target) return;
    setMode("exercise");
    setOverviewCurrent(false);
    if (!SUPPORTS_VIEW_TIMELINE) setCurrentCard(card);
    animateSettleTo(target.targetY);
  });

  overview.addEventListener("click", event => {
    if (!enabled || document.hidden || isInteractiveTarget(event.target)) return;
    rebuildMetrics();
    setMode("overview");
    setOverviewCurrent(true);
    setCurrentCard(null);
    animateSettleTo(overviewTargetY);
  });

  document.addEventListener("visibilitychange", onVisibilityChange);
  document.addEventListener("training-form-editing-ended", onFormEditingEnded);
  window.addEventListener("pageshow", () => syncState({ hardResume: true }), { passive: true });
  window.addEventListener("pagehide", () => {
    setRuntimeListening(false);
  }, { passive: true });
  MOBILE_QUERY.addEventListener?.("change", () => syncState({ hardResume: true }));

  refreshCards();
  syncState({ hardResume: true });
})();

/* Form-editing guard: temporarily releases motion settling while Android resizes around the soft keyboard. */
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

  function notifyMotionResume() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        document.dispatchEvent(new Event("training-form-editing-ended"));
      });
    });
  }

  function finishEditing() {
    const active = focusedEditor();
    if (active) {
      beginEditing(active);
      return;
    }

    const hadEditing = root.classList.contains("training-form-editing");
    releasePending = false;
    root.classList.remove("training-form-editing");
    activeCard?.classList.remove("form-editing-card");
    activeCard = null;
    if (hadEditing) notifyMotionResume();
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
