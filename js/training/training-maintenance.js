(() => {
  const App = window.FitnessApp;

  function exerciseMap(session) {
    const map = new Map();
    for (const ex of session?.exercises || []) if (ex?.name) map.set(ex.name, ex);
    return map;
  }

  function repVector(ex) {
    return (ex?.sets || []).map(set => set?.reps === null || set?.reps === undefined ? "_" : String(set.reps)).join(",");
  }

  function sessionRichness(session) {
    let score = 0;
    for (const ex of session?.exercises || []) for (const set of ex.sets || []) {
      if (set.weight !== null && set.weight !== undefined) score += 2;
      if (set.reps !== null && set.reps !== undefined) score += 2;
      if (set.rir !== null && set.rir !== undefined) score += 1;
      if (set.completed) score += 0.25;
    }
    return score;
  }

  function duplicatePreference(a, b) {
    if (!a || !b || a.date !== b.date || a.plan !== b.plan) return 0;
    const am = exerciseMap(a), bm = exerciseMap(b);
    const common = [...am.keys()].filter(key => bm.has(key));
    const needed = Math.max(3, Math.min(am.size, bm.size) - 1);
    if (common.length < needed) return 0;
    let comparable = 0, aRepair = 0, bRepair = 0;
    for (const name of common) {
      const ae = am.get(name), be = bm.get(name);
      const ar = repVector(ae), br = repVector(be);
      if (!ar || !br || ar.replaceAll("_", "") === "" || br.replaceAll("_", "") === "") continue;
      comparable++;
      if (ar !== br) return 0;
      const count = Math.min(ae.sets?.length || 0, be.sets?.length || 0);
      for (let i = 0; i < count; i++) {
        const as = ae.sets[i] || {}, bs = be.sets[i] || {};
        if (as.reps === null || as.reps === undefined || bs.reps === null || bs.reps === undefined) continue;
        if ((as.weight === null || as.weight === undefined) && Number(bs.weight) > 0) aRepair++;
        if ((bs.weight === null || bs.weight === undefined) && Number(as.weight) > 0) bRepair++;
      }
    }
    if (comparable < 3) return 0;
    const ar = sessionRichness(a), br = sessionRichness(b);
    if (aRepair >= 2 && aRepair > bRepair && br > ar) return -1;
    if (bRepair >= 2 && bRepair > aRepair && ar > br) return 1;
    return 0;
  }

  async function cleanupDuplicates({ persistChanges = true } = {}) {
    if (!Array.isArray(App.state.sessions) || App.state.sessions.length < 2) return 0;
    const remove = new Set();
    for (let i = 0; i < App.state.sessions.length; i++) {
      if (remove.has(i)) continue;
      for (let j = i + 1; j < App.state.sessions.length; j++) {
        if (remove.has(j)) continue;
        const preference = duplicatePreference(App.state.sessions[i], App.state.sessions[j]);
        if (preference < 0) { remove.add(i); break; }
        if (preference > 0) remove.add(j);
      }
    }
    if (!remove.size) return 0;
    App.state.sessions = App.state.sessions.filter((_, index) => !remove.has(index));
    if (persistChanges) await App.persist("maintenance");
    return remove.size;
  }

  window.TrainingMaintenance = Object.freeze({ cleanupDuplicates });
})();
