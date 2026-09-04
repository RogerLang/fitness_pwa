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
  const OVERVIEW_FOCUS_ACQUIRE_RATIO = .34;
  const OVERVIEW_FOCUS_RELEASE_DISTANCE = 28;
  const SCROLL_SETTLE_DELAY = 140;
  const FAST_GLIDE_DISTANCE = 150;
  const FAST_GLIDE_MAX_DURATION = 380;
  const FAST_GLIDE_MIN_VELOCITY = .5;
  const FAST_GLIDE_SCROLL_DISTANCE = 220;
  const TARGET_TOLERANCE = 6;

  let enabled = false;
  let mode = "overview";
  let ticking = false;
  let settleTimer = null;
  let lastY = window.scrollY;
  let overviewFocusLocked = true;
  let programmaticTarget = null;
  let freeGlideDirection = null;
  let touchGesture = null;

  let cardCache = [];
  let cardTargets = [];
  let targetByCard = new WeakMap();
  let cardMetricsDirty = true;
  let currentCard = null;
  let overviewCurrent = false;
  let lastClassifiedSnapHeight = null;
  let runtimeListening = false;
  let pendingScrollDelta = 0;
  let overviewDocumentTop = 0;
  let overviewHeight = 0;
  let actionsTargetY = 0;

  const todayActive = () => todayPage.classList.contains("active");

  function getCards() {
    return cardCache;
  }

  function invalidateCardMetrics() {
    cardMetricsDirty = true;
    lastClassifiedSnapHeight = null;
    cardTargets = [];
    targetByCard = new WeakMap();
  }

  function refreshCardCache() {
    const nextCards = [...container.querySelectorAll(".exercise-card")];
    if (
      nextCards.length === cardCache.length &&
      nextCards.every((card, index) => card === cardCache[index])
    ) {
      return false;
    }

    if (currentCard && !nextCards.includes(currentCard)) currentCard = null;
    if (programmaticTarget && !nextCards.includes(programmaticTarget)) programmaticTarget = null;

    cardCache = nextCards;
    invalidateCardMetrics();
    return true;
  }

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

  function elementDocumentTop(element) {
    let top = 0;
    let node = element;
    while (node) {
      top += node.offsetTop || 0;
      node = node.offsetParent;
    }
    return top;
  }

  function overviewRectSnapshot() {
    const top = overviewDocumentTop - window.scrollY;
    return { top, bottom: top + overviewHeight, height: overviewHeight };
  }

  function overviewSettled(rect = overviewRectSnapshot()) {
    if (!todayActive()) return false;
    return Math.abs(rect.top - OVERVIEW_TOP) <= OVERVIEW_TOLERANCE;
  }

  function overviewVisibleRatio(rect = overviewRectSnapshot()) {
    if (rect.height <= 0) return 0;
    const visible = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    return Math.min(1, visible / rect.height);
  }

  function overviewDepartureDistance(rect = overviewRectSnapshot()) {
    return Math.max(0, OVERVIEW_TOP - rect.top);
  }

  function actionsSettled() {
    return Math.abs(window.scrollY - actionsTargetY) <= TARGET_TOLERANCE;
  }

  function nearPageBottom(buffer = 220) {
    const remaining = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
    return remaining <= buffer;
  }

  function setMode(nextMode, force = false) {
    if (!force && mode === nextMode) return;
    mode = nextMode;
    root.classList.toggle("training-overview-mode", mode === "overview");
    root.classList.toggle("training-exercise-mode", mode === "exercise");
    if (mode === "overview") body.classList.remove("chrome-hidden");
  }

  function setOverviewCurrent(active) {
    if (overviewCurrent === active) return;
    overviewCurrent = active;
    overview.classList.toggle("is-current", active);
  }

  function updateOverviewFocusLock(delta = 0, rect = overviewRectSnapshot()) {
    if (mode === "overview" || overviewSettled(rect)) {
      overviewFocusLocked = true;
      return;
    }

    if (!overviewFocusLocked) {
      const returningUp = delta < -1 || freeGlideDirection === "up";
      if (returningUp && overviewVisibleRatio(rect) >= OVERVIEW_FOCUS_ACQUIRE_RATIO) {
        overviewFocusLocked = true;
      }
      return;
    }

    const leavingDown = delta > 1 || freeGlideDirection === "down";
    if (leavingDown && overviewDepartureDistance(rect) >= OVERVIEW_FOCUS_RELEASE_DISTANCE) {
      overviewFocusLocked = false;
    }
  }

  function classifyCards(geometry = snapGeometry(), force = false) {
    refreshCardCache();
    if (!force && !cardMetricsDirty && lastClassifiedSnapHeight === geometry.snapHeight) return;

    const threshold = geometry.snapHeight - 20;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const nextTargets = [];
    const nextTargetByCard = new WeakMap();

    overviewDocumentTop = elementDocumentTop(overview);
    overviewHeight = overview.offsetHeight;

    for (const card of getCards()) {
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

    cardTargets = nextTargets;
    targetByCard = nextTargetByCard;
    cardMetricsDirty = false;
    lastClassifiedSnapHeight = geometry.snapHeight;
  }

  function setCurrentCard(nextCard) {
    if (currentCard === nextCard) return;
    if (currentCard?.isConnected) currentCard.classList.remove("is-current");
    currentCard = nextCard?.isConnected ? nextCard : null;
    if (currentCard) currentCard.classList.add("is-current");
  }

  function clearCurrentCardState() {
    setCurrentCard(null);
  }

  function cardDistance(card) {
    const target = targetByCard.get(card);
    if (!target) return Infinity;
    return Math.abs(window.scrollY - target.targetY);
  }

  function targetScrollForCard(card, geometry = snapGeometry()) {
    classifyCards(geometry);
    const target = targetByCard.get(card);
    if (target) return target.targetY;
    return Math.max(0, window.scrollY);
  }

  function targetScrollForOverview(geometry = snapGeometry()) {
    classifyCards(geometry);
    return Math.max(0, overviewDocumentTop - OVERVIEW_TOP);
  }

  function targetScrollForActions(geometry = snapGeometry()) {
    classifyCards(geometry);
    return actionsTargetY;
  }

  function closestCardToScroll() {
    let bestCard = null;
    let bestDistance = Infinity;
    const y = window.scrollY;

    for (const entry of cardTargets) {
      const distance = Math.abs(y - entry.targetY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCard = entry.card;
      }
    }

    return bestCard;
  }

  function clearTrainingState() {
    clearTimeout(settleTimer);
    settleTimer = null;
    programmaticTarget = null;
    freeGlideDirection = null;
    touchGesture = null;
    overviewFocusLocked = false;
    root.classList.remove(
      "training-snap-ready",
      "training-overview-mode",
      "training-exercise-mode",
      "training-free-glide",
      "training-scrolling"
    );
    setOverviewCurrent(false);
    for (const card of getCards()) card.classList.remove("is-current", "snap-start");
    currentCard = null;
    overviewCurrent = false;
    pendingScrollDelta = 0;
    invalidateCardMetrics();
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

    refreshCardCache();
    const geometry = snapGeometry();
    classifyCards(geometry, true);
    setMode(overviewSettled() ? "overview" : "exercise", true);
    overviewFocusLocked = mode === "overview";
    setOverviewCurrent(overviewFocusLocked);
    lastY = window.scrollY;
    pendingScrollDelta = 0;
    scheduleUpdate();
  }

  function updateCurrentCard() {
    ticking = false;
    if (!enabled) return;

    const geometry = snapGeometry();
    classifyCards(geometry);

    const scrollDelta = pendingScrollDelta;
    pendingScrollDelta = 0;
    const overviewRect = overviewRectSnapshot();

    if (!freeGlideDirection && !programmaticTarget && mode === "overview" && scrollDelta > 1) {
      setMode("exercise");
      body.classList.add("chrome-hidden");
    } else if (
      !freeGlideDirection &&
      !programmaticTarget &&
      mode === "exercise" &&
      scrollDelta < -1 &&
      overviewSettled(overviewRect)
    ) {
      setMode("overview");
    }

    updateOverviewFocusLock(scrollDelta, overviewRect);

    if (mode === "overview") {
      overviewFocusLocked = true;
      setOverviewCurrent(true);
      clearCurrentCardState();
      return;
    }

    if (programmaticTarget?.isConnected) {
      overviewFocusLocked = false;
      setOverviewCurrent(false);
      setCurrentCard(programmaticTarget);
      return;
    }

    if (overviewFocusLocked) {
      setOverviewCurrent(true);
      clearCurrentCardState();
      return;
    }

    if (freeGlideDirection) return;

    setOverviewCurrent(false);

    if (nearPageBottom() && actionsSettled()) {
      clearCurrentCardState();
      return;
    }

    setCurrentCard(closestCardToScroll());
  }

  function scheduleUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateCurrentCard);
  }

  function armSettle() {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settleScrollState, SCROLL_SETTLE_DELAY);
  }

  function freeGlideSettled() {
    if (freeGlideDirection === "up") return overviewSettled();
    if (freeGlideDirection === "down") return actionsSettled();
    return true;
  }

  function finishFreeGlide() {
    freeGlideDirection = null;
    root.classList.remove("training-free-glide");
    programmaticTarget = null;
    setMode(overviewSettled() ? "overview" : "exercise");
    overviewFocusLocked = mode === "overview";
    setOverviewCurrent(overviewFocusLocked);
    scheduleUpdate();
  }

  function settleScrollState() {
    clearTimeout(settleTimer);
    settleTimer = null;
    if (!enabled) return;

    if (freeGlideDirection) {
      if (!freeGlideSettled()) {
        armSettle();
        return;
      }
      finishFreeGlide();
      return;
    }

    if (programmaticTarget?.isConnected) {
      const target = programmaticTarget;
      const distance = cardDistance(target);
      if (distance > TARGET_TOLERANCE) {
        armSettle();
        return;
      }
      programmaticTarget = null;
      setMode("exercise");
      overviewFocusLocked = false;
      setOverviewCurrent(false);
      classifyCards();
      setCurrentCard(target);
      return;
    }

    setMode(overviewSettled() ? "overview" : "exercise");
    if (mode === "overview") overviewFocusLocked = true;
    else if (overviewDepartureDistance() >= OVERVIEW_FOCUS_RELEASE_DISTANCE) overviewFocusLocked = false;
    setOverviewCurrent(overviewFocusLocked);
    scheduleUpdate();
  }

  function focusCard(card) {
    if (!enabled || !card?.isConnected) return;

    freeGlideDirection = null;
    root.classList.remove("training-free-glide");
    classifyCards();
    setMode("exercise");
    overviewFocusLocked = false;
    setOverviewCurrent(false);
    body.classList.add("chrome-hidden");
    programmaticTarget = card;
    setCurrentCard(card);

    const targetTop = targetScrollForCard(card);
    if (Math.abs(targetTop - window.scrollY) <= TARGET_TOLERANCE) {
      programmaticTarget = null;
      scheduleUpdate();
      return;
    }

    window.scrollTo({ top: targetTop, behavior: "smooth" });
    armSettle();
  }

  function startFreeGlide(direction) {
    if (!enabled) return;
    if (direction === "up" && (mode !== "exercise" || overviewSettled())) return;
    if (direction === "down" && actionsSettled()) return;

    programmaticTarget = null;
    freeGlideDirection = direction;
    root.classList.add("training-free-glide");

    if (direction === "down") {
      setMode("exercise");
      overviewFocusLocked = false;
      setOverviewCurrent(false);
      body.classList.add("chrome-hidden");
    }

    const targetTop = direction === "up" ? targetScrollForOverview() : targetScrollForActions();
    window.scrollTo({ top: targetTop, behavior: "smooth" });
    armSettle();
  }

  function focusOverview() {
    if (!enabled) return;

    programmaticTarget = null;
    freeGlideDirection = "up";
    root.classList.add("training-free-glide");
    overviewFocusLocked = true;
    setOverviewCurrent(true);
    clearCurrentCardState();

    const targetTop = targetScrollForOverview();
    if (Math.abs(targetTop - window.scrollY) <= TARGET_TOLERANCE) {
      finishFreeGlide();
      return;
    }

    window.scrollTo({ top: targetTop, behavior: "smooth" });
    armSettle();
  }

  function onScroll() {
    if (!enabled) return;

    const y = window.scrollY;
    pendingScrollDelta += y - lastY;
    lastY = y;
    scheduleUpdate();
    armSettle();
  }

  function onTouchStart(event) {
    if (!enabled || event.touches.length !== 1) return;

    if (freeGlideDirection) {
      freeGlideDirection = null;
      root.classList.remove("training-free-glide");
      setMode(overviewSettled() ? "overview" : "exercise");
      if (mode === "overview") overviewFocusLocked = true;
      else if (overviewDepartureDistance() >= OVERVIEW_FOCUS_RELEASE_DISTANCE) overviewFocusLocked = false;
    }
    programmaticTarget = null;

    const touch = event.touches[0];
    touchGesture = {
      startY: touch.clientY,
      lastY: touch.clientY,
      startTime: performance.now(),
      startScrollY: window.scrollY
    };
  }

  function onTouchMove(event) {
    if (!touchGesture || event.touches.length !== 1) return;
    touchGesture.lastY = event.touches[0].clientY;
  }

  function onTouchEnd(event) {
    if (!touchGesture) return;

    const gesture = touchGesture;
    touchGesture = null;
    if (!enabled || programmaticTarget) return;

    const touch = event.changedTouches?.[0];
    const endY = touch?.clientY ?? gesture.lastY;
    const duration = Math.max(1, performance.now() - gesture.startTime);
    const fingerDistance = endY - gesture.startY;
    const velocity = fingerDistance / duration;
    const scrollDelta = window.scrollY - gesture.startScrollY;

    const fastUpReturn =
      mode === "exercise" &&
      !overviewSettled() &&
      fingerDistance >= FAST_GLIDE_DISTANCE &&
      duration <= FAST_GLIDE_MAX_DURATION &&
      (velocity >= FAST_GLIDE_MIN_VELOCITY || -scrollDelta >= FAST_GLIDE_SCROLL_DISTANCE);

    const fastDownAdvance =
      !actionsSettled() &&
      fingerDistance <= -FAST_GLIDE_DISTANCE &&
      duration <= FAST_GLIDE_MAX_DURATION &&
      (-velocity >= FAST_GLIDE_MIN_VELOCITY || scrollDelta >= FAST_GLIDE_SCROLL_DISTANCE);

    if (fastUpReturn) startFreeGlide("up");
    else if (fastDownAdvance) startFreeGlide("down");
    else armSettle();
  }

  function isInteractiveTarget(target) {
    return !!target.closest(
      "input,button,select,textarea,a,label,summary,details,[contenteditable='true'],[role='button']"
    );
  }

  const contentObserver = new MutationObserver(() => {
    refreshCardCache();
    if (!enabled) return;
    invalidateCardMetrics();
    scheduleUpdate();
  });

  const pageObserver = new MutationObserver(syncState);
  pageObserver.observe(todayPage, { attributes: true, attributeFilter: ["class"] });

  const resizeObserver = window.ResizeObserver ? new ResizeObserver(() => {
    invalidateCardMetrics();
    if (enabled) scheduleUpdate();
  }) : null;

  function onResize() {
    invalidateCardMetrics();
    syncState();
  }

  function onTouchCancel() {
    touchGesture = null;
    armSettle();
  }

  function setRuntimeListening(active) {
    if (runtimeListening === active) return;
    runtimeListening = active;

    if (active) {
      window.addEventListener("scroll", onScroll, { passive: true });
      if ("onscrollend" in window) window.addEventListener("scrollend", settleScrollState, { passive: true });
      window.addEventListener("resize", onResize, { passive: true });
      window.addEventListener("touchstart", onTouchStart, { passive: true });
      window.addEventListener("touchmove", onTouchMove, { passive: true });
      window.addEventListener("touchend", onTouchEnd, { passive: true });
      window.addEventListener("touchcancel", onTouchCancel, { passive: true });
      contentObserver.observe(container, { childList: true, subtree: true });
      resizeObserver?.observe(container);
      resizeObserver?.observe(actions);
      resizeObserver?.observe(overview);
      return;
    }

    window.removeEventListener("scroll", onScroll);
    if ("onscrollend" in window) window.removeEventListener("scrollend", settleScrollState);
    window.removeEventListener("resize", onResize);
    window.removeEventListener("touchstart", onTouchStart);
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("touchend", onTouchEnd);
    window.removeEventListener("touchcancel", onTouchCancel);
    contentObserver.disconnect();
    resizeObserver?.disconnect();
    clearTimeout(settleTimer);
    settleTimer = null;
  }

  if (body.classList.contains("app-booting")) {
    const bootObserver = new MutationObserver(() => {
      if (body.classList.contains("app-booting")) return;
      bootObserver.disconnect();
      syncState();
    });
    bootObserver.observe(body, { attributes: true, attributeFilter: ["class"] });
  }

  document.addEventListener("visibilitychange", syncState);
  window.addEventListener("pageshow", syncState, { passive: true });
  window.addEventListener("pagehide", () => setRuntimeListening(false), { passive: true });

  container.addEventListener("click", event => {
    if (!enabled) return;

    const card = event.target.closest(".exercise-card");
    if (!card || !container.contains(card)) return;

    if (isInteractiveTarget(event.target)) {
      requestAnimationFrame(() => {
        invalidateCardMetrics();
        scheduleUpdate();
      });
      return;
    }

    focusCard(card);
  });

  overview.addEventListener("click", event => {
    if (!enabled || isInteractiveTarget(event.target)) return;
    focusOverview();
  });

  MOBILE_QUERY.addEventListener?.("change", syncState);

  refreshCardCache();
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
