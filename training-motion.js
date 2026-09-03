(() => {
  const MOBILE_QUERY = window.matchMedia("(max-width:680px)");
  const container = document.getElementById("workoutContainer");
  if (!container) return;

  let ticking = false;

  function headerAnchor() {
    const header = document.querySelector(".app-header");
    const bottom = header?.getBoundingClientRect().bottom || 0;
    return Math.max(68, Math.round(bottom + 10));
  }

  function updateCurrentCard() {
    ticking = false;
    const cards = [...container.querySelectorAll(".exercise-card")];
    if (!cards.length) return;

    if (!MOBILE_QUERY.matches) {
      cards.forEach(card => card.classList.remove("is-current"));
      return;
    }

    const anchor = headerAnchor();
    const viewportBottom = window.innerHeight;
    let bestCard = null;
    let bestDistance = Infinity;

    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom <= anchor || rect.top >= viewportBottom) continue;
      const distance = Math.abs(rect.top - anchor);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCard = card;
      }
    }

    if (!bestCard) {
      bestCard = cards.reduce((best, card) => {
        if (!best) return card;
        const a = Math.abs(card.getBoundingClientRect().top - anchor);
        const b = Math.abs(best.getBoundingClientRect().top - anchor);
        return a < b ? card : best;
      }, null);
    }

    cards.forEach(card => card.classList.toggle("is-current", card === bestCard));
  }

  function scheduleUpdate() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(updateCurrentCard);
  }

  const observer = new MutationObserver(scheduleUpdate);
  observer.observe(container, { childList: true, subtree: true });

  window.addEventListener("scroll", scheduleUpdate, { passive: true });
  window.addEventListener("resize", scheduleUpdate, { passive: true });
  MOBILE_QUERY.addEventListener?.("change", scheduleUpdate);

  scheduleUpdate();
})();
