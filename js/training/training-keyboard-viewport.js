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

  function resetViewportBaseline() {
    keyboardOpen = false;
    requestAnimationFrame(() => {
      baselineHeight = viewport.height;
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
  window.addEventListener("orientationchange", resetViewportBaseline, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) resetViewportBaseline();
  });
  document.addEventListener("resume", resetViewportBaseline);

  window.addEventListener("pagehide", () => {
    if (resumeFrame) cancelAnimationFrame(resumeFrame);
    keyboardOpen = false;
  }, { passive: true });
})();

/* Manual chrome direction + mobile page lifecycle recovery. */
(() => {
  const root = document.documentElement;
  const body = document.body;
  const todayPage = document.getElementById("today");
  const container = document.getElementById("workoutContainer");
  if (!todayPage || !container) return;

  const DIRECTION_THRESHOLD = 6;
  const TOP_VISIBLE_THRESHOLD = 2;
  const RESUME_VERIFY_DELAY = 220;

  let pointerActive = false;
  let pointerStartY = null;
  let gestureDecided = false;
  let desiredChromeHidden = body.classList.contains("chrome-hidden");
  let resumeTimer = null;
  let resumeFrameA = 0;
  let resumeFrameB = 0;

  const todayActive = () => todayPage.classList.contains("active");

  function applyChromeState() {
    if (!todayActive()) return;
    if (window.scrollY <= TOP_VISIBLE_THRESHOLD) desiredChromeHidden = false;
    body.classList.toggle("chrome-hidden", desiredChromeHidden);
  }

  function onPointerDown(event) {
    if (!todayActive() || document.hidden) return;
    pointerActive = true;
    pointerStartY = Number.isFinite(event.clientY) ? event.clientY : null;
    gestureDecided = false;
  }

  function onPointerMove(event) {
    if (!pointerActive || pointerStartY === null || gestureDecided || !todayActive()) return;
    const delta = event.clientY - pointerStartY;
    if (Math.abs(delta) < DIRECTION_THRESHOLD) return;

    desiredChromeHidden = delta < 0;
    gestureDecided = true;
    applyChromeState();
  }

  function onPointerEnd() {
    pointerActive = false;
    pointerStartY = null;
  }

  function onScroll() {
    if (!todayActive()) return;
    applyChromeState();
  }

  function clearEditingGuard() {
    root.classList.remove("training-form-editing");
    container.querySelectorAll(".form-editing-card").forEach(card => card.classList.remove("form-editing-card"));
  }

  function cancelResumeWork() {
    clearTimeout(resumeTimer);
    resumeTimer = null;
    if (resumeFrameA) cancelAnimationFrame(resumeFrameA);
    if (resumeFrameB) cancelAnimationFrame(resumeFrameB);
    resumeFrameA = 0;
    resumeFrameB = 0;
  }

  function requestMotionRebuild() {
    if (document.hidden || !todayActive()) return;
    clearEditingGuard();
    document.dispatchEvent(new Event("training-form-editing-ended"));
    window.dispatchEvent(new Event("resize"));
    applyChromeState();
  }

  function scheduleRuntimeResume() {
    if (document.hidden || !todayActive()) return;
    cancelResumeWork();
    pointerActive = false;
    pointerStartY = null;
    gestureDecided = false;
    clearEditingGuard();

    resumeFrameA = requestAnimationFrame(() => {
      resumeFrameA = 0;
      resumeFrameB = requestAnimationFrame(() => {
        resumeFrameB = 0;
        requestMotionRebuild();
        resumeTimer = setTimeout(requestMotionRebuild, RESUME_VERIFY_DELAY);
      });
    });
  }

  function suspendRuntime() {
    cancelResumeWork();
    pointerActive = false;
    pointerStartY = null;
    gestureDecided = false;
  }

  const pageObserver = new MutationObserver(() => {
    if (todayActive()) {
      desiredChromeHidden = false;
      requestAnimationFrame(applyChromeState);
      return;
    }
    body.classList.remove("chrome-hidden");
  });
  pageObserver.observe(todayPage, { attributes: true, attributeFilter: ["class"] });

  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerup", onPointerEnd, { passive: true });
  window.addEventListener("pointercancel", onPointerEnd, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) suspendRuntime();
    else scheduleRuntimeResume();
  });
  document.addEventListener("freeze", suspendRuntime);
  document.addEventListener("resume", scheduleRuntimeResume);
  window.addEventListener("pageshow", scheduleRuntimeResume, { passive: true });
  window.addEventListener("pagehide", suspendRuntime, { passive: true });
})();

/* Numeric fields stay inert until the user activates them, reducing browser autofill prompts. */
(() => {
  const SELECTOR = [
    "#today .workout-number-input",
    "#plan #planningWorkoutList input[data-plan-key]",
    "#plan #planningTemplateList input[type='number']"
  ].join(",");
  const roots = [
    document.getElementById("workoutContainer"),
    document.getElementById("planningWorkoutList"),
    document.getElementById("planningTemplateList")
  ].filter(Boolean);
  if (!roots.length) return;

  function nextFieldName() {
    return `manual-number-${crypto.randomUUID()}`;
  }

  function prepareInput(input) {
    if (!input?.matches?.(SELECTOR)) return;
    input.setAttribute("autocomplete", "off");
    input.setAttribute("aria-autocomplete", "none");
    input.setAttribute("autocorrect", "off");
    input.setAttribute("autocapitalize", "off");
    input.setAttribute("spellcheck", "false");
    input.setAttribute("data-form-type", "other");
    input.setAttribute("data-lpignore", "true");
    input.setAttribute("data-1p-ignore", "true");
    input.setAttribute("data-bwignore", "true");
    input.setAttribute("data-protonpass-ignore", "true");
    input.name = nextFieldName();
    if (document.activeElement !== input) input.readOnly = true;
  }

  function activateInput(input) {
    if (!input?.matches?.(SELECTOR)) return;
    input.name = nextFieldName();
    input.readOnly = false;
  }

  function scan(rootNode) {
    if (!rootNode) return;
    if (rootNode.matches?.(SELECTOR)) prepareInput(rootNode);
    rootNode.querySelectorAll?.(SELECTOR).forEach(prepareInput);
  }

  roots.forEach(scan);
  const observer = new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) scan(node);
      }
    }
  });
  roots.forEach(rootNode => observer.observe(rootNode, { childList: true, subtree: true }));

  document.addEventListener("pointerdown", event => {
    const input = event.target.closest?.(SELECTOR);
    if (input) activateInput(input);
  }, true);

  document.addEventListener("focusin", event => {
    const input = event.target.matches?.(SELECTOR) ? event.target : null;
    if (input) activateInput(input);
  }, true);

  document.addEventListener("focusout", event => {
    const input = event.target.matches?.(SELECTOR) ? event.target : null;
    if (!input) return;
    setTimeout(() => prepareInput(input), 0);
  }, true);
})();
