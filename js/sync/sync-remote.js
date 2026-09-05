(() => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function bytesToBase64(bytes) {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
  }

  function base64ToBytes(value) {
    const text = atob(String(value || "").replace(/\s/g, ""));
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
  }

  function headers(token) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    };
  }

  async function request(url, token, options = {}) {
    const response = await fetch(url, { ...options, headers: { ...headers(token), ...(options.headers || {}) } });
    if (response.status === 404) return { status: 404, data: null };
    let data = null;
    try { data = await response.json(); } catch {}
    if (!response.ok) throw new Error(`GitHub API ${response.status}${data?.message ? `：${data.message}` : ""}`);
    return { status: response.status, data };
  }

  function fileUrl(config, path) {
    return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${path.split("/").map(encodeURIComponent).join("/")}`;
  }

  async function privateCheck(config) {
    if (!config.owner || !config.repo || !config.token) throw new Error("请填写 GitHub 用户名、Private 仓库和 Token。");
    const { data } = await request(`https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`, config.token);
    if (!data) throw new Error("找不到同步仓库");
    if (data.private !== true || data.visibility !== "private") throw new Error("安全检查拒绝：同步目标必须是 Private repository");
  }

  async function getJson(config, path) {
    const response = await request(fileUrl(config, path), config.token);
    if (!response.data) return null;
    return { sha: response.data.sha, data: JSON.parse(decoder.decode(base64ToBytes(response.data.content))) };
  }

  async function putJson(config, path, data, sha = null, message = "Update fitness sync data") {
    const body = { message, content: bytesToBase64(encoder.encode(JSON.stringify(data, null, 2))) };
    if (sha) body.sha = sha;
    return request(fileUrl(config, path), config.token, { method: "PUT", body: JSON.stringify(body) });
  }

  async function hexDigest(text) {
    const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(String(text)));
    return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }

  const jsonSig = value => hexDigest(JSON.stringify(value));
  const itemHash = id => hexDigest(id);
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