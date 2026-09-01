let v2SyncConfig = {};

function v2NewExercise(){
  return {name:"新动作",sets:3,repRange:[8,12],defaultWeight:null,increment:2.5,note:"",optional:false};
}
function v2Esc(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));}
function v2Num(v){return v===""||v===null||v===undefined?null:Number(v);}
function v2RenderEditor(){
  const box=document.getElementById("planEditor"); if(!box)return;
  if(!state.plans.length){box.innerHTML='<div class="empty">暂无计划。点击“新建计划”。</div>';return;}
  box.innerHTML=state.plans.map((p,pi)=>`
    <div class="plan-card">
      <div class="plan-head">
        <input class="plan-name" data-p="${pi}" value="${v2Esc(p.name||"")}" aria-label="计划名称">
        <div class="plan-actions">
          <button class="small secondary add-exercise" data-p="${pi}">+ 动作</button>
          <button class="small danger delete-plan" data-p="${pi}">删除计划</button>
        </div>
      </div>
      ${(p.exercises||[]).map((ex,ei)=>`
        <div class="exercise-edit" data-p="${pi}" data-e="${ei}">
          <div class="exercise-edit-grid">
            <label class="wide">动作名称<input data-field="name" value="${v2Esc(ex.name||"")}"></label>
            <label>组数<input data-field="sets" type="number" min="1" max="30" step="1" value="${Number(ex.sets)||1}"></label>
            <label>最低次数<input data-field="repMin" type="number" min="1" step="1" value="${ex.repRange?.[0]??8}"></label>
            <label>最高次数<input data-field="repMax" type="number" min="1" step="1" value="${ex.repRange?.[1]??12}"></label>
            <label>默认 kg<input data-field="defaultWeight" type="number" step="0.5" value="${ex.defaultWeight??""}"></label>
            <label>加重 kg<input data-field="increment" type="number" min="0" step="0.5" value="${ex.increment??2.5}"></label>
          </div>
          <label>备注<textarea data-field="note">${v2Esc(ex.note||"")}</textarea></label>
          <div class="row between wrap top-gap">
            <label class="row"><input data-field="optional" type="checkbox" ${ex.optional?"checked":""}> 可选动作</label>
            <button class="small danger delete-exercise" data-p="${pi}" data-e="${ei}">删除动作</button>
          </div>
        </div>`).join("")}
    </div>`).join("");
}
async function v2Refresh(){
  await persist(); renderPlanSelect(); renderWorkout(); renderProgressOptions(); v2RenderEditor();
}
async function v2AddPlan(){
  state.plans.push({name:`训练计划 ${state.plans.length+1}`,exercises:[v2NewExercise()]}); await v2Refresh();
}
async function v2EditorClick(e){
  const b=e.target.closest("button"); if(!b)return;
  const pi=Number(b.dataset.p),ei=Number(b.dataset.e);
  if(b.classList.contains("add-exercise")){state.plans[pi].exercises??=[];state.plans[pi].exercises.push(v2NewExercise());await v2Refresh();}
  if(b.classList.contains("delete-exercise")&&confirm("删除这个动作？历史训练记录不会被删除。")){state.plans[pi].exercises.splice(ei,1);await v2Refresh();}
  if(b.classList.contains("delete-plan")&&confirm("删除这个训练计划？历史训练记录不会被删除。")){state.plans.splice(pi,1);await v2Refresh();}
}
async function v2EditorInput(e){
  const el=e.target;
  if(el.classList.contains("plan-name")){state.plans[Number(el.dataset.p)].name=el.value;await persist();renderPlanSelect();return;}
  const wrap=el.closest(".exercise-edit"); if(!wrap)return;
  const ex=state.plans[Number(wrap.dataset.p)].exercises[Number(wrap.dataset.e)],f=el.dataset.field;if(!f)return;
  if(f==="name")ex.name=el.value;
  else if(f==="sets")ex.sets=Math.max(1,Number(el.value)||1);
  else if(f==="repMin"){ex.repRange??=[8,12];ex.repRange[0]=Math.max(1,Number(el.value)||1);}
  else if(f==="repMax"){ex.repRange??=[8,12];ex.repRange[1]=Math.max(1,Number(el.value)||1);}
  else if(f==="defaultWeight")ex.defaultWeight=v2Num(el.value);
  else if(f==="increment")ex.increment=Math.max(0,Number(el.value)||0);
  else if(f==="note")ex.note=el.value;
  else if(f==="optional")ex.optional=el.checked;
  await persist(); renderWorkout(); renderProgressOptions();
}

/* End-to-end encrypted manual sync to a separate private GitHub repository. */
const v2TE=new TextEncoder(),v2TD=new TextDecoder();
function v2B64(bytes){let s="";for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);}
function v2Unb64(s){const b=atob(s.replace(/\s/g,"")),a=new Uint8Array(b.length);for(let i=0;i<b.length;i++)a[i]=b.charCodeAt(i);return a;}
async function v2Key(password,salt,it=310000){
  const base=await crypto.subtle.importKey("raw",v2TE.encode(password),"PBKDF2",false,["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt,iterations:it},base,{name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
}
async function v2Encrypt(payload,password){
  const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12)),iterations=310000,key=await v2Key(password,salt,iterations);
  const ct=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv},key,v2TE.encode(JSON.stringify(payload))));
  return {format:"fitness-pwa-encrypted-v1",updatedAt:new Date().toISOString(),kdf:{name:"PBKDF2",hash:"SHA-256",iterations,salt:v2B64(salt)},cipher:{name:"AES-GCM",iv:v2B64(iv)},ciphertext:v2B64(ct)};
}
async function v2Decrypt(env,password){
  if(env?.format!=="fitness-pwa-encrypted-v1")throw new Error("云端文件格式不支持");
  const key=await v2Key(password,v2Unb64(env.kdf.salt),Number(env.kdf.iterations)||310000);
  try{return JSON.parse(v2TD.decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:v2Unb64(env.cipher.iv)},key,v2Unb64(env.ciphertext))));}
  catch{throw new Error("解密失败：密码错误或密文损坏");}
}
function v2Cfg(){return {owner:syncOwner.value.trim(),repo:syncRepo.value.trim(),token:syncToken.value.trim(),password:syncPassword.value,path:syncPath.value.trim()||"fitness-sync.enc.json"};}
function v2Status(t,ok=null){syncStatus.textContent=t;syncStatus.className="muted "+(ok===true?"sync-ok":ok===false?"sync-error":"");}
function v2Headers(token){return {"Accept":"application/vnd.github+json","Authorization":`Bearer ${token}`,"X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"};}
async function v2Gh(url,token,opts={}){
  const r=await fetch(url,{...opts,headers:{...v2Headers(token),...(opts.headers||{})}});
  if(r.status===404)return {status:404,data:null}; let data=null;try{data=await r.json();}catch{}
  if(!r.ok)throw new Error(`GitHub API ${r.status}${data?.message?": "+data.message:""}`); return {status:r.status,data};
}
async function v2PrivateRepo(c){
  const {data}=await v2Gh(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`,c.token);
  if(!data)throw new Error("找不到同步仓库"); if(data.private!==true||data.visibility!=="private")throw new Error("安全检查拒绝：同步目标必须是 Private repository"); return data;
}
function v2Payload(){return {format:"fitness-pwa-backup-v2",exportedAt:new Date().toISOString(),plans:JSON.parse(JSON.stringify(state.plans)),sessions:JSON.parse(JSON.stringify(state.sessions)),body:JSON.parse(JSON.stringify(state.body))};}
function v2Validate(d){if(!d||typeof d!=="object")throw new Error("解密数据无效");return {plans:Array.isArray(d.plans)?d.plans:[],sessions:Array.isArray(d.sessions)?d.sessions:[],body:Array.isArray(d.body)?d.body:[]};}
function v2FileUrl(c){return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${c.path.split("/").map(encodeURIComponent).join("/")}`;}
async function v2Push(){
  const c=v2Cfg(); if(!c.owner||!c.repo||!c.token||!c.password){v2Status("请填写用户名、私有仓库、Token 和同步密码。",false);return;}
  try{
    v2Status("正在安全检查并加密…");await v2PrivateRepo(c);const env=await v2Encrypt(v2Payload(),c.password),url=v2FileUrl(c),old=await v2Gh(url,c.token);
    const body={message:`Update encrypted fitness data ${new Date().toISOString()}`,content:v2B64(v2TE.encode(JSON.stringify(env,null,2)))};if(old.data?.sha)body.sha=old.data.sha;
    await v2Gh(url,c.token,{method:"PUT",body:JSON.stringify(body)});v2Status(`上传完成：${new Date().toLocaleString()}。云端只有密文。`,true);
  }catch(e){v2Status(e.message,false);}
}
async function v2Pull(){
  const c=v2Cfg(); if(!c.owner||!c.repo||!c.token||!c.password){v2Status("请填写用户名、私有仓库、Token 和同步密码。",false);return;}
  if(!confirm("云端数据会覆盖当前设备上的计划、训练历史和身体数据。继续？"))return;
  try{
    v2Status("正在检查仓库并下载密文…");await v2PrivateRepo(c);const r=await v2Gh(v2FileUrl(c),c.token);if(!r.data)throw new Error("云端还没有同步文件");
    const env=JSON.parse(v2TD.decode(v2Unb64(r.data.content))),d=v2Validate(await v2Decrypt(env,c.password));state.plans=d.plans;state.sessions=d.sessions;state.body=d.body;await v2Refresh();renderHistory();renderBodyHistory();v2Status(`拉取完成：${new Date().toLocaleString()}。`,true);
  }catch(e){v2Status(e.message,false);}
}
async function v2Remember(){
  const c=v2Cfg();v2SyncConfig={owner:c.owner,repo:c.repo,path:c.path};await idbSet("syncConfig",v2SyncConfig);v2Status("已在本机保存仓库地址；Token 和同步密码未保存。",true);
}
async function v2Init(){
  v2SyncConfig=await idbGet("syncConfig")||{};
  syncOwner.value=v2SyncConfig.owner||"";syncRepo.value=v2SyncConfig.repo||"";syncPath.value=v2SyncConfig.path||"fitness-sync.enc.json";
  v2RenderEditor();
  addPlanBtn.onclick=v2AddPlan;planEditor.addEventListener("click",v2EditorClick);planEditor.addEventListener("change",v2EditorInput);
  pushSyncBtn.onclick=v2Push;pullSyncBtn.onclick=v2Pull;rememberSyncBtn.onclick=v2Remember;
  document.querySelector('[data-page="settings"]').addEventListener("click",()=>setTimeout(v2RenderEditor,0));
}
window.addEventListener("load",()=>setTimeout(v2Init,100));
