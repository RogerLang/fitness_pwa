(() => {
  const MOBILE_QUERY = window.matchMedia("(max-width:680px)");
  const container = document.getElementById("workoutContainer");
  const todayPage = document.getElementById("today");
  if (!container || !todayPage) return;

  const SNAP_TOP = 10;
  const SNAP_BOTTOM = 126;
  const OVERVIEW_TOP = 68;
  const OVERVIEW_TOLERANCE = 26;
  const FIRST_SETTLE_DELAY = 180;
  const CHROME_TRANSITION_DELAY = 210;

  let ticking = false;
  let snapReady = false;
  let firstTransitionActive = false;
  let firstTransitionScrolled = false;
  let firstSettleTimer = null;

  function todayActive() {
    return todayPage.classList.contains("active");
  }

  function cards() {
    return [...container.querySelectorAll(".exercise-card")];
  }

  function syncSnapState() {
    const enabled = MOBILE_QUERY.matches && todayActive() && !document.body.classList.contains("app-booting");
    snapReady = enabled;
    document.documentElement.classList.toggle("training-snap-ready", enabled);

    if (!enabled) {
      endFirstTransition(false);
      cards().forEach(card => {
        card.classList.remove("is-current");
        card.classList.remove("snap-start");
      });
    }
  }

  function overviewSettled() {
    const overview = document.querySelector("#today .today-overview");
    if (!overview || !todayActive()) return false;
    const rect = overview.getBoundingClientRect();
    return Math.abs(rect.top - OVERVIEW_TOP) <= OVERVIEW_TOLERANCE;
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

  function cardDistance(card, geometry) {
    const rect = card.getBoundingClientRect();
    return card.classList.contains("snap-start")
      ? Math.abs(rect.top - geometry.snapTop)
      : Math.abs((rect.top + rect.bottom) / 2 - geometry.snapCenter);
  }

  function updateCurrentCard() {
    ticking = false;
    const exerciseCards = cards();
    if (!exerciseCards.length) return;

    if (!snapReady || !MOBILE_QUERY.matches || !todayActive()) {
      exerciseCards.forEach(card => {
        card.classList.remove("is-current");
        card.classList.remove("snap-start");
      });
      return;
    }

    const atOverview = overviewSettled();
    const geometry = snapGeometry();

    for (const card of exerciseCards) {
      card.classList.toggle("snap-start", card.getBoundingClientRect().height > geometry.snapHeight - 20);
    }

    /* Only restore chrome once the overview has actually reached its own snap position.
       This avoids fighting the base auto-hide logic throughout the first-card transition. */
    if (atOverview) {
      document.body.classList.remove("chrome-hidden");
      exerciseCards.forEach(card => card.classList.remove("is-current"));
      return;
    }

    const actions = document.querySelector("#today .sticky-actions");
    if (actions) {
      const rect = actions.getBoundingClientRect();
      if (Math.abs(rect.bottom - geometry.snapBottom) <= 54 && rect.top < geometry.snapBottom) {
        exerciseCards.forEach(card => card.classList.remove("is-current"));
        return;
      }
    }

    let bestCard = null;
    let bestDistance = Infinity;

    for (const card of exerciseCards) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom <= geometry.snapTop || rect.top >= geometry.snapBottom) continue;
      const distance = cardDistance(card, geometry);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCard = card;
      }
    }

    exerciseCards.forEach(card => card.classList.toggle("is-current", card === bestCard));
  }

  function scheduleUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateCurrentCard);
  }

  function snapCardExactly(card) {
    if (!card || !todayActive() || !MOBILE_QUERY.matches) return;
    const geometry = snapGeometry();
    const rect = card.getBoundingClientRect();
    const delta = card.classList.contains("snap-start")
      ? rect.top - geometry.snapTop
      : (rect.top + rect.bottom) / 2 - geometry.snapCenter;

    if (Math.abs(delta) <= 3) return;
    window.scrollTo({ top: Math.max(0, window.scrollY + delta), behavior: "smooth" });
  }

  function beginFirstTransition() {
    if (!snapReady || !overviewSettled() || firstTransitionActive) return;
    firstTransitionActive = true;
    firstTransitionScrolled = false;
    document.body.classList.add("training-chrome-lock");
  }

  function endFirstTransition(correctFirstCard = true) {
    clearTimeout(firstSettleTimer);
    firstSettleTimer = null;

    if (!firstTransitionActive && !document.body.classList.contains("training-chrome-lock")) return;
    firstTransitionActive = false;
    firstTransitionScrolled = false;
    document.body.classList.remove("training-chrome-lock");

    if (!correctFirstCard || !todayActive()) return;

    const firstCard = container.querySelector(".exercise-card");
    if (!firstCard || !firstCard.classList.contains("is-current")) return;

    /* Release the visual lock only after native snapping has settled. If the base
       auto-hide has not fired yet, hide chrome now, then correct the card once the
       180ms header/nav transform has finished. */
    document.body.classList.add("chrome-hidden");
    setTimeout(() => {
      updateCurrentCard();
      if (firstCard.classList.contains("is-current")) snapCardExactly(firstCard);
    }, CHROME_TRANSITION_DELAY);
  }

  function scheduleFirstTransitionSettle() {
    if (!firstTransitionActive || !firstTransitionScrolled) return;
    clearTimeout(firstSettleTimer);
    firstSettleTimer = setTimeout(() => {
      updateCurrentCard();
      if (overviewSettled()) {
        document.body.classList.remove("chrome-hidden");
        endFirstTransition(false);
        return;
      }
      endFirstTransition(true);
    }, FIRST_SETTLE_DELAY);
  }

  function onScroll() {
    if (firstTransitionActive && !overviewSettled()) firstTransitionScrolled = true;
    scheduleUpdate();
    scheduleFirstTransitionSettle();
  }

  function onPointerUp() {
    if (firstTransitionActive && !firstTransitionScrolled) endFirstTransition(false);
  }

  const contentObserver = new MutationObserver(scheduleUpdate);
  contentObserver.observe(container, { childList: true, subtree: true });

  const stateObserver = new MutationObserver(() => {
    syncSnapState();
    scheduleUpdate();
  });
  stateObserver.observe(todayPage, { attributes: true, attributeFilter: ["class"] });
  stateObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

  window.addEventListener("pointerdown", beginFirstTransition, { passive: true });
  window.addEventListener("pointerup", onPointerUp, { passive: true });
  window.addEventListener("pointercancel", onPointerUp, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", () => {
    syncSnapState();
    scheduleUpdate();
  }, { passive: true });
  container.addEventListener("click", () => setTimeout(scheduleUpdate, 0), { passive: true });
  MOBILE_QUERY.addEventListener?.("change", () => {
    syncSnapState();
    scheduleUpdate();
  });

  syncSnapState();
  scheduleUpdate();
})();
