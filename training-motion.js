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
  const FAST_RETURN_DISTANCE = 84;
  const FAST_RETURN_MAX_DURATION = 460;
  const FAST_RETURN_MIN_VELOCITY = .28;
  const FAST_RETURN_SCROLL_DISTANCE = 140;
  const TARGET_TOLERANCE = 6;

  let enabled = false;
  let mode = "overview";
  let ticking = false;
  let settleTimer = null;
  let lastY = window.scrollY;
  let programmaticTarget = null;
  let fastReturning = false;
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

  function setMode(nextMode, force = false) {
    if (!force && mode === nextMode) return;
    mode = nextMode;
    root.classList.toggle("training-overview-mode", mode === "overview");
    root.classList.toggle("training-exercise-mode", mode === "exercise");
    overview.classList.toggle("is-current", mode === "overview");

    if (mode === "overview") body.classList.remove("chrome-hidden");
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

  function clearTrainingState() {
    clearTimeout(settleTimer);
    settleTimer = null;
    programmaticTarget = null;
    fastReturning = false;
    touchGesture = null;
    root.classList.remove(
      "training-snap-ready",
      "training-overview-mode",
      "training-exercise-mode",
      "training-free-return"
    );
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
    setMode(overviewSettled() ? "overview" : "exercise", true);
    lastY = window.scrollY;
    scheduleUpdate();
  }

  function updateCurrentCard() {
    ticking = false;
    if (!enabled) return;

    const geometry = snapGeometry();
    classifyCards(geometry);

    if (mode === "overview") {
      setCurrentCard(null);
      return;
    }

    /* Keep the tapped card highlighted throughout its smooth movement. */
    if (programmaticTarget?.isConnected) {
      setCurrentCard(programmaticTarget);
      return;
    }

    /* During a fast return, avoid flashing focus through every card on the way up. */
    if (fastReturning) return;

    const actions = document.querySelector("#today .sticky-actions");
    if (actions) {
      const rect = actions.getBoundingClientRect();
      if (Math.abs(rect.bottom - geometry.snapBottom) <= 54 && rect.top < geometry.snapBottom) {
        setCurrentCard(null);
        return;
      }
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

  function finishFastReturn() {
    fastReturning = false;
    root.classList.remove("training-free-return");
    programmaticTarget = null;
    setMode(overviewSettled() ? "overview" : "exercise");
    scheduleUpdate();
  }

  function settleScrollState() {
    clearTimeout(settleTimer);
    settleTimer = null;
    if (!enabled) return;

    if (fastReturning) {
      finishFastReturn();
      return;
    }

    if (programmaticTarget?.isConnected) {
      const target = programmaticTarget;
      programmaticTarget = null;
      setMode("exercise");
      classifyCards();
      if (cardDistance(target) <= TARGET_TOLERANCE) setCurrentCard(target);
      else scheduleUpdate();
      return;
    }

    setMode(overviewSettled() ? "overview" : "exercise");
    scheduleUpdate();
  }

  function focusCard(card) {
    if (!enabled || !card?.isConnected) return;

    fastReturning = false;
    root.classList.remove("training-free-return");
    classifyCards();
    setMode("exercise");
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

  function startFastReturn() {
    if (!enabled || mode !== "exercise" || overviewSettled()) return;

    programmaticTarget = null;
    fastReturning = true;
    root.classList.add("training-free-return");
    const targetTop = targetScrollForOverview();
    window.scrollTo({ top: targetTop, behavior: "smooth" });
    armSettle();
  }

  function onScroll() {
    if (!enabled) return;

    const y = window.scrollY;
    const delta = y - lastY;
    lastY = y;

    /* As soon as the overview is left downward, use the final no-header exercise layout. */
    if (!fastReturning && !programmaticTarget && mode === "overview" && delta > 1) {
      setMode("exercise");
      body.classList.add("chrome-hidden");
    } else if (!fastReturning && !programmaticTarget && mode === "exercise" && delta < -1 && overviewSettled()) {
      setMode("overview");
    }

    scheduleUpdate();
    armSettle();
  }

  function onTouchStart(event) {
    if (!enabled || event.touches.length !== 1) return;

    /* A new direct gesture takes ownership from an in-progress fast return. */
    if (fastReturning) {
      fastReturning = false;
      root.classList.remove("training-free-return");
    }

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
    if (!enabled || programmaticTarget || mode !== "exercise" || overviewSettled()) return;

    const touch = event.changedTouches?.[0];
    const endY = touch?.clientY ?? gesture.lastY;
    const duration = Math.max(1, performance.now() - gesture.startTime);
    const fingerDistance = endY - gesture.startY;
    const velocity = fingerDistance / duration;
    const scrollUpDistance = gesture.startScrollY - window.scrollY;

    const isFastReturn =
      fingerDistance >= FAST_RETURN_DISTANCE &&
      duration <= FAST_RETURN_MAX_DURATION &&
      (velocity >= FAST_RETURN_MIN_VELOCITY || scrollUpDistance >= FAST_RETURN_SCROLL_DISTANCE);

    if (isFastReturn) startFastReturn();
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

  MOBILE_QUERY.addEventListener?.("change", syncState);

  syncState();
})();
