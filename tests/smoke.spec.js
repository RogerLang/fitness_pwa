const { test, expect } = require("@playwright/test");

const APP_URL = "http://127.0.0.1:4173/#today";

async function waitForApp(page) {
  await expect(page.locator("body")).toHaveClass(/app-ready/);
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
  await candidateWeight.fill("47.5");
  await expect(candidateWeight).toHaveValue("47.5");

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
  await defaultWeight.fill("60");
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
