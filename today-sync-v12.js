/* v12 training-page sync shortcuts.
 * Adds a plans-only pull beside the plan selector and a normal incremental push beside Save Workout.
 */
function v12EnsureControls(){
  const sel=document.getElementById('planSelect');
  if(sel&&!document.getElementById('pullPlansTodayBtn')){
    const wrap=document.createElement('div');
    wrap.className='today-plan-sync-controls';
    wrap.style.display='flex';
    wrap.style.gap='8px';
    wrap.style.alignItems='center';
    wrap.style.minWidth='0';
    const pull=document.createElement('button');
    pull.id='pullPlansTodayBtn';
    pull.type='button';
    pull.className='small secondary';
    pull.textContent='拉取最新计划';
    pull.style.whiteSpace='nowrap';
    sel.parentNode.insertBefore(wrap,sel);
    wrap.appendChild(pull);
    wrap.appendChild(sel);
    sel.style.width='auto';
    sel.style.minWidth='140px';
    sel.style.flex='1 1 auto';

    const card=wrap.closest('.card');
    if(card&&!document.getElementById('todaySyncStatus')){
      const status=document.createElement('p');
      status.id='todaySyncStatus';
      status.className='muted today-sync-status';
      status.style.margin='8px 0 0';
      card.appendChild(status);
    }
  }

  const save=document.getElementById('saveWorkoutBtn');
  if(save&&!document.getElementById('syncTodayBtn')){
    const sync=document.createElement('button');
    sync.id='syncTodayBtn';
    sync.type='button';
    sync.className='secondary';
    sync.textContent='增量同步';
    save.insertAdjacentElement('afterend',sync);
  }
}
function v12TodayStatus(text,ok=null){
  const box=document.getElementById('todaySyncStatus');
  if(!box)return;
  box.textContent=text||'';
  box.className='muted today-sync-status '+(ok===true?'sync-ok':ok===false?'sync-error':'');
}
function v12MirrorSettingsStatus(){
  const src=document.getElementById('syncStatus');
  if(!src)return;
  v12TodayStatus(src.textContent,src.classList.contains('sync-ok')?true:src.classList.contains('sync-error')?false:null);
}
function v12HasWorkoutDraft(){
  if(typeof v3CaptureDraft==='function')v3CaptureDraft();
  if(typeof v3Draft==='undefined'||!v3Draft)return false;
  const hasInputs=Object.values(v3Draft.sets||{}).some(v=>String(v??'').trim()!=='');
  const hasCompleted=Object.values(v3Draft.completed||{}).some(Boolean);
  return hasInputs||hasCompleted;
}
async function v12PullPlansOnly(){
  const c=v11Cfg();
  try{
    if(typeof v7SaveCredentials==='function')await v7SaveCredentials(false);
    v12TodayStatus('正在拉取最新训练计划…');
    await v11PrivateCheck(c);
    await v11RefreshMeta();
    const meta=await v11ReadMeta();
    const remote=await v11LoadManifest(c);
    if(!remote.exists)throw new Error('GitHub 还没有同步数据，请先在有完整计划的设备执行“增量同步”。');
    const m=remote.manifest,remoteRev=m.plans?.revision||null;
    if(!remoteRev)throw new Error('GitHub 还没有训练计划。');

    if(remoteRev===meta.plansBaseRevision&&!meta.plansDirty){
      v12TodayStatus('训练计划已经是最新版本。',true);
      return true;
    }
    if(v12HasWorkoutDraft()){
      throw new Error('当前还有未保存的训练输入。请先保存本次训练或清空输入，再拉取最新计划。');
    }
    if(meta.plansDirty){
      const useCloud=confirm('本机训练计划有尚未同步的修改。\n\n继续会使用 GitHub 上的最新训练计划覆盖本机计划；训练历史和身体数据不会改变。\n\n继续？');
      if(!useCloud){v12TodayStatus('已取消，保留本机训练计划。',false);return false;}
    }

    const oldIndex=typeof v3CurrentPlanIndex==='function'?v3CurrentPlanIndex():0;
    const oldName=state.plans[oldIndex]?.name||'';
    const plans=await v11DownloadPlans(c,m);
    state.plans=plans;
    meta.plansBaseRevision=remoteRev;
    meta.plansDirty=false;
    meta.plansSig=await v11JsonSig(state.plans);

    v11ApplyingRemote=true;
    await v11BasePersist();
    v11ApplyingRemote=false;
    await v11WriteMeta(meta);

    renderAll();
    let nextIndex=state.plans.findIndex(p=>p.name===oldName);
    if(nextIndex<0)nextIndex=0;
    const nextSel=document.getElementById('planSelect');
    if(nextSel&&!nextSel.disabled)nextSel.value=String(nextIndex);
    if(typeof v3Draft!=='undefined'){
      v3Draft={planIndex:nextIndex,sets:{},completed:{}};
      if(typeof v3RenderWorkout==='function')v3RenderWorkout();
    }
    try{await idbSet('workoutActivePlanV7',nextIndex);}catch{}
    v12TodayStatus('已拉取最新训练计划。',true);
    return true;
  }catch(e){
    v11ApplyingRemote=false;
    v12TodayStatus(e.message,false);
    return false;
  }
}
async function v12RunPlansPull(){
  const b=document.getElementById('pullPlansTodayBtn');
  if(!b)return;
  const old=b.textContent;
  b.disabled=true;b.textContent='拉取中…';
  try{await v12PullPlansOnly();}
  finally{b.disabled=false;b.textContent=old;}
}
async function v12RunPush(){
  const b=document.getElementById('syncTodayBtn');
  if(!b)return;
  const old=b.textContent;
  b.disabled=true;b.textContent='同步中…';
  v12TodayStatus('正在增量同步…');
  try{
    await v11Push();
    v12MirrorSettingsStatus();
  }finally{
    b.disabled=false;b.textContent=old;
  }
}
window.addEventListener('load',()=>setTimeout(()=>{
  v12EnsureControls();
  const pull=document.getElementById('pullPlansTodayBtn');
  const push=document.getElementById('syncTodayBtn');
  if(pull)pull.onclick=v12RunPlansPull;
  if(push)push.onclick=v12RunPush;
},420));
