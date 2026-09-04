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

  const DIRECTION_THRESHOLD = 10;
  const TOP_VISIBLE_THRESHOLD = 16;
  const FALLBACK_MANUAL_RELEASE = 84;
  const RESUME_VERIFY_DELAY = 220;
  const SUPPORTS_SCROLLEND = "onscrollend" in window;

  let pointerActive = false;
  let pointerAnchorY = null;
  let manualSession = false;
  let desiredChromeHidden = body.classList.contains("chrome-hidden");
  let manualReleaseTimer = null;
  let resumeTimer = null;
  let resumeFrameA = 0;
  let resumeFrameB = 0;

  const todayActive = () => todayPage.classList.contains("active");

  function clearManualReleaseTimer() {
    clearTimeout(manualReleaseTimer);
    manualReleaseTimer = null;
  }

  function applyManualChrome() {
    if (!todayActive()) return;
    if (window.scrollY <= TOP_VISIBLE_THRESHOLD) desiredChromeHidden = false;
    body.classList.toggle("chrome-hidden", desiredChromeHidden);
  }

  function endManualSession() {
    clearManualReleaseTimer();
    applyManualChrome();
    manualSession = false;
    pointerAnchorY = null;
  }

  function armManualRelease() {
    if (SUPPORTS_SCROLLEND || !manualSession) return;
    clearManualReleaseTimer();
    manualReleaseTimer = setTimeout(endManualSession, FALLBACK_MANUAL_RELEASE);
  }

  function onPointerDown(event) {
    if (!todayActive() || document.hidden) return;
    pointerActive = true;
    pointerAnchorY = Number.isFinite(event.clientY) ? event.clientY : null;
    manualSession = false;
    clearManualReleaseTimer();
  }

  function onPointerMove(event) {
    if (!pointerActive || pointerAnchorY === null || !todayActive()) return;
    const delta = event.clientY - pointerAnchorY;
    if (Math.abs(delta) < DIRECTION_THRESHOLD) return;

    manualSession = true;
    desiredChromeHidden = delta < 0;
    pointerAnchorY = event.clientY;
    applyManualChrome();
  }

  function onPointerEnd() {
    pointerActive = false;
    if (!SUPPORTS_SCROLLEND) armManualRelease();
  }

  function onScroll() {
    if (!todayActive()) return;
    if (window.scrollY <= TOP_VISIBLE_THRESHOLD) {
      desiredChromeHidden = false;
      applyManualChrome();
    } else if (manualSession) {
      applyManualChrome();
    }
    if (!SUPPORTS_SCROLLEND && manualSession) armManualRelease();
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
  }

  function scheduleRuntimeResume() {
    if (document.hidden || !todayActive()) return;
    cancelResumeWork();
    clearManualReleaseTimer();
    pointerActive = false;
    manualSession = false;
    pointerAnchorY = null;
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
    clearManualReleaseTimer();
    pointerActive = false;
    manualSession = false;
    pointerAnchorY = null;
  }

  const bodyClassObserver = new MutationObserver(() => {
    if (manualSession) applyManualChrome();
  });
  bodyClassObserver.observe(body, { attributes: true, attributeFilter: ["class"] });

  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerup", onPointerEnd, { passive: true });
  window.addEventListener("pointercancel", onPointerEnd, { passive: true });
  window.addEventListener("scroll", onScroll, { passive: true });
  if (SUPPORTS_SCROLLEND) window.addEventListener("scrollend", endManualSession, { passive: true });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) suspendRuntime();
    else scheduleRuntimeResume();
  });
  document.addEventListener("freeze", suspendRuntime);
  document.addEventListener("resume", scheduleRuntimeResume);
  window.addEventListener("pageshow", scheduleRuntimeResume, { passive: true });
  window.addEventListener("pagehide", suspendRuntime, { passive: true });
})();
