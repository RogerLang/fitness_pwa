const { test, expect } = require("@playwright/test");

const APP_URL = "http://127.0.0.1:4173/#plan";

async function progression(page) {
  await page.goto(APP_URL);
  await expect(page.locator("body")).toHaveClass(/app-ready/);
  return page.evaluate(() => ({
    version: window.TrainingProgression.version,
    explicitStep: window.TrainingProgression.weightStep({ name: "测试动作", weightStep: 1.25, increment: 2.5 }),
    incrementStep: window.TrainingProgression.weightStep({ name: "测试动作", increment: 2.5 }),
    zeroStep: window.TrainingProgression.weightStep({ name: "绳索侧平举", increment: 0 }),
    legacyStep: window.TrainingProgression.weightStep({ name: "测试动作" }),
    legacyDeadliftStep: window.TrainingProgression.weightStep({ name: "硬拉" })
  }));
}

function history(weight, reps, rir) {
  return {
    exercise: {
      sets: reps.map((rep, index) => ({
        weight,
        reps: rep,
        rir: index === reps.length - 1 ? rir : null
      }))
    }
  };
}

test("progression step resolves weightStep then increment and preserves zero", async ({ page }) => {
  const result = await progression(page);
  expect(result.version).toBe(3);
  expect(result.explicitStep).toBe(1.25);
  expect(result.incrementStep).toBe(2.5);
  expect(result.zeroStep).toBe(0);
  expect(result.legacyStep).toBe(5);
  expect(result.legacyDeadliftStep).toBe(6);
});

test("zero increment keeps lateral raise load at rep ceiling", async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator("body")).toHaveClass(/app-ready/);

  const result = await page.evaluate(() => {
    const ex = {
      name: "绳索侧平举",
      sets: 3,
      repRange: [12, 20],
      defaultWeight: 5,
      increment: 0
    };
    const item = rir => ({
      exercise: {
        sets: [0, 1, 2].map(index => ({ weight: 5, reps: 20, rir: index === 2 ? rir : null }))
      }
    });
    return {
      ready: window.TrainingProgression.progressionSuggestion(ex, [item(1)]),
      exhausted: window.TrainingProgression.progressionSuggestion(ex, [item(0)])
    };
  });

  expect(result.ready.status).toBe("maintain");
  expect(result.ready.statusLabel).toBe("保持重量");
  expect(result.ready.weight).toBe(5);
  expect(result.ready.weightStep).toBe(0);
  expect(result.ready.reps).toEqual([20, 20, 20]);

  expect(result.exhausted.status).toBe("confirm");
  expect(result.exhausted.weight).toBe(5);
  expect(result.exhausted.reps).toEqual([20, 20, 20]);
});

test("increment drives normal double progression by the configured load", async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator("body")).toHaveClass(/app-ready/);

  const result = await page.evaluate(() => {
    const make = (weight, max, rir = 1) => ({
      exercise: {
        sets: [
          { weight, reps: max, rir: null },
          { weight, reps: max, rir: rir }
        ]
      }
    });
    const bench = {
      name: "杠铃卧推",
      sets: 2,
      repRange: [6, 8],
      defaultWeight: 40,
      increment: 2.5
    };
    const curl = {
      name: "小臂锤式弯举",
      sets: 2,
      repRange: [8, 12],
      defaultWeight: 8,
      increment: 1
    };
    const override = {
      name: "测试动作",
      sets: 2,
      repRange: [8, 12],
      defaultWeight: 20,
      increment: 5,
      weightStep: 2.5
    };
    return {
      bench: window.TrainingProgression.progressionSuggestion(bench, [make(40, 8), make(40, 8)]),
      curl: window.TrainingProgression.progressionSuggestion(curl, [make(8, 12), make(8, 12)]),
      override: window.TrainingProgression.progressionSuggestion(override, [make(20, 12), make(20, 12)])
    };
  });

  expect(result.bench.status).toBe("increase");
  expect(result.bench.weight).toBe(42.5);
  expect(result.bench.weightStep).toBe(2.5);

  expect(result.curl.status).toBe("increase");
  expect(result.curl.weight).toBe(9);
  expect(result.curl.weightStep).toBe(1);

  expect(result.override.status).toBe("increase");
  expect(result.override.weight).toBe(22.5);
  expect(result.override.weightStep).toBe(2.5);
});

test("candidate basis records progression engine version", async ({ page }) => {
  await page.goto(APP_URL);
  await expect(page.locator("body")).toHaveClass(/app-ready/);

  const result = await page.evaluate(async () => {
    const App = window.FitnessApp;
    const plan = {
      planId: "progression-version-plan",
      name: "进阶版本测试",
      exercises: [{
        exerciseId: "progression-version-exercise",
        name: "测试动作",
        sets: 2,
        repRange: [8, 12],
        defaultWeight: 10,
        increment: 0
      }]
    };
    const store = window.TrainingCandidateWorkout.create(App, window.TrainingProgression);
    await store.reset();
    const entry = store.entryForPlan(plan, { notify: false });
    return {
      entryVersion: entry.progressionVersion,
      engineVersion: window.TrainingProgression.version
    };
  });

  expect(result.entryVersion).toBe(result.engineVersion);
  expect(result.engineVersion).toBe(3);
});
