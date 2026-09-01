/* v11 plain incremental sync to a dedicated Private GitHub repository.
 * Remote layout:
 *   manifest.json
 *   plans.json
 *   sessions/<sha256(random-id)>.json
 *   body/<sha256(random-id)>.json
 *
 * Data is intentionally readable to anyone who can access the Private repo.
 * The app still enforces repo visibility=private and keeps the token device-local.
 */
let v11ApplyingRemote=false;
const v11BasePersist=persist;

async function v11HexDigest(text){
  const buf=await crypto.subtle.digest('SHA-256',v2TE.encode(String(text)));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function v11JsonSig(value){return v11HexDigest(JSON.stringify(value));}
async function v11ItemHash(id){return v11HexDigest(id);}
function v11Now(){return new Date().toISOString();}

async function v11ReadMeta(){return await idbGet('syncMetaV11')||{};}
async function v11WriteMeta(meta){await idbSet('syncMetaV11',meta);return meta;}
async function v11RefreshMeta(){
  if(!db)return {};
  const meta=await v11ReadMeta();
  const sig=await v11JsonSig(state.plans);
  if(!meta.plansSig){
    meta.plansSig=sig;
    meta.plansDirty=false;
    meta.plansBaseRevision=meta.plansBaseRevision||null;
  }else if(!v11ApplyingRemote && meta.plansSig!==sig){
    meta.plansSig=sig;
    meta.plansDirty=true;
  }
  return v11WriteMeta(meta);
}

persist=async function(){
  await v11BasePersist();
  try{await v11RefreshMeta();}catch(e){console.warn('sync metadata update failed',e);}
};

function v11Cfg(){return {
  owner:document.getElementById('syncOwner')?.value.trim()||'',
  repo:document.getElementById('syncRepo')?.value.trim()||'',
  token:document.getElementById('syncToken')?.value.trim()||''
};}
function v11FileUrl(c,path){
  return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
}
async function v11GetJson(c,path){
  const r=await v2Gh(v11FileUrl(c,path),c.token);
  if(!r.data)return null;
  return {sha:r.data.sha,data:JSON.parse(v2TD.decode(v2Unb64(r.data.content)))};
}
async function v11PutJson(c,path,data,sha=null,message='Update fitness sync data'){
  const body={message,content:v2B64(v2TE.encode(JSON.stringify(data,null,2)))};
  if(sha)body.sha=sha;
  return v2Gh(v11FileUrl(c,path),c.token,{method:'PUT',body:JSON.stringify(body)});
}
async function v11PrivateCheck(c){
  if(!c.owner||!c.repo||!c.token)throw new Error('请填写 GitHub 用户名、Private 仓库和 Token。');
  await v2PrivateRepo(c);
}

function v11EmptyManifest(){return {
  format:'fitness-pwa-manifest-v3',
  updatedAt:v11Now(),
  plans:{path:'plans.json',revision:null},
  sessions:[],
  body:[]
};}
function v11ValidateManifest(m){
  if(!m||m.format!=='fitness-pwa-manifest-v3')throw new Error('云端同步格式不支持。');
  m.plans=m.plans||{path:'plans.json',revision:null};
  if(!Array.isArray(m.sessions))m.sessions=[];
  if(!Array.isArray(m.body))m.body=[];
  return m;
}
async function v11LoadManifest(c){
  const f=await v11GetJson(c,'manifest.json');
  if(!f)return {manifest:v11EmptyManifest(),sha:null,exists:false};
  return {manifest:v11ValidateManifest(f.data),sha:f.sha,exists:true};
}
async function v11SaveManifest(c,m,sha){
  m.updatedAt=v11Now();
  await v11PutJson(c,'manifest.json',m,sha,'Update fitness manifest');
}

async function v11EnsureIds(){
  let changed=false;
  for(const s of state.sessions){if(!s.id){s.id=crypto.randomUUID();changed=true;}}
  for(const b of state.body){if(!b.id){b.id=crypto.randomUUID();changed=true;}}
  if(changed)await persist();
}
async function v11MapByHash(items){
  const map=new Map();
  for(const item of items)map.set(await v11ItemHash(item.id),item);
  return map;
}
async function v11VerifyOrCreateImmutable(c,kind,hash,item){
  const path=`${kind}/${hash}.json`;
  const old=await v11GetJson(c,path);
  const expectedFormat=kind==='sessions'?'fitness-session-v2':'fitness-body-entry-v2';
  if(old){
    const remoteItem=kind==='sessions'?old.data?.session:old.data?.entry;
    if(old.data?.format!==expectedFormat||!remoteItem?.id||await v11ItemHash(remoteItem.id)!==hash)
      throw new Error(`${kind==='sessions'?'训练':'身体'}记录完整性检查失败`);
    return false;
  }
  const payload=kind==='sessions'
    ?{format:'fitness-session-v2',session:item}
    :{format:'fitness-body-entry-v2',entry:item};
  await v11PutJson(c,path,payload,null,kind==='sessions'?'Add workout session':'Add body entry');
  return true;
}
async function v11DownloadImmutable(c,kind,hash){
  const f=await v11GetJson(c,`${kind}/${hash}.json`);
  if(!f)throw new Error(`云端文件缺失：${hash.slice(0,8)}…`);
  const expectedFormat=kind==='sessions'?'fitness-session-v2':'fitness-body-entry-v2';
  const item=kind==='sessions'?f.data?.session:f.data?.entry;
  if(f.data?.format!==expectedFormat||!item?.id||await v11ItemHash(item.id)!==hash)throw new Error('云端记录完整性检查失败');
  return item;
}

async function v11UploadPlans(c,m,meta){
  const path='plans.json';
  const old=await v11GetJson(c,path);
  const revision=crypto.randomUUID();
  const payload={format:'fitness-plans-v3',revision,updatedAt:v11Now(),plans:state.plans};
  await v11PutJson(c,path,payload,old?.sha||null,'Update training plans');
  m.plans={path,revision};
  meta.plansBaseRevision=revision;
  meta.plansDirty=false;
  meta.plansSig=await v11JsonSig(state.plans);
}
async function v11DownloadPlans(c,m){
  const f=await v11GetJson(c,m.plans?.path||'plans.json');
  if(!f)throw new Error('云端计划文件缺失');
  const p=f.data;
  if(p?.format!=='fitness-plans-v3'||p.revision!==m.plans.revision||!Array.isArray(p.plans))throw new Error('云端训练计划完整性检查失败');
  return p.plans;
}

async function v11Push(){
  const c=v11Cfg();
  try{
    if(typeof v7SaveCredentials==='function')await v7SaveCredentials(false);
    v2Status('正在检查 Private 仓库…');
    await v11PrivateCheck(c);
    await v11EnsureIds();
    await v11RefreshMeta();
    const meta=await v11ReadMeta();
    const remote=await v11LoadManifest(c),m=remote.manifest;
    const remoteRev=m.plans?.revision||null;

    if(remote.exists && remoteRev && meta.plansBaseRevision!==remoteRev){
      if(meta.plansDirty)throw new Error('本机和云端都修改过训练计划。请先从 GitHub 合并并选择要保留的计划。');
      throw new Error('云端训练计划有更新，请先点“从 GitHub 合并”。');
    }

    let changed=false,addedSessions=0,addedBody=0;
    v2Status('正在增量同步新增记录…');

    const sessionMap=await v11MapByHash(state.sessions);
    const remoteSessions=new Set(m.sessions);
    for(const [hash,item] of sessionMap){
      if(remoteSessions.has(hash))continue;
      await v11VerifyOrCreateImmutable(c,'sessions',hash,item);
      remoteSessions.add(hash);addedSessions++;changed=true;
    }
    m.sessions=[...remoteSessions].sort();

    const bodyMap=await v11MapByHash(state.body);
    const remoteBody=new Set(m.body);
    for(const [hash,item] of bodyMap){
      if(remoteBody.has(hash))continue;
      await v11VerifyOrCreateImmutable(c,'body',hash,item);
      remoteBody.add(hash);addedBody++;changed=true;
    }
    m.body=[...remoteBody].sort();

    if(!remoteRev||meta.plansDirty){
      await v11UploadPlans(c,m,meta);changed=true;
    }

    if(changed){
      await v11SaveManifest(c,m,remote.sha);
      await v11WriteMeta(meta);
      v2Status(`同步完成：新增 ${addedSessions} 条训练、${addedBody} 条身体记录。`,true);
    }else{
      v2Status('GitHub 已包含本机全部记录，没有需要上传的新内容。',true);
    }
  }catch(e){v2Status(e.message,false);}
}

async function v11Pull(){
  const c=v11Cfg();
  try{
    if(typeof v7SaveCredentials==='function')await v7SaveCredentials(false);
    v2Status('正在检查 Private 仓库并读取 manifest…');
    await v11PrivateCheck(c);
    await v11EnsureIds();
    await v11RefreshMeta();
    const meta=await v11ReadMeta();
    const remote=await v11LoadManifest(c);
    if(!remote.exists)throw new Error('GitHub 还没有新版同步数据。请先在一台有完整数据的设备执行“增量同步”。');
    const m=remote.manifest,remoteRev=m.plans?.revision||null;

    if(remoteRev&&meta.plansBaseRevision!==remoteRev&&meta.plansDirty){
      const useCloud=confirm('检测到训练计划冲突：本机和 GitHub 都改过计划。\n\n确定：使用 GitHub 计划覆盖本机计划。\n取消：保留本机计划，本次同步停止。\n\n训练历史和身体数据不会因此删除。');
      if(!useCloud)throw new Error('已取消同步，保留本机训练计划。');
    }

    let addedSessions=0,addedBody=0,plansPulled=false;
    const sessionMap=await v11MapByHash(state.sessions);
    for(const hash of m.sessions){
      if(sessionMap.has(hash))continue;
      const item=await v11DownloadImmutable(c,'sessions',hash);
      state.sessions.push(item);sessionMap.set(hash,item);addedSessions++;
    }

    const bodyMap=await v11MapByHash(state.body);
    for(const hash of m.body){
      if(bodyMap.has(hash))continue;
      const item=await v11DownloadImmutable(c,'body',hash);
      state.body.push(item);bodyMap.set(hash,item);addedBody++;
    }

    if(remoteRev&&meta.plansBaseRevision!==remoteRev){
      state.plans=await v11DownloadPlans(c,m);
      meta.plansBaseRevision=remoteRev;
      meta.plansDirty=false;
      meta.plansSig=await v11JsonSig(state.plans);
      plansPulled=true;
    }

    v11ApplyingRemote=true;
    await v11BasePersist();
    v11ApplyingRemote=false;
    await v11WriteMeta(meta);

    renderAll();
    if(typeof v3Draft!=='undefined'){
      v3Draft={planIndex:v3CurrentPlanIndex(),sets:{},completed:{}};
      if(typeof v3RenderWorkout==='function')v3RenderWorkout();
    }
    v2Status(`合并完成：新增 ${addedSessions} 条训练、${addedBody} 条身体记录${plansPulled?'；训练计划已更新':''}。`,true);
  }catch(e){v11ApplyingRemote=false;v2Status(e.message,false);}
}

async function v11Remember(){
  if(typeof v7SaveCredentials==='function')return v7SaveCredentials(true);
  const c=v11Cfg();
  await idbSet('syncCredentialsV7',{owner:c.owner,repo:c.repo,token:c.token});
  v2Status('GitHub 用户名、仓库和 Token 已保存在这台设备。',true);
}

// Reuse the legacy init wiring, but bind it to the new password-free implementation.
v2Push=v11Push;
v2Pull=v11Pull;
v2Remember=v11Remember;

window.addEventListener('load',()=>setTimeout(async()=>{
  try{await v11RefreshMeta();}catch(e){console.warn(e);}
  const push=document.getElementById('pushSyncBtn');
  const pull=document.getElementById('pullSyncBtn');
  const remember=document.getElementById('rememberSyncBtn');
  if(push){push.textContent='增量同步';push.onclick=v11Push;}
  if(pull){pull.textContent='从 GitHub 合并';pull.onclick=v11Pull;}
  if(remember){remember.textContent='保存本机同步信息';remember.onclick=v11Remember;}
},240));
