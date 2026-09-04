(() => {
  const root = document.documentElement;
  const container = document.getElementById("workoutContainer");
  const viewport = window.visualViewport;
  if (!container || !viewport) return;

  const EDITOR_SELECTOR = ".exercise-card input, .exercise-card textarea, .exercise-card select";
  const OPEN_DELTA = 120;
  const CLOSED_DELTA = 60;

  let baselineHeight = viewport.height;
  let keyboardOpen = false;
  let resumeFrame = 0;

  function activeEditor() {
    const active = document.activeElement;
    return active?.matches?.(EDITOR_SELECTOR) ? active : null;
  }

  function markEditing(editor) {
    const card = editor?.closest?.(".exercise-card");
    if (!card) return;
    container.querySelectorAll(".form-editing-card").forEach(item => {
      if (item !== card) item.classList.remove("form-editing-card");
    });
    card.classList.add("form-editing-card");
    root.classList.add("training-form-editing");
  }

  function resumeMotion() {
    if (resumeFrame) cancelAnimationFrame(resumeFrame);
    resumeFrame = requestAnimationFrame(() => {
      resumeFrame = requestAnimationFrame(() => {
        resumeFrame = 0;
        root.classList.remove("training-form-editing");
        container.querySelectorAll(".form-editing-card").forEach(card => card.classList.remove("form-editing-card"));
        document.dispatchEvent(new Event("training-form-editing-ended"));
      });
    });
  }

  function syncViewport() {
    const editor = activeEditor();
    const height = viewport.height;

    if (!editor) {
      keyboardOpen = false;
      baselineHeight = height;
      return;
    }

    const delta = baselineHeight - height;
    if (delta >= OPEN_DELTA) {
      keyboardOpen = true;
      markEditing(editor);
      return;
    }

    if (keyboardOpen && delta <= CLOSED_DELTA) {
      keyboardOpen = false;
      baselineHeight = Math.max(baselineHeight, height);
      resumeMotion();
    }
  }

  container.addEventListener("focusin", event => {
    if (!event.target.matches?.(EDITOR_SELECTOR)) return;
    baselineHeight = Math.max(baselineHeight, viewport.height);
  });

  container.addEventListener("focusout", () => {
    keyboardOpen = false;
    requestAnimationFrame(() => {
      if (!activeEditor()) baselineHeight = viewport.height;
    });
  });

  viewport.addEventListener("resize", syncViewport, { passive: true });
  window.addEventListener("orientationchange", () => {
    keyboardOpen = false;
    requestAnimationFrame(() => {
      if (!activeEditor()) baselineHeight = viewport.height;
    });
  }, { passive: true });

  window.addEventListener("pagehide", () => {
    if (resumeFrame) cancelAnimationFrame(resumeFrame);
  }, { passive: true });
})();
