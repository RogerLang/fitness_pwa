(() => {
  const App = window.FitnessApp;
  if (!App) throw new Error("FitnessApp must load before planning-handoff.js");

  const REQUEST_FORMAT = "fitness-template-handoff-v1";
  const CHANGE_FORMAT = "fitness-template-change-v1";
  const MAX_OPERATIONS = 40;
  const UPDATE_FIELDS = new Set(["sets", "repRange", "defaultWeight", "weightStep", "note", "optional", "loadType", "setPresets"]);
  const LOAD_TYPES = new Set(["weight", "bodyweight", "added-weight"]);

  let bound = false;
  let pending = null;
  const clone = value => JSON.parse(JSON.stringify(value));

  function currentIndex() {
    const select = document.getElementById("planningPlanSelect");
    const index = Number(select?.value ?? 0);
    return Number.isInteger(index) && index >= 0 && index < App.state.plans.length ? index : 0;
  }

  function currentPlan() {
    return App.state.plans[currentIndex()] || null;
  }

  function projectedExercise(exercise) {
    const result = {
      exerciseId: String(exercise?.exerciseId || ""),
      name: String(exercise?.name || ""),
      warmup: !!exercise?.warmup,
      loadType: LOAD_TYPES.has(exercise?.loadType) ? exercise.loadType : "weight",
      sets: Math.max(1, Number(exercise?.sets) || 1),
      note: String(exercise?.note || ""),
      optional: !!exercise?.optional
    };

    if (result.warmup) {
      result.setPresets = Array.isArray(exercise?.setPresets)
        ? exercise.setPresets.map(set => ({
            weight: set?.weight ?? null,
            reps: set?.reps ?? set?.repsLabel ?? null
          }))
        : [];
    } else {
      result.repRange = Array.isArray(exercise?.repRange) && exercise.repRange.length >= 2
        ? [Number(exercise.repRange[0]), Number(exercise.repRange[1])]
        : [8, 12];
      result.defaultWeight = exercise?.defaultWeight ?? null;
      result.weightStep = Number(exercise?.weightStep ?? 0);
    }

    return result;
  }

  function projectedPlan(plan) {
    return {
      planId: String(plan?.planId || ""),
      name: String(plan?.name || ""),
      exercises: Array.isArray(plan?.exercises) ? plan.exercises.map(projectedExercise) : []
    };
  }

  function planSignature(plan) {
    return JSON.stringify(projectedPlan(plan));
  }

  function handoffPayload(plan) {
    return {
      format: REQUEST_FORMAT,
      appSchemaVersion: App.schema?.version ?? null,
      exportedAt: new Date().toISOString(),
      purpose: "根据用户随后描述的要求修改这个训练模板，并返回可由练了么校验后应用的变更 JSON。",
      rules: [
        "只修改用户明确要求修改的内容。",
        "planId 必须原样返回。",
        "renameExercise 仅用于名称/措辞调整并保留历史身份。",
        "replaceExercise 用于真正换动作；不要为 replacement exercise 提供 exerciseId，App 会创建新的身份以隔离历史。",
        "updateExercise 用于组数、次数区间、起始重量、重量步进、备注、可选状态、负重类型或热身预设等长期模板参数。",
        "返回纯 JSON，不要包 Markdown 代码块。"
      ],
      responseContract: {
        format: CHANGE_FORMAT,
        required: ["format", "planId", "summary", "operations"],
        allowedOperations: {
          renameExercise: { required: ["exerciseId", "name"] },
          updateExercise: { required: ["exerciseId", "changes"] },
          replaceExercise: { required: ["exerciseId", "exercise"] },
          addExercise: { required: ["exercise"], optional: ["atIndex"] },
          removeExercise: { required: ["exerciseId"] },
          moveExercise: { required: ["exerciseId", "toIndex"] }
        }
      },
      plan: projectedPlan(plan)
    };
  }

  function ensureUi() {
    const page = document.getElementById("plan");
    const manualEditor = page?.querySelector(".planning-template-shell");
    if (!page || !manualEditor) return null;

    let shell = document.getElementById("planningHandoffShell");
    if (shell) return shell;

    shell = document.createElement("details");
    shell.id = "planningHandoffShell";
    shell.className = "card planning-template-shell";
    shell.innerHTML = `
      <summary>协助修改模板</summary>
      <p class="muted">复制当前模板发给 ChatGPT，说明你想怎么改；把返回的变更 JSON 粘贴回来。应用前会先检查差异，已推送的当前训练计划不会被改写。</p>
      <div class="planning-actions-top">
        <button id="planningCopyHandoffBtn" type="button" class="secondary">复制给 ChatGPT</button>
        <button id="planningClearHandoffBtn" type="button" class="secondary">清空</button>
      </div>
      <label class="top-gap">粘贴修改结果
        <textarea id="planningHandoffInput" rows="8" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="粘贴 fitness-template-change-v1 JSON"></textarea>
      </label>
      <div class="planning-actions-top">
        <button id="planningCheckHandoffBtn" type="button" class="secondary">检查修改</button>
        <button id="planningApplyHandoffBtn" type="button" disabled>应用修改</button>
      </div>
      <p id="planningHandoffPreview" class="muted" aria-live="polite">粘贴后先检查；检查不会修改任何数据。</p>`;
    manualEditor.before(shell);
    return shell;
  }

  function previewElement() {
    return document.getElementById("planningHandoffPreview");
  }

  function inputElement() {
    return document.getElementById("planningHandoffInput");
  }

  function applyButton() {
    return document.getElementById("planningApplyHandoffBtn");
  }

  function setPreview(lines, type = "info") {
    const el = previewElement();
    if (!el) return;
    const items = Array.isArray(lines) ? lines : [lines];
    el.innerHTML = items.filter(Boolean).map(line => App.esc(line)).join("<br>");
    el.dataset.status = type;
  }

  function resetPending(message = "粘贴后先检查；检查不会修改任何数据。") {
    pending = null;
    const button = applyButton();
    if (button) button.disabled = true;
    setPreview(message);
  }

  function renderControls() {
    ensureUi();
    const hasPlan = !!currentPlan();
    for (const id of ["planningCopyHandoffBtn", "planningCheckHandoffBtn"]) {
      const button = document.getElementById(id);
      if (button) button.disabled = !hasPlan;
    }
    if (!hasPlan) resetPending("暂无训练模板。先创建或同步模板后再使用协助修改。");
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (_) {}
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("无法写入剪贴板");
  }

  async function copyCurrentTemplate() {
    const plan = currentPlan();
    if (!plan) return;
    const payload = JSON.stringify(handoffPayload(plan), null, 2);
    await copyText(payload);
    App.toast("当前模板已复制，可直接发给 ChatGPT", "success");
  }

  function stripCodeFence(text) {
    const trimmed = String(text || "").trim();
    const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1].trim() : trimmed;
  }

  function parseChange() {
    const text = stripCodeFence(inputElement()?.value || "");
    if (!text) throw new Error("请先粘贴修改结果");
    let value;
    try {
      value = JSON.parse(text);
    } catch (_) {
      throw new Error("修改结果不是有效 JSON");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("修改结果格式无效");
    return value;
  }

  function requireExercise(exercises, exerciseId) {
    const id = String(exerciseId || "").trim();
    const index = exercises.findIndex(ex => String(ex?.exerciseId || "") === id);
    if (!id || index < 0) throw new Error(`找不到动作身份：${id || "(空)"}`);
    return index;
  }

  function finiteNumber(value, label, { min = -Infinity, max = Infinity, nullable = false } = {}) {
    if (nullable && (value === undefined || value === null || value === "")) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < min || number > max) throw new Error(`${label}数值无效`);
    return number;
  }

  function sanitizeRepRange(value) {
    if (!Array.isArray(value) || value.length < 2) throw new Error("repRange 必须包含下限和上限");
    const min = Math.round(finiteNumber(value[0], "次数下限", { min: 1, max: 100 }));
    const max = Math.round(finiteNumber(value[1], "次数上限", { min: 1, max: 100 }));
    if (min > max) throw new Error("次数下限不能高于上限");
    return [min, max];
  }

  function sanitizePresets(value) {
    if (!Array.isArray(value) || value.length > 20) throw new Error("setPresets 格式无效");
    return value.map((set, index) => {
      if (!set || typeof set !== "object" || Array.isArray(set)) throw new Error(`第 ${index + 1} 个热身预设无效`);
      return {
        weight: finiteNumber(set.weight, "热身重量", { min: 0, max: 1000, nullable: true }),
        reps: finiteNumber(set.reps, "热身次数", { min: 0, max: 200, nullable: true })
      };
    });
  }

  function sanitizeUpdate(changes) {
    if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new Error("changes 必须是对象");
    const next = {};
    for (const [key, value] of Object.entries(changes)) {
      if (!UPDATE_FIELDS.has(key)) throw new Error(`不允许修改字段：${key}`);
      if (key === "sets") next.sets = Math.round(finiteNumber(value, "组数", { min: 1, max: 20 }));
      else if (key === "repRange") next.repRange = sanitizeRepRange(value);
      else if (key === "defaultWeight") next.defaultWeight = finiteNumber(value, "起始重量", { min: 0, max: 1000, nullable: true });
      else if (key === "weightStep") next.weightStep = finiteNumber(value, "重量步进", { min: 0, max: 100 });
      else if (key === "note") next.note = String(value ?? "").slice(0, 1000);
      else if (key === "optional") {
        if (typeof value !== "boolean") throw new Error("optional 必须是布尔值");
        next.optional = value;
      } else if (key === "loadType") {
        if (!LOAD_TYPES.has(value)) throw new Error("loadType 无效");
        next.loadType = value;
      } else if (key === "setPresets") next.setPresets = sanitizePresets(value);
    }
    if (!Object.keys(next).length) throw new Error("updateExercise 没有可应用的字段");
    return next;
  }

  function sanitizeNewExercise(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("新动作必须是对象");
    const name = String(value.name || "").trim();
    if (!name) throw new Error("新动作缺少名称");
    const warmup = !!value.warmup;
    const loadType = LOAD_TYPES.has(value.loadType) ? value.loadType : "weight";
    const sets = Math.round(finiteNumber(value.sets ?? 3, "组数", { min: 1, max: 20 }));
    const result = {
      name,
      warmup,
      loadType,
      sets,
      note: String(value.note ?? "").slice(0, 1000),
      optional: !!value.optional
    };

    if (warmup) {
      result.setPresets = value.setPresets === undefined ? [] : sanitizePresets(value.setPresets);
      while (result.setPresets.length < sets) result.setPresets.push({ weight: null, reps: null });
      result.setPresets = result.setPresets.slice(0, sets);
    } else {
      result.repRange = sanitizeRepRange(value.repRange ?? [8, 12]);
      result.defaultWeight = finiteNumber(value.defaultWeight, "起始重量", { min: 0, max: 1000, nullable: true });
      result.weightStep = finiteNumber(value.weightStep ?? 5, "重量步进", { min: 0, max: 100 });
    }

    return result;
  }

  function describeUpdate(exercise, changes) {
    const labels = [];
    if (changes.sets !== undefined) labels.push(`组数 ${exercise.sets ?? "?"} → ${changes.sets}`);
    if (changes.repRange) labels.push(`次数 ${exercise.repRange?.join("–") || "?"} → ${changes.repRange.join("–")}`);
    if (Object.prototype.hasOwnProperty.call(changes, "defaultWeight")) labels.push(`起始重量 ${exercise.defaultWeight ?? "空"} → ${changes.defaultWeight ?? "空"}`);
    if (changes.weightStep !== undefined) labels.push(`步进 ${exercise.weightStep ?? 0} → ${changes.weightStep}`);
    if (changes.loadType !== undefined) labels.push(`负重类型 ${exercise.loadType || "weight"} → ${changes.loadType}`);
    if (changes.optional !== undefined) labels.push(`可选 ${exercise.optional ? "是" : "否"} → ${changes.optional ? "是" : "否"}`);
    if (changes.note !== undefined) labels.push("备注更新");
    if (changes.setPresets !== undefined) labels.push("热身预设更新");
    return labels.join("；");
  }

  function simulate(change, plan, { assignIds = false } = {}) {
    if (change.format !== CHANGE_FORMAT) throw new Error(`format 必须是 ${CHANGE_FORMAT}`);
    if (String(change.planId || "") !== String(plan.planId || "")) throw new Error("planId 与当前模板不一致");
    if (!Array.isArray(change.operations) || change.operations.length < 1 || change.operations.length > MAX_OPERATIONS) {
      throw new Error(`operations 必须包含 1–${MAX_OPERATIONS} 项修改`);
    }

    const working = projectedPlan(plan);
    const messages = [];

    change.operations.forEach((operation, opIndex) => {
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) throw new Error(`第 ${opIndex + 1} 项操作无效`);
      const op = String(operation.op || "");

      if (op === "renameExercise") {
        const index = requireExercise(working.exercises, operation.exerciseId);
        const name = String(operation.name || "").trim();
        if (!name) throw new Error("renameExercise 缺少新名称");
        const oldName = working.exercises[index].name;
        working.exercises[index].name = name;
        messages.push(`改名：${oldName} → ${name}（保留历史身份）`);
        return;
      }

      if (op === "updateExercise") {
        const index = requireExercise(working.exercises, operation.exerciseId);
        const changes = sanitizeUpdate(operation.changes);
        const exercise = working.exercises[index];
        const description = describeUpdate(exercise, changes);
        Object.assign(exercise, changes);
        if (changes.sets !== undefined && exercise.warmup && Array.isArray(exercise.setPresets)) {
          while (exercise.setPresets.length < changes.sets) exercise.setPresets.push({ weight: null, reps: null });
          exercise.setPresets = exercise.setPresets.slice(0, changes.sets);
        }
        messages.push(`调整 ${exercise.name}：${description}`);
        return;
      }

      if (op === "replaceExercise") {
        const index = requireExercise(working.exercises, operation.exerciseId);
        const old = working.exercises[index];
        const replacement = sanitizeNewExercise(operation.exercise);
        replacement.exerciseId = assignIds ? crypto.randomUUID() : `new-${opIndex + 1}`;
        working.exercises[index] = replacement;
        messages.push(`替换：${old.name} → ${replacement.name}（新动作身份，历史分开）`);
        return;
      }

      if (op === "addExercise") {
        const exercise = sanitizeNewExercise(operation.exercise);
        exercise.exerciseId = assignIds ? crypto.randomUUID() : `new-${opIndex + 1}`;
        const rawIndex = operation.atIndex === undefined ? working.exercises.length : Number(operation.atIndex);
        if (!Number.isInteger(rawIndex) || rawIndex < 0 || rawIndex > working.exercises.length) throw new Error("addExercise.atIndex 无效");
        working.exercises.splice(rawIndex, 0, exercise);
        messages.push(`新增：${exercise.name}（第 ${rawIndex + 1} 个动作）`);
        return;
      }

      if (op === "removeExercise") {
        const index = requireExercise(working.exercises, operation.exerciseId);
        const [removed] = working.exercises.splice(index, 1);
        messages.push(`删除：${removed.name}`);
        return;
      }

      if (op === "moveExercise") {
        const index = requireExercise(working.exercises, operation.exerciseId);
        const toIndex = Number(operation.toIndex);
        if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= working.exercises.length) throw new Error("moveExercise.toIndex 无效");
        const [exercise] = working.exercises.splice(index, 1);
        working.exercises.splice(toIndex, 0, exercise);
        messages.push(`排序：${exercise.name} → 第 ${toIndex + 1} 个动作`);
        return;
      }

      throw new Error(`不支持的操作：${op || "(空)"}`);
    });

    if (!working.exercises.length) throw new Error("模板至少需要保留一个动作");
    return { working, messages };
  }

  function checkChange() {
    try {
      const plan = currentPlan();
      if (!plan) throw new Error("当前没有训练模板");
      const change = parseChange();
      const result = simulate(change, plan);
      pending = {
        change,
        planId: String(plan.planId || ""),
        signature: planSignature(plan)
      };
      const button = applyButton();
      if (button) button.disabled = false;
      const summary = String(change.summary || "").trim();
      setPreview([summary ? `说明：${summary}` : "检查通过", ...result.messages], "success");
    } catch (error) {
      resetPending(error?.message || "修改结果检查失败");
      App.toast(error?.message || "修改结果检查失败", "error");
    }
  }

  async function applyChange() {
    if (!pending) return;
    const index = currentIndex();
    const plan = App.state.plans[index];
    if (!plan || String(plan.planId || "") !== pending.planId || planSignature(plan) !== pending.signature) {
      resetPending("当前模板在检查后发生了变化，请重新检查修改结果。");
      App.toast("模板已变化，请重新检查", "error");
      return;
    }

    let result;
    try {
      result = simulate(pending.change, plan, { assignIds: true });
    } catch (error) {
      resetPending(error?.message || "修改结果已失效");
      App.toast(error?.message || "修改结果已失效", "error");
      return;
    }

    const accepted = confirm(`应用这 ${result.messages.length} 项模板修改？\n\n已推送的当前训练计划不会改变。`);
    if (!accepted) return;

    plan.exercises = result.working.exercises.map((exercise, exerciseIndex) =>
      App.schema.normalizeTemplateExercise(exercise, plan.planId, exerciseIndex)
    );
    await App.persist("plans");
    App.planning?.invalidate?.(index);
    App.planning?.render?.();

    const input = inputElement();
    if (input) input.value = "";
    pending = null;
    const button = applyButton();
    if (button) button.disabled = true;
    setPreview(["模板修改已应用。", ...result.messages], "success");
    App.toast("训练模板已更新", "success");
  }

  function clearHandoff() {
    const input = inputElement();
    if (input) input.value = "";
    resetPending();
  }

  function bindEvents() {
    if (bound) return;
    bound = true;
    document.getElementById("planningCopyHandoffBtn")?.addEventListener("click", () => {
      copyCurrentTemplate().catch(error => App.toast(error?.message || "复制失败", "error"));
    });
    document.getElementById("planningClearHandoffBtn")?.addEventListener("click", clearHandoff);
    document.getElementById("planningCheckHandoffBtn")?.addEventListener("click", checkChange);
    document.getElementById("planningApplyHandoffBtn")?.addEventListener("click", () => {
      applyChange().catch(error => App.toast(error?.message || "应用修改失败", "error"));
    });
    document.getElementById("planningPlanSelect")?.addEventListener("change", () => {
      resetPending("当前模板已切换；粘贴对应模板的修改结果后重新检查。");
    });
  }

  async function init() {
    ensureUi();
    bindEvents();
    renderControls();
  }

  async function refresh(reason) {
    renderControls();
    if (reason === "remote" || reason === "import" || reason === "reset" || reason === "wipe") clearHandoff();
  }

  async function onPage(id) {
    if (id !== "plan") return;
    ensureUi();
    bindEvents();
    renderControls();
  }

  async function onDataReset() {
    clearHandoff();
  }

  window.PlanningHandoff = Object.freeze({ init, refresh, onPage, onDataReset, handoffPayload });
})();
