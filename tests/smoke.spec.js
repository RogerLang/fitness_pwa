const { test, expect } = require("@playwright/test");

const APP_URL = "http://127.0.0.1:4173/#today";

async function waitForApp(page) {
  await expect(page.locator("body")).toHaveClass(/app-ready/);
}

async function activateAndFill(locator, value) {
  await locator.click();
  await expect(locator).not.toHaveAttribute("readonly", "");
  await locator.fill(value);
}

async function seed(page) {
  await page.evaluate(async () => {
    await window.FitnessApp.resetData({
      plans: [
        {
          planId: "plan-test-a",
          name: "测试｜胸",
          exercises: [
            {
              exerciseId: "exercise-test-bench",
              name: "测试卧推",
              sets: 2,
              repRange: [6, 8],
              defaultWeight: 40,
              increment: 2.5,
              weightStep: 2.5,
              note: ""
            },
            {
              exerciseId: "exercise-test-fly",
              name: "测试夹胸",
              sets: 2,
              repRange: [10, 12],
              defaultWeight: 10,
              increment: 2.5,
              weightStep: 2.5,
              note: ""
            }
          ]
        },
        {
          planId: "plan-test-b",
          name: "测试｜背",
          exercises: [
            {
              exerciseId: "exercise-test-row",
              name: "测试划船",
              sets: 2,
              repRange: [8, 12],
              defaultWeight: 20,
              increment: 2.5,
              weightStep: 2.5,
              note: ""
            }
          ]
        }
      ],
      sessions: [],
      body: []
    }, "reset");
  });
}

test("core workout lifecycle survives real browser navigation and reload", async ({ page }) => {
  await page.goto(APP_URL);
  await waitForApp(page);
  await seed(page);

  for (const target of ["plan", "history", "progress", "settings", "today"]) {
    await page.locator(`.bottom-nav button[data-page="${target}"]`).click();
    await expect(page.locator(`#${target}`)).toHaveClass(/active/);
  }

  await page.locator('.bottom-nav button[data-page="plan"]').click();
  await expect(page.locator("#planningPlanSelect")).toHaveValue("0");

  const candidateWeight = page.locator('#planningWorkoutList input[data-plan-key="weight"]').first();
  await expect(candidateWeight).toHaveValue("40");
  await activateAndFill(candidateWeight, "47.5");
  await expect(candidateWeight).toHaveValue("47.5");
  await expect.poll(() => page.evaluate(async () => {
    const stored = await window.FitnessApp.idbGet("planningCandidatesV1");
    return stored?.["plan-test-a"]?.workout?.exercises?.[0]?.sets?.[0]?.weight ?? null;
  })).toBe(47.5);

  await page.reload();
  await waitForApp(page);
  await expect(page.locator("#plan")).toHaveClass(/active/);
  await expect(page.locator('#planningWorkoutList input[data-plan-key="weight"]').first()).toHaveValue("47.5");

  await page.locator("#planningPushTopBtn").click();
  await expect.poll(() => page.evaluate(() => window.TrainingNextWorkout?.snapshot?.()?.planId || "")).toBe("plan-test-a");
  await expect.poll(() => page.evaluate(() => window.TrainingNextWorkout?.snapshot?.()?.exercises?.[0]?.sets?.[0]?.weight ?? null)).toBe(47.5);

  await page.locator("#planningPlanSelect").selectOption("1");
  await page.locator("#planningPushTopBtn").click();
  await expect.poll(() => page.evaluate(() => window.TrainingNextWorkout?.snapshot?.()?.planId || "")).toBe("plan-test-b");

  await page.locator("#planningPlanSelect").selectOption("0");
  await page.locator("#planningRegenerateBtn").click();
  await page.locator("#planningPushTopBtn").click();
  await expect.poll(() => page.evaluate(() => window.TrainingNextWorkout?.snapshot?.()?.planId || "")).toBe("plan-test-a");

  const plannedBeforeTemplateChange = await page.evaluate(() => JSON.stringify(window.TrainingNextWorkout.snapshot()));
  await page.locator("#plan .planning-template-shell > summary").click();
  const defaultWeight = page.locator('#planningTemplateList input[data-template-edit="defaultWeight"]').first();
  await activateAndFill(defaultWeight, "60");
  await defaultWeight.press("Tab");

  await expect.poll(() => page.evaluate(() => JSON.stringify(window.TrainingNextWorkout.snapshot()))).toBe(plannedBeforeTemplateChange);
  await expect(page.locator('#planningWorkoutList input[data-plan-key="weight"]').first()).toHaveValue("60");

  await page.evaluate(async () => {
    const planned = window.TrainingNextWorkout.snapshot();
    window.FitnessApp.state.sessions.push({
      id: "session-smoke-complete",
      date: "2026-09-05",
      completedAt: new Date().toISOString(),
      plan: planned.planName,
      planId: planned.planId,
      plannedWorkoutId: planned.id,
      plannedRevision: planned.revision,
      exercises: planned.exercises.map(exercise => ({
        name: exercise.name,
        exerciseId: exercise.exerciseId,
        sets: (exercise.sets || []).map(set => ({ ...set }))
      }))
    });
    await window.FitnessApp.persist("workout");
  });

  await expect.poll(() => page.evaluate(() => window.TrainingNextWorkout.snapshot())).toBeNull();
});

test("Training Draft stays attached to planId and exerciseId across reordering", async ({ page }) => {
  await page.goto(APP_URL);
  await waitForApp(page);
  await seed(page);

  await page.locator('.bottom-nav button[data-page="plan"]').click();
  await page.locator("#planningPlanSelect").selectOption("0");
  await page.locator("#planningPushTopBtn").click();
  await page.locator('.bottom-nav button[data-page="today"]').click();

  const benchWeight = page.locator('input[data-exercise-id="exercise-test-bench"][data-k="weight"]').first();
  const flyWeight = page.locator('input[data-exercise-id="exercise-test-fly"][data-k="weight"]').first();
  await activateAndFill(benchWeight, "55");
  await activateAndFill(flyWeight, "12.5");
  await page.evaluate(async () => {
    window.TrainingDraft.capture();
    await window.TrainingDraft.flush();
  });

  await expect.poll(() => page.evaluate(async () => {
    const stored = await window.FitnessApp.idbGet("workoutDraftsV9");
    return stored?.["plan-test-a"]?.sets?.["exercise-test-bench:0:weight"] || "";
  })).toBe("55");

  await page.evaluate(async () => {
    window.FitnessApp.state.plans.reverse();
    const planned = window.TrainingNextWorkout.snapshot();
    await window.TrainingNextWorkout.setFromRemote({ ...planned, exercises: [...planned.exercises].reverse() });
    await window.FitnessApp.persist("plans");
    await window.FitnessApp.refresh("identity-reorder-test");
  });

  await expect(page.locator("#todayPlanName")).toContainText("测试｜胸");
  await expect(page.locator('input[data-exercise-id="exercise-test-bench"][data-k="weight"]').first()).toHaveValue("55");
  await expect(page.locator('input[data-exercise-id="exercise-test-fly"][data-k="weight"]').first()).toHaveValue("12.5");

  await page.reload();
  await waitForApp(page);
  await expect(page.locator("#today")).toHaveClass(/active/);
  await expect(page.locator("#todayPlanName")).toContainText("测试｜胸");
  await expect(page.locator('input[data-exercise-id="exercise-test-bench"][data-k="weight"]').first()).toHaveValue("55");
  await expect(page.locator('input[data-exercise-id="exercise-test-fly"][data-k="weight"]').first()).toHaveValue("12.5");
});
