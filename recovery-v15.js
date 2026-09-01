/* v15 recovery and daily refresh.
 * - If local plans are empty, force a cloud plan restore even when the saved revision matches.
 * - The Training-page refresh also incrementally downloads missing body entries.
 * - Local wipe resets plan-sync metadata and workout drafts while keeping GitHub credentials.
 */

async function v15PrepareEmptyPlanRecovery(){
  if(!db||state.plans.length)return false;
  const meta=await v11ReadMeta();
  meta.plansBaseRevision=null;
  meta.plansDirty=false;
  meta.plansSig=await v11JsonSig([]);
  await v11WriteMeta(meta);
  return true;
}

async function v15MergeRemoteBody(c,m){
  let added=0;
  const local=await v11MapByHash(state.body);
  for(const hash of m.body||[]){
    if(local.has(hash))continue;
    const item=await v11DownloadImmutable(c,'body',hash);
    state.body.push(item);
    local.set(hash,item);
    added++;
  }
  if(added){
    v11ApplyingRemote=true;
    try{await v11BasePersist();}
    finally{v11ApplyingRemote=false;}
    renderBodyHistory();
  }
  return added;
}

const v15BaseQuickPull=typeof v12PullPlansOnly==='function'?v12PullPlansOnly:null;
async function v15PullTrainingContext(){
  if(!v15BaseQuickPull)return false;
  try{
    await v15PrepareEmptyPlanRecovery();
    const ok=await v15BaseQuickPull();
    if(!ok)return false;

    const c=v11Cfg();
    const remote=await v11LoadManifest(c);
    if(!remote.exists)return true;
    const addedBody=await v15MergeRemoteBody(c,remote.manifest);
    if(typeof v12TodayStatus==='function'){
      v12TodayStatus(addedBody
        ?`已刷新训练计划、训练记录和身体数据；新增 ${addedBody} 条身体记录。`
        :'训练计划、训练记录和身体数据已经是最新。',true);
    }
    return true;
  }catch(e){
    v11ApplyingRemote=false;
    if(typeof v12TodayStatus==='function')v12TodayStatus(e.message,false);
    return false;
  }
}
v12PullPlansOnly=v15PullTrainingContext;

const v15BaseFullPull=typeof v14FullPull==='function'?v14FullPull:(typeof v11Pull==='function'?v11Pull:null);
async function v15FullPull(){
  await v15PrepareEmptyPlanRecovery();
  if(v15BaseFullPull)return v15BaseFullPull();
}

async function v15WipeData(){
  if(!confirm('确定删除当前设备上的训练计划、训练记录和身体数据？GitHub 同步信息会保留，之后可从 Private GitHub 仓库重新恢复。'))return;

  state={plans:[],sessions:[],body:[]};
  v11ApplyingRemote=true;
  try{await v11BasePersist();}
  finally{v11ApplyingRemote=false;}

  const meta=await v11ReadMeta();
  meta.plansBaseRevision=null;
  meta.plansDirty=false;
  meta.plansSig=await v11JsonSig([]);
  await v11WriteMeta(meta);

  if(typeof v7DraftStore!=='undefined')v7DraftStore={};
  await idbSet('workoutDraftsV7',{});
  await idbSet('workoutActivePlanV7',0);
  if(typeof v3Draft!=='undefined')v3Draft={planIndex:0,sets:{},completed:{}};

  renderAll();
  if(typeof v2Status==='function')v2Status('本机训练数据已清空；GitHub 同步信息已保留。可直接点“从 GitHub 合并”恢复。',true);
}
wipeData=v15WipeData;

window.addEventListener('load',()=>setTimeout(()=>{
  const fullPull=document.getElementById('pullSyncBtn');
  if(fullPull)fullPull.onclick=v15FullPull;
  const wipe=document.getElementById('wipeBtn');
  if(wipe)wipe.onclick=v15WipeData;
},920));
