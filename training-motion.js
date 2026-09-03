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

  function overviewVisibleRatio() {
    const rect = overview.getBoundingClientRect();
    if (rect.height <= 0) return 0;
    const visible = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
    return Math.min(1, visible / rect.height);
  }

  function overviewDepartureDistance() {
    return Math.max(0, OVERVIEW_TOP - overview.getBoundingClientRect().top);
  }

  function actionsSettled(geometry = snapGeometry()) {
    const rect = actions.getBoundingClientRect();
    return Math.abs(rect.bottom - geometry.snapBottom) <= TARGET_TOLERANCE;
  }

  function setMode(nextMode, force = false) {
    if (!force && mode === nextMode) return;
    mode = nextMode;
    root.classList.toggle("training-overview-mode", mode === "overview");
    root.classList.toggle("training-exercise-mode", mode === "exercise");
    if (mode === "overview") body.classList.remove("chrome-hidden");
  }

  function setOverviewCurrent(active) {
    overview.classList.toggle("is-current", active);
  }

  function updateOverviewFocusLock(delta = 0) {
    if (mode === "overview" || overviewSettled()) {
      overviewFocusLocked = true;
      return;
    }

    if (!overviewFocusLocked) {
      const returningUp = delta < -1 || freeGlideDirection === "up";
      if (returningUp && overviewVisibleRatio() >= OVERVIEW_FOCUS_ACQUIRE_RATIO) {
        overviewFocusLocked = true;
      }
      return;
    }

    const leavingDown = delta > 1 || freeGlideDirection === "down";
    if (leavingDown && overviewDepartureDistance() >= OVERVIEW_FOCUS_RELEASE_DISTANCE) {
      overviewFocusLocked = false;
    }
  }

  function classifyCards(geometry = snapGeometry()) {
    for (const card of cards()) {
      /* Layout height stays constant while the visual scale animation runs. */
      card.classList.toggle("snap-start", card.offsetHeight > geometry.snapHeight - 20);
    }
  }

  function setCurrentCard(current) {
    for (const card of cards()) card.classList.toggle("is-current", card === current);
  }

  function cardDistance(card, geometry = snapGeometry()) {
    const rect = card.getBoundingClientRect();
    return card.classList.contains("snap-start")
      ? Math.abs(rect.top - geometry.snapTop)
      : Math.abs((rect.top + rect.bottom) / 2 - geometry.snapCenter);
  }

  function targetScrollForCard(card, geometry = snapGeometry()) {
    const rect = card.getBoundingClientRect();
    const delta = card.classList.contains("snap-start")
      ? rect.top - geometry.snapTop
      : (rect.top + rect.bottom) / 2 - geometry.snapCenter;
    return Math.max(0, window.scrollY + delta);
  }

  function targetScrollForOverview() {
    return Math.max(0, window.scrollY + overview.getBoundingClientRect().top - OVERVIEW_TOP);
  }

  function targetScrollForActions(geometry = snapGeometry()) {
    const rect = actions.getBoundingClientRect();
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    return Math.min(maxScroll, Math.max(0, window.scrollY + rect.bottom - geometry.snapBottom));
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
      "training-free-glide"
    );
    setOverviewCurrent(false);
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
    setMode(overviewSettled() ? "overview" : "exercise", true);
    overviewFocusLocked = mode === "overview";
    setOverviewCurrent(overviewFocusLocked);
    lastY = window.scrollY;
    scheduleUpdate();
  }

  function updateCurrentCard() {
    ticking = false;
    if (!enabled) return;

    const geometry = snapGeometry();
    classifyCards(geometry);

    if (mode === "overview") {
      overviewFocusLocked = true;
      setOverviewCurrent(true);
      setCurrentCard(null);
      return;
    }

    /* Keep the tapped card highlighted throughout its smooth movement. */
    if (programmaticTarget?.isConnected) {
      overviewFocusLocked = false;
      setOverviewCurrent(false);
      setCurrentCard(programmaticTarget);
      return;
    }

    /* Once the overview wins focus on the return path, it keeps focus until it is clearly left again. */
    if (overviewFocusLocked) {
      setOverviewCurrent(true);
      setCurrentCard(null);
      return;
    }

    /* Free glides do not flash focus through every intermediate exercise. */
    if (freeGlideDirection) return;

    setOverviewCurrent(false);

    if (actionsSettled(geometry)) {
      setCurrentCard(null);
      return;
    }

    let bestCard = null;
    let bestDistance = Infinity;

    for (const card of cards()) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom <= geometry.snapTop || rect.top >= geometry.snapBottom) continue;

      const distance = cardDistance(card, geometry);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCard = card;
      }
    }

    setCurrentCard(bestCard);
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
      /* Ignore stale/native scrollend events until the smooth glide reaches its real target. */
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
    setCurrentCard(null);

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
    const delta = y - lastY;
    lastY = y;

    /* Leaving the overview downward immediately switches to the final hidden-header layout. */
    if (!freeGlideDirection && !programmaticTarget && mode === "overview" && delta > 1) {
      setMode("exercise");
      body.classList.add("chrome-hidden");
    } else if (!freeGlideDirection && !programmaticTarget && mode === "exercise" && delta < -1 && overviewSettled()) {
      setMode("overview");
    }

    updateOverviewFocusLock(delta);
    scheduleUpdate();
    armSettle();
  }

  function onTouchStart(event) {
    if (!enabled || event.touches.length !== 1) return;

    /* A new direct gesture takes ownership from any in-progress smooth movement. */
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
  }

  function isInteractiveTarget(target) {
    return !!target.closest(
      "input,button,select,textarea,a,label,summary,details,[contenteditable='true'],[role='button']"
    );
  }

  const contentObserver = new MutationObserver(() => {
    if (!enabled) return;
    classifyCards();
    scheduleUpdate();
  });
  contentObserver.observe(container, { childList: true, subtree: true });

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

  window.addEventListener("scroll", onScroll, { passive: true });
  if ("onscrollend" in window) window.addEventListener("scrollend", settleScrollState, { passive: true });
  window.addEventListener("resize", syncState, { passive: true });
  window.addEventListener("touchstart", onTouchStart, { passive: true });
  window.addEventListener("touchmove", onTouchMove, { passive: true });
  window.addEventListener("touchend", onTouchEnd, { passive: true });
  window.addEventListener("touchcancel", () => { touchGesture = null; }, { passive: true });

  container.addEventListener("click", event => {
    if (!enabled) return;

    const card = event.target.closest(".exercise-card");
    if (!card || !container.contains(card)) return;

    if (isInteractiveTarget(event.target)) {
      requestAnimationFrame(() => {
        classifyCards();
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

  syncState();
})();
