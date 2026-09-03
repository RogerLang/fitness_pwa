(() => {
  function initNavMotion() {
    const nav = document.querySelector(".bottom-nav");
    if (!nav || nav.querySelector(".nav-pill")) return;

    const buttons = [...nav.querySelectorAll("button[data-page]")];
    if (!buttons.length) return;

    const pill = document.createElement("span");
    pill.className = "nav-pill";
    pill.setAttribute("aria-hidden", "true");
    nav.prepend(pill);

    let lastIndex = -1;
    let liquidTimer = null;
    let resizeFrame = null;

    function activeIndex() {
      const index = buttons.findIndex(button => button.classList.contains("active"));
      return index >= 0 ? index : 0;
    }

    function setLiquidDirection(nextIndex) {
      pill.classList.remove("is-moving-left", "is-moving-right");
      clearTimeout(liquidTimer);

      if (lastIndex < 0 || nextIndex === lastIndex) return;

      /* Restart the subtle stretch animation for each actual navigation move. */
      void pill.offsetWidth;
      pill.classList.add(nextIndex > lastIndex ? "is-moving-right" : "is-moving-left");
      liquidTimer = setTimeout(() => {
        pill.classList.remove("is-moving-left", "is-moving-right");
      }, 340);
    }

    function placePill({ animate = true } = {}) {
      const nextIndex = activeIndex();
      const button = buttons[nextIndex];
      if (!button) return;

      if (animate) setLiquidDirection(nextIndex);

      pill.style.setProperty("--nav-pill-x", `${button.offsetLeft}px`);
      pill.style.setProperty("--nav-pill-y", `${button.offsetTop}px`);
      pill.style.setProperty("--nav-pill-width", `${button.offsetWidth}px`);
      pill.style.setProperty("--nav-pill-height", `${button.offsetHeight}px`);

      lastIndex = nextIndex;
    }

    placePill({ animate: false });

    requestAnimationFrame(() => {
      pill.classList.add("is-ready");
      nav.classList.add("nav-motion-ready");
    });

    const activeObserver = new MutationObserver(() => placePill());
    for (const button of buttons) {
      activeObserver.observe(button, { attributes: true, attributeFilter: ["class"] });
    }

    function scheduleResize() {
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        placePill({ animate: false });
      });
    }

    window.addEventListener("resize", scheduleResize, { passive: true });
    window.addEventListener("orientationchange", scheduleResize, { passive: true });

    if ("ResizeObserver" in window) {
      const resizeObserver = new ResizeObserver(scheduleResize);
      resizeObserver.observe(nav);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initNavMotion, { once: true });
  } else {
    initNavMotion();
  }
})();
