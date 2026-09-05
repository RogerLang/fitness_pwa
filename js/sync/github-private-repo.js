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
    const encodedPath = String(path || "").split("/").map(encodeURIComponent).join("/");
    return `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodedPath}`;
  }

  async function privateCheck(config, options = {}) {
    const missingMessage = options.missingMessage || "请填写 GitHub 用户名、Private 仓库和 Token。";
    const privateMessage = options.privateMessage || "安全检查拒绝：同步目标必须是 Private repository";
    if (!config?.owner || !config?.repo || !config?.token) throw new Error(missingMessage);
    const { data } = await request(`https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`, config.token);
    if (!data) throw new Error("找不到同步仓库");
    if (data.private !== true || data.visibility !== "private") throw new Error(privateMessage);
    return data;
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

  async function deleteJson(config, path, sha, message = "Delete fitness sync data") {
    if (!sha) return null;
    return request(fileUrl(config, path), config.token, {
      method: "DELETE",
      body: JSON.stringify({ message, sha })
    });
  }

  async function hexDigest(text) {
    const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(String(text)));
    return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
  }

  const jsonSig = value => hexDigest(JSON.stringify(value));
  const itemHash = id => hexDigest(id);

  window.FitnessGitHubPrivateRepo = Object.freeze({
    privateCheck,
    getJson,
    putJson,
    deleteJson,
    jsonSig,
    itemHash
  });
})();
