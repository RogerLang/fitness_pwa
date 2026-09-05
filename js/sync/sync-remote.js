(() => {
  const Repo = window.FitnessGitHubPrivateRepo;
  if (!Repo) throw new Error("FitnessGitHubPrivateRepo must load before sync-remote.js");

  const { privateCheck, getJson, putJson, jsonSig, itemHash } = Repo;
  const now = () => new Date().toISOString();

  function emptyManifest() {
    return {
      format: "fitness-pwa-manifest-v3",
      updatedAt: now(),
      plans: { path: "plans.json", revision: null },
      sessions: [],
      body: []
    };
  }

  function validateManifest(manifest) {
    if (!manifest || manifest.format !== "fitness-pwa-manifest-v3") throw new Error("云端同步格式不支持。");
    manifest.plans ||= { path: "plans.json", revision: null };
    if (!Array.isArray(manifest.sessions)) manifest.sessions = [];
    if (!Array.isArray(manifest.body)) manifest.body = [];
    return manifest;
  }

  async function loadManifest(config) {
    const file = await getJson(config, "manifest.json");
    if (!file) return { manifest: emptyManifest(), sha: null, exists: false };
    return { manifest: validateManifest(file.data), sha: file.sha, exists: true };
  }

  async function saveManifest(config, manifest, sha) {
    manifest.updatedAt = now();
    await putJson(config, "manifest.json", manifest, sha, "Update fitness manifest");
  }

  async function mapByHash(items) {
    const map = new Map();
    for (const item of items) map.set(await itemHash(item.id), item);
    return map;
  }

  async function verifyOrCreateImmutable(config, kind, hash, item) {
    const path = `${kind}/${hash}.json`;
    const old = await getJson(config, path);
    const expected = kind === "sessions" ? "fitness-session-v2" : "fitness-body-entry-v2";
    if (old) {
      const remoteItem = kind === "sessions" ? old.data?.session : old.data?.entry;
      if (old.data?.format !== expected || !remoteItem?.id || await itemHash(remoteItem.id) !== hash) throw new Error(`${kind === "sessions" ? "训练" : "身体"}记录完整性检查失败`);
      return false;
    }
    const payload = kind === "sessions"
      ? { format: "fitness-session-v2", session: item }
      : { format: "fitness-body-entry-v2", entry: item };
    await putJson(config, path, payload, null, kind === "sessions" ? "Add workout session" : "Add body entry");
    return true;
  }

  async function downloadImmutable(config, kind, hash) {
    const file = await getJson(config, `${kind}/${hash}.json`);
    if (!file) throw new Error(`云端文件缺失：${hash.slice(0, 8)}…`);
    const expected = kind === "sessions" ? "fitness-session-v2" : "fitness-body-entry-v2";
    const item = kind === "sessions" ? file.data?.session : file.data?.entry;
    if (file.data?.format !== expected || !item?.id || await itemHash(item.id) !== hash) throw new Error("云端记录完整性检查失败");
    return item;
  }

  async function uploadPlans(config, plans, manifest, meta) {
    const path = "plans.json";
    const old = await getJson(config, path);
    const revision = crypto.randomUUID();
    await putJson(config, path, {
      format: "fitness-plans-v3",
      revision,
      updatedAt: now(),
      plans
    }, old?.sha || null, "Update training plans");
    manifest.plans = { path, revision };
    meta.plansBaseRevision = revision;
    meta.plansDirty = false;
    meta.plansSig = await jsonSig(plans);
  }

  async function downloadPlans(config, manifest) {
    const file = await getJson(config, manifest.plans?.path || "plans.json");
    if (!file) throw new Error("云端计划文件缺失");
    const payload = file.data;
    if (payload?.format !== "fitness-plans-v3" || payload.revision !== manifest.plans.revision || !Array.isArray(payload.plans)) throw new Error("云端训练计划完整性检查失败");
    const normalizePlan = window.FitnessApp?.schema?.normalizePlan;
    return normalizePlan ? payload.plans.map(plan => normalizePlan(plan)) : payload.plans;
  }

  window.FitnessSyncRemote = Object.freeze({
    privateCheck,
    jsonSig,
    loadManifest,
    saveManifest,
    mapByHash,
    verifyOrCreateImmutable,
    downloadImmutable,
    uploadPlans,
    downloadPlans
  });
})();
