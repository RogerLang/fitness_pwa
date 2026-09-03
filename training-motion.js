(() => {
  const MOBILE_QUERY = window.matchMedia("(max-width:680px)");
  const container = document.getElementById("workoutContainer");
  if (!container) return;

  const SNAP_BOTTOM = 126;
  let ticking = false;
  let userScrollIntent = false;
  let snapReady = false;
  let intentTimer = null;

  function todayActive() {
    return document.getElementById("today")?.classList.contains("active");
  }

  function setSnapReady(enabled) {
    snapReady = !!enabled && MOBILE_QUERY.matches && todayActive();
    document.documentElement.classList.toggle("training-snap-ready", snapReady);
    if (!snapReady) {
      container.querySelectorAll(".exercise-card.is-current").forEach(card => card.classList.remove("is-current"));
    }
  }

  function markUserScrollIntent() {
    if (!MOBILE_QUERY.matches || !todayActive()) return;
    userScrollIntent = true;
    clearTimeout(intentTimer);
    intentTimer = setTimeout(() => { userScrollIntent = false; }, 1400);
  }

  function overviewAtTop() {
    const overview = document.querySelector("#today .today-overview");
    if (!overview || !todayActive()) return false;
    const rect = overview.getBoundingClientRect();
    const threshold = Math.min(150, Math.max(92, window.innerHeight * .2));
    return rect.top <= threshold && rect.bottom > 64;
  }

  function headerAnchor(forceVisible = false) {
    const header = document.querySelector(".app-header");
    if (!header) return 68;

    if (forceVisible) document.body.classList.remove("chrome-hidden");

    const rect = header.getBoundingClientRect();
    const visibleAnchor = Math.max(68, Math.round(header.offsetHeight + 10));
    const anchor = forceVisible ? visibleAnchor : Math.max(10, Math.round(rect.bottom + 10));
    document.documentElement.style.setProperty("--training-snap-top", `${anchor}px`);
    return anchor;
  }

  function updateCurrentCard() {
    ticking = false;
    const cards = [...container.querySelectorAll(".exercise-card")];
    if (!cards.length) return;

    if (!MOBILE_QUERY.matches || !todayActive()) {
      cards.forEach(card => {
        card.classList.remove("is-current");
        card.classList.remove("snap-start");
      });
      return;
    }

    const atOverview = overviewAtTop();
    const snapTop = headerAnchor(atOverview);
    const snapBottom = Math.max(snapTop + 160, window.innerHeight - SNAP_BOTTOM);
    const snapHeight = Math.max(180, snapBottom - snapTop);
    const snapCenter = snapTop + snapHeight / 2;

    /* Cards that cannot fit comfortably in the center keep a top-aligned snap point. */
    for (const card of cards) {
      card.classList.toggle("snap-start", card.getBoundingClientRect().height > snapHeight - 20);
    }

    /* The overview owns the top stop, so no exercise should steal focus there. */
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

  function onScroll() {
    if (!snapReady && userScrollIntent && todayActive() && window.scrollY > 4) {
      setSnapReady(true);
    }
    scheduleUpdate();
  }

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(container, { childList: true, subtree: true });

  window.addEventListener("pointerdown", markUserScrollIntent, { passive: true });
  window.addEventListener("touchstart", markUserScrollIntent, { passive: true });
  window.addEventListener("wheel", markUserScrollIntent, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", scheduleUpdate, { passive: true });
  container.addEventListener("click", () => setTimeout(scheduleUpdate, 0), { passive: true });
  MOBILE_QUERY.addEventListener?.("change", () => {
    if (!MOBILE_QUERY.matches) setSnapReady(false);
    scheduleUpdate();
  });

  document.querySelectorAll(".bottom-nav button").forEach(button => {
    button.addEventListener("click", () => {
      setSnapReady(false);
      userScrollIntent = false;
      scheduleUpdate();
    });
  });

  setSnapReady(false);
  scheduleUpdate();
})();
