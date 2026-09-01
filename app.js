
const DB_NAME = "fitness-pwa-db";
const DB_VERSION = 1;
const STORE = "kv";
let db;
let state = {
  plans: [],
  sessions: [],
  body: []
};
let deferredPrompt = null;

function openDB(){
  return new Promise((resolve,reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if(!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbGet(key){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readonly");
    const req=tx.objectStore(STORE).get(key);
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
}
function idbSet(key,val){
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(STORE,"readwrite");
    tx.objectStore(STORE).put(val,key);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}
async function loadState(){
  state.plans = await idbGet("plans") || [];
  state.sessions = await idbGet("sessions") || [];
  state.body = await idbGet("body") || [];
}
async function persist(){
  await Promise.all([
    idbSet("plans", state.plans),
    idbSet("sessions", state.sessions),
    idbSet("body", state.body)
  ]);
}

function fmtDate(d=new Date()){
  return d.toLocaleDateString("zh-CN",{year:"numeric",month:"2-digit",day:"2-digit"});
}
function isoDate(d=new Date()){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function esc(s=""){
  return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}

function renderPlanSelect(){
  const sel=document.getElementById("planSelect");
  sel.innerHTML="";
  if(!state.plans.length){
    sel.innerHTML='<option>请先导入计划</option>';
    sel.disabled=true;
    return;
  }
  sel.disabled=false;
  state.plans.forEach((p,i)=>{
    const o=document.createElement("option");
    o.value=i; o.textContent=p.name; sel.appendChild(o);
  });
}

function renderWorkout(){
  const c=document.getElementById("workoutContainer");
  if(!state.plans.length){
    c.innerHTML='<div class="card empty">在“设置”中导入你的训练计划 JSON。</div>';
    return;
  }
  const idx=Number(document.getElementById("planSelect").value||0);
  const plan=state.plans[idx];
  c.innerHTML="";
  plan.exercises.forEach((ex,ei)=>{
    const div=document.createElement("div");
    div.className="card";
    const target = ex.repRange ? `${ex.repRange[0]}–${ex.repRange[1]} 次` : "";
    div.innerHTML=`
      <div class="exercise-head">
        <div>
          <div class="exercise-title">${esc(ex.name)}</div>
          <div class="exercise-meta">${esc(ex.note||"")} ${target ? "· "+target : ""}</div>
        </div>
        ${ex.optional?'<span class="badge">可选</span>':""}
      </div>
      <div class="set-row"><span></span><label>重量<input disabled value="kg"></label><label>次数<input disabled value="reps"></label><label>RIR<input disabled value="RIR"></label></div>
    `;
    for(let s=0;s<ex.sets;s++){
      const row=document.createElement("div");
      row.className="set-row";
      row.innerHTML=`
        <span>${s+1}</span>
        <input type="number" step="0.5" inputmode="decimal" data-e="${ei}" data-s="${s}" data-k="weight" placeholder="${ex.defaultWeight ?? ""}">
        <input type="number" step="1" inputmode="numeric" data-e="${ei}" data-s="${s}" data-k="reps" placeholder="">
        <input type="number" step="1" min="0" max="5" inputmode="numeric" data-e="${ei}" data-s="${s}" data-k="rir" placeholder="1–2">
      `;
      div.appendChild(row);
    }
    const sug=document.createElement("div");
    sug.className="suggestion";
    sug.id=`sug-${ei}`;
    sug.textContent=progressionSuggestion(ex);
    div.appendChild(sug);
    c.appendChild(div);
  });
}

function progressionSuggestion(ex){
  if(!ex.repRange) return "按动作计划完成即可。";
  const history = state.sessions
    .flatMap(s => (s.exercises||[]).map(e=>({...e,date:s.date})))
    .filter(e => e.name === ex.name)
    .sort((a,b)=>b.date.localeCompare(a.date));
  if(!history.length) return `首次记录：选择能在 ${ex.repRange[0]}–${ex.repRange[1]} 次范围内、约 RIR 1–2 的重量。`;
  const last=history[0];
  const valid=(last.sets||[]).filter(x=>x.reps>0);
  if(!valid.length) return "上次没有有效记录。";
  const allTop = valid.length >= ex.sets && valid.every(x=>x.reps>=ex.repRange[1]);
  const w = valid[0].weight;
  if(allTop && w){
    const inc = ex.increment || 2.5;
    return `上次已达到次数上限；下次可尝试 ${Number(w)+inc} kg，并回到 ${ex.repRange[0]} 次附近。`;
  }
  const reps=valid.map(x=>x.reps).join("/");
  return `上次：${w||"-"} kg，${reps} 次。下次继续同重量，争取增加总次数。`;
}

async function saveWorkout(){
  if(!state.plans.length) return;
  const idx=Number(document.getElementById("planSelect").value||0);
  const plan=state.plans[idx];
  const inputs=[...document.querySelectorAll("#workoutContainer input[data-e]")];
  const map={};
  inputs.forEach(i=>{
    const e=Number(i.dataset.e), s=Number(i.dataset.s), k=i.dataset.k;
    map[e] ??= {};
    map[e][s] ??= {};
    map[e][s][k] = i.value==="" ? null : Number(i.value);
  });
  const exercises=plan.exercises.map((ex,ei)=>({
    name:ex.name,
    sets:Object.values(map[ei]||{}).filter(x=>x.weight!==null || x.reps!==null || x.rir!==null)
  })).filter(ex=>ex.sets.length);
  if(!exercises.length){ alert("还没有输入训练数据。"); return; }
  state.sessions.push({id:crypto.randomUUID(),date:isoDate(),plan:plan.name,exercises});
  await persist();
  renderHistory(); renderProgressOptions(); renderWorkout();
  alert("已保存。");
}
function resetWorkout(){
  document.querySelectorAll("#workoutContainer input[data-e]").forEach(i=>i.value="");
}

function renderHistory(){
  const box=document.getElementById("historyList");
  const arr=[...state.sessions].sort((a,b)=>b.date.localeCompare(a.date));
  if(!arr.length){box.innerHTML='<div class="empty">暂无训练记录</div>';return;}
  box.innerHTML=arr.map(s=>`
    <div class="history-item">
      <div class="history-date">${esc(s.date)} <span class="badge">${esc(s.plan)}</span></div>
      ${(s.exercises||[]).map(ex=>{
        const txt=(ex.sets||[]).map(x=>`${x.weight ?? "-"}×${x.reps ?? "-"}${x.rir!==null&&x.rir!==undefined?` (RIR ${x.rir})`:""}`).join(" · ");
        return `<div class="history-ex"><strong>${esc(ex.name)}</strong><br>${esc(txt)}</div>`;
      }).join("")}
    </div>`).join("");
}

function allExerciseNames(){
  return [...new Set(state.plans.flatMap(p=>p.exercises.map(e=>e.name)))];
}
function renderProgressOptions(){
  const sel=document.getElementById("progressExercise");
  const old=sel.value;
  sel.innerHTML=allExerciseNames().map(n=>`<option>${esc(n)}</option>`).join("");
  if([...sel.options].some(o=>o.value===old)) sel.value=old;
  drawProgress();
}
function estimated1RM(weight,reps){
  if(!weight||!reps) return null;
  return weight*(1+reps/30);
}
function drawProgress(){
  const name=document.getElementById("progressExercise").value;
  const points=[];
  state.sessions.sort((a,b)=>a.date.localeCompare(b.date)).forEach(s=>{
    const ex=(s.exercises||[]).find(e=>e.name===name);
    if(!ex) return;
    let best=null;
    (ex.sets||[]).forEach(x=>{
      const e1=estimated1RM(x.weight,x.reps);
      if(e1 && (!best || e1>best)) best=e1;
    });
    if(best) points.push({date:s.date,value:best});
  });
  const canvas=document.getElementById("progressChart"), ctx=canvas.getContext("2d");
  const W=canvas.width,H=canvas.height,p=48;
  ctx.clearRect(0,0,W,H);
  ctx.strokeStyle="#d1d5db";ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(p,p);ctx.lineTo(p,H-p);ctx.lineTo(W-p,H-p);ctx.stroke();
  if(points.length<1){
    ctx.fillStyle="#6b7280";ctx.font="24px system-ui";ctx.fillText("暂无数据",W/2-48,H/2);
    document.getElementById("progressSummary").textContent="";
    return;
  }
  const vals=points.map(x=>x.value), min=Math.min(...vals)*0.95, max=Math.max(...vals)*1.05 || 1;
  const x=i=>p+(W-2*p)*(points.length===1?0.5:i/(points.length-1));
  const y=v=>(H-p)-(H-2*p)*((v-min)/(max-min || 1));
  ctx.strokeStyle="#111827";ctx.lineWidth=3;ctx.beginPath();
  points.forEach((pt,i)=>{const X=x(i),Y=y(pt.value); i?ctx.lineTo(X,Y):ctx.moveTo(X,Y);});
  ctx.stroke();
  ctx.fillStyle="#111827";
  points.forEach((pt,i)=>{ctx.beginPath();ctx.arc(x(i),y(pt.value),5,0,Math.PI*2);ctx.fill();});
  const first=points[0],last=points.at(-1);
  document.getElementById("progressSummary").textContent=
    `${name}：估算 1RM 从 ${first.value.toFixed(1)} kg 到 ${last.value.toFixed(1)} kg（仅用于趋势观察）。`;
}
async function saveBody(){
  const item={
    date:isoDate(),
    weight:num("bodyWeight"),
    chest:num("chestCirc"),
    waist:num("waistCirc"),
    arm:num("armCirc")
  };
  if(Object.values(item).slice(1).every(v=>v===null)){alert("请至少输入一项。");return;}
  state.body.push(item); await persist(); renderBodyHistory();
  ["bodyWeight","chestCirc","waistCirc","armCirc"].forEach(id=>document.getElementById(id).value="");
}
function num(id){const v=document.getElementById(id).value;return v===""?null:Number(v)}
function renderBodyHistory(){
  const box=document.getElementById("bodyHistory");
  const arr=[...state.body].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,12);
  if(!arr.length){box.innerHTML='<div class="empty">暂无身体数据</div>';return;}
  box.innerHTML=arr.map(x=>`<div class="history-item"><strong>${x.date}</strong> ${
    [["体重",x.weight,"kg"],["胸围",x.chest,"cm"],["腰围",x.waist,"cm"],["臂围",x.arm,"cm"]]
    .filter(a=>a[1]!==null).map(a=>`${a[0]} ${a[1]} ${a[2]}`).join(" · ")
  }</div>`).join("");
}
async function exportData(){
  const payload={format:"fitness-pwa-backup-v1",exportedAt:new Date().toISOString(),...state};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);a.download=`fitness-backup-${isoDate()}.json`;a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function importData(file){
  try{
    const data=JSON.parse(await file.text());
    if(data.format && !String(data.format).startsWith("fitness-pwa")) throw new Error("格式不支持");
    state.plans=Array.isArray(data.plans)?data.plans:[];
    state.sessions=Array.isArray(data.sessions)?data.sessions:[];
    state.body=Array.isArray(data.body)?data.body:[];
    await persist(); renderAll(); alert("导入完成。");
  }catch(e){alert("导入失败："+e.message)}
}
async function wipeData(){
  if(!confirm("确定删除当前设备上的全部训练和身体数据？此操作无法撤销。")) return;
  state={plans:[],sessions:[],body:[]}; await persist(); renderAll();
}
function switchPage(id){
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.id===id));
  document.querySelectorAll(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.page===id));
  if(id==="progress"){renderProgressOptions();renderBodyHistory()}
}
function renderAll(){
  document.getElementById("todayDate").textContent=fmtDate();
  renderPlanSelect(); renderWorkout(); renderHistory(); renderProgressOptions(); renderBodyHistory();
}
async function init(){
  db=await openDB(); await loadState(); renderAll();
  document.querySelectorAll(".bottom-nav button").forEach(b=>b.onclick=()=>switchPage(b.dataset.page));
  document.getElementById("planSelect").onchange=renderWorkout;
  document.getElementById("saveWorkoutBtn").onclick=saveWorkout;
  document.getElementById("resetWorkoutBtn").onclick=resetWorkout;
  document.getElementById("saveBodyBtn").onclick=saveBody;
  document.getElementById("progressExercise").onchange=drawProgress;
  document.getElementById("exportBtn").onclick=exportData;
  document.getElementById("importInput").onchange=e=>e.target.files[0]&&importData(e.target.files[0]);
  document.getElementById("wipeBtn").onclick=wipeData;
  if("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
}
window.addEventListener("beforeinstallprompt",e=>{
  e.preventDefault(); deferredPrompt=e;
  const b=document.getElementById("installBtn"); b.classList.remove("hidden");
  b.onclick=async()=>{deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;b.classList.add("hidden");}
});
init();
