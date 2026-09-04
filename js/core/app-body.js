(() => {
  const App = window.FitnessApp;
  if (!App) throw new Error("FitnessApp must load before app-body.js");

  function numberValue(id) {
    const input = document.getElementById(id);
    if (!input || input.value === "") return null;
    const value = Number(input.value);
    return Number.isFinite(value) ? value : null;
  }

  function renderHistory() {
    const box = document.getElementById("bodyHistory");
    if (!box) return;
    const items = [...App.state.body]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 12);

    if (!items.length) {
      box.innerHTML = '<div class="empty">暂无身体数据</div>';
      return;
    }

    box.innerHTML = items.map(item => {
      const details = [
        ["体重", item.weight, "kg"],
        ["胸围", item.chest, "cm"],
        ["腰围", item.waist, "cm"],
        ["臂围", item.arm, "cm"]
      ]
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([label, value, unit]) => `${label} ${value} ${unit}`)
        .join(" · ");
      return `<div class="body-history-row"><strong>${App.esc(item.date || "")}</strong><span>${App.esc(details)}</span></div>`;
    }).join("");
  }

  async function save() {
    const item = {
      id: crypto.randomUUID(),
      date: App.isoDate(),
      weight: numberValue("bodyWeight"),
      chest: numberValue("chestCirc"),
      waist: numberValue("waistCirc"),
      arm: numberValue("armCirc")
    };

    if ([item.weight, item.chest, item.waist, item.arm].every(value => value === null)) {
      App.toast("请至少输入一项身体数据", "error");
      return;
    }

    App.state.body.push(item);
    await App.persist("body");
    ["bodyWeight", "chestCirc", "waistCirc", "armCirc"].forEach(id => {
      const input = document.getElementById(id);
      if (input) input.value = "";
    });
    renderHistory();
    App.toast("身体数据已保存", "success");
  }

  function init() {
    const button = document.getElementById("saveBodyBtn");
    if (button) button.onclick = save;
  }

  function refresh() {
    if (document.getElementById("progress")?.classList.contains("active")) renderHistory();
  }

  function onPage(id) {
    if (id === "progress") renderHistory();
  }

  App.registerModule({ init, refresh, onPage });
})();
