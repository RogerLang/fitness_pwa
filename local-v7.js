/* device-local convenience and resilience.
 * - Saves sync owner/repo/token only in this browser's IndexedDB.
 * - Auto-saves in-progress workout draft and restores it after reload.
 * - Requests persistent browser storage when supported.
 * - Hides app chrome while scrolling down and restores it while scrolling up.
 */
const V7_CREDS_KEY='syncCredentialsV7';
const V7_DRAFTS_KEY='workoutDraftsV7';
const V7_ACTIVE_PLAN_KEY='workoutActivePlanV7';
let v7DraftStore={};

function v7Clone(x){return JSON.parse(JSON.stringify(x));}

async function v7SaveCredentials(showStatus=false){
  if(!db)return false;
  const creds={
    owner:document.getElementById('syncOwner')?.value.trim()||'',
    repo:document.getElementById('syncRepo')?.value.trim()||'',
    token:document.getElementById('syncToken')?.value.trim()||''
  };
  if(showStatus&&Object.values(creds).some(v=>!v)){
    if(typeof v2Status==='function')v2Status('请先填写 GitHub 用户名、Private 仓库和 Token。',false);
    return false;
  }
  await idbSet(V7_CREDS_KEY,creds);
  await idbSet('syncConfig',{owner:creds.owner,repo:creds.repo});
  if(typeof v2SyncConfig!=='undefined')v2SyncConfig={owner:creds.owner,repo:creds.repo};
  if(showStatus&&typeof v2Status==='function')v2Status('三项 GitHub 同步信息已保存在这台设备的浏览器中。',true);
  return true;
}

async function v7LoadCredentials(){
  if(!db)return;
  const c=await idbGet(V7_CREDS_KEY);
  if(!c)return;
  const fields={syncOwner:c.owner,syncRepo:c.repo,syncToken:c.token};
  Object.entries(fields).forEach(([id,val])=>{
    const el=document.getElementById(id);
    if(el&&val!==undefined&&val!==null)el.value=val;
  });
}

function v7SnapshotDraft(){
  if(!db||typeof v3CaptureDraft!=='function'||!state.plans.length)return;
  try{
    v3CaptureDraft();
    const pi=v3CurrentPlanIndex();
    v7DraftStore[String(pi)]={...v7Clone(v3Draft),savedAt:new Date().toISOString()};
    idbSet(V7_DRAFTS_KEY,v7Clone(v7DraftStore)).catch(e=>console.warn('draft save failed',e));
    idbSet(V7_ACTIVE_PLAN_KEY,pi).catch(()=>{});
  }catch(e){console.warn('draft snapshot failed',e);}
}

async function v7RestoreDraft(pi=v3CurrentPlanIndex()){
  if(!db||!state.plans.length)return;
  const saved=v7DraftStore[String(pi)];
  if(saved){
    v3Draft={planIndex:pi,sets:v7Clone(saved.sets||{}),completed:v7Clone(saved.completed||{})};
  }else{
    v3Draft={planIndex:pi,sets:{},completed:{}};
  }
  v3RenderWorkout();
}

async function v7ClearDraft(pi=v3CurrentPlanIndex()){
  delete v7DraftStore[String(pi)];
  await idbSet(V7_DRAFTS_KEY,v7Clone(v7DraftStore));
}

if(typeof v3WorkoutInput==='function'){
  const base=v3WorkoutInput;
  v3WorkoutInput=function(e){const r=base(e);v7SnapshotDraft();return r;};
}
if(typeof v3WorkoutClick==='function'){
  const base=v3WorkoutClick;
  v3WorkoutClick=async function(e){const r=await base(e);v7SnapshotDraft();return r;};
}
if(typeof v3SaveWorkout==='function'){
  const base=v3SaveWorkout;
  v3SaveWorkout=async function(){
    const pi=v3CurrentPlanIndex(),before=state.sessions.length;
    const r=await base();
    if(state.sessions.length>before)await v7ClearDraft(pi);
    return r;
  };
}
if(typeof v3ResetWorkout==='function'){
  const base=v3ResetWorkout;
  v3ResetWorkout=function(){const pi=v3CurrentPlanIndex();const r=base();v7ClearDraft(pi).catch(()=>{});return r;};
}
if(typeof v3OnPlanChange==='function'){
  const base=v3OnPlanChange;
  v3OnPlanChange=async function(){
    const r=base();
    const pi=v3CurrentPlanIndex();
    await idbSet(V7_ACTIVE_PLAN_KEY,pi);
    await v7RestoreDraft(pi);
    return r;
  };
}

function v7InitAutoHide(){
  let lastY=window.scrollY;
  let ticking=false;
  const show=()=>document.body.classList.remove('chrome-hidden');
  const hide=()=>document.body.classList.add('chrome-hidden');
  const update=()=>{
    const y=window.scrollY;
    const max=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);
    const delta=y-lastY;
    if(y<=20||max-y<=20)show();
    else if(delta>7)hide();
    else if(delta<-7)show();
    lastY=y;
    ticking=false;
  };
  window.addEventListener('scroll',()=>{
    if(!ticking){requestAnimationFrame(update);ticking=true;}
  },{passive:true});
  window.addEventListener('resize',show,{passive:true});
}

window.addEventListener('load',()=>setTimeout(async()=>{
  try{if(navigator.storage?.persist)await navigator.storage.persist();}
  catch(e){console.warn('persistent storage request failed',e);}

  try{await v7LoadCredentials();}catch(e){console.warn('credential restore failed',e);}
  try{
    v7DraftStore=await idbGet(V7_DRAFTS_KEY)||{};
    let pi=Number(await idbGet(V7_ACTIVE_PLAN_KEY));
    if(!Number.isInteger(pi)||pi<0||pi>=state.plans.length)pi=0;
    const sel=document.getElementById('planSelect');
    if(sel&&!sel.disabled)sel.value=String(pi);
    await v7RestoreDraft(pi);
  }catch(e){console.warn('draft restore failed',e);}

  const remember=document.getElementById('rememberSyncBtn');
  if(remember){remember.textContent='保存本机同步信息';remember.onclick=()=>v7SaveCredentials(true);}

  document.addEventListener('visibilitychange',()=>{if(document.hidden)v7SnapshotDraft();});
  window.addEventListener('pagehide',v7SnapshotDraft);
  v7InitAutoHide();
},360));
