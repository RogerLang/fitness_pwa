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

  /* Android soft-keyboard resize can continue after focusout; wait until it settles. */
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