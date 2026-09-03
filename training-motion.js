(() => {
  const MOBILE_QUERY = window.matchMedia("(max-width:680px)");
  const container = document.getElementById("workoutContainer");
  if (!container) return;

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

  function headerAnchor() {
    const header = document.querySelector(".app-header");
    const bottom = header?.getBoundingClientRect().bottom || 0;
    const anchor = Math.max(10, Math.round(bottom + 10));
    document.documentElement.style.setProperty("--training-snap-top", `${anchor}px`);
    return anchor;
  }

  function updateCurrentCard() {
    ticking = false;
    const cards = [...container.querySelectorAll(".exercise-card")];
    if (!cards.length) return;

    if (!MOBILE_QUERY.matches || !todayActive()) {
      cards.forEach(card => card.classList.remove("is-current"));
      return;
    }

    const anchor = headerAnchor();
    const viewportBottom = window.innerHeight;
    let bestCard = null;

    /* Prefer the card that currently spans the snap anchor. */
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (rect.top <= anchor + 24 && rect.bottom > anchor + 72) {
        bestCard = card;
        break;
      }
    }

    /* Before the first card approaches the top area, keep every card subdued. */
    if (!bestCard) {
      let bestDistance = Infinity;
      const activationDistance = Math.min(180, Math.round(window.innerHeight * .24));
      for (const card of cards) {
        const rect = card.getBoundingClientRect();
        if (rect.bottom <= anchor || rect.top >= viewportBottom) continue;
        const distance = Math.abs(rect.top - anchor);
        if (distance <= activationDistance && distance < bestDistance) {
          bestDistance = distance;
          bestCard = card;
        }
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
