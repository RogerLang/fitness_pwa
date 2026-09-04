(() => {
  const App = window.FitnessApp;
  if (!App) throw new Error("FitnessApp must load before app-backup.js");

  const WIPE_CONFIRM_WINDOW = 5000;
  let wipeConfirmTimer = null;
  let wipeArmedUntil = 0;

  function exportData() {
    const payload = {
      format: "fitness-pwa-backup-v3",
      exportedAt: new Date().toISOString(),
      ...App.state
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `fitness-backup-${App.isoDate()}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function importData(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.format && !String(data.format).startsWith("fitness-pwa")) throw new Error("格式不支持");
      await App.resetData({
        plans: Array.isArray(data.plans) ? data.plans : [],
        sessions: Array.isArray(data.sessions) ? data.sessions : [],
        body: Array.isArray(data.body) ? data.body : []
      }, "import");
      App.toast("备份已导入", "success");
    } catch (error) {
      App.toast(`导入失败：${error.message}`, "error");
    }
  }

  async function wipeData() {
    if (!confirm("确定删除当前设备上的训练计划、训练记录和身体数据？GitHub 同步信息会保留。")) return;
    await App.resetData({ plans: [], sessions: [], body: [] }, "wipe");
    App.toast("本机训练数据已清空", "success");
  }

  function setWipeArmed(button, armed) {
    clearTimeout(wipeConfirmTimer);
    wipeConfirmTimer = null;
    wipeArmedUntil = armed ? Date.now() + WIPE_CONFIRM_WINDOW : 0;
    button.classList.toggle("is-confirming", armed);
    const title = button.querySelector(".backup-action-title");
    if (title) title.textContent = armed ? "确认删除" : "删除";
    button.setAttribute("aria-label", armed ? "再次点击确认删除本机训练和身体数据" : "删除本机训练和身体数据");
    if (armed) {
      wipeConfirmTimer = setTimeout(() => setWipeArmed(button, false), WIPE_CONFIRM_WINDOW);
    }
  }

  async function requestWipe(button) {
    const armed = wipeArmedUntil > Date.now();
    if (!armed) {
      setWipeArmed(button, true);
      return;
    }
    setWipeArmed(button, false);
    await wipeData();
  }

  function init() {
    const exportButton = document.getElementById("exportBtn");
    const importInput = document.getElementById("importInput");
    const wipeButton = document.getElementById("wipeBtn");

    if (exportButton) exportButton.onclick = exportData;
    if (importInput) {
      importInput.onchange = event => {
        const file = event.target.files?.[0];
        if (file) importData(file);
        event.target.value = "";
      };
    }
    if (wipeButton) wipeButton.onclick = () => requestWipe(wipeButton);
  }

  App.registerModule({ init, critical: true });
})();
