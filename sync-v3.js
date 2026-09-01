/* v6 incremental encrypted sync.
 * Remote Private repository layout:
 *   manifest.enc.json                      encrypted manifest
 *   plans.enc.json                         encrypted current plan revision
 *   sessions/<sha256(random-id)>.enc.json  immutable encrypted workout
 *   body/<sha256(random-id)>.enc.json      immutable encrypted body entry
 *
 * The manifest is encrypted too. GitHub can still observe repository metadata
 * such as file count, sizes and commit timestamps.
 */
let v6ApplyingRemote=false;
const v6BasePersist=persist;

async function v6HexDigest(text){
  const buf=await crypto.subtle.digest('SHA-256',v2TE.encode(String(text)));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function v6JsonSig(value){return v6HexDigest(JSON.stringify(value));}
async function v6ItemHash(id){return v6HexDigest(id);}
function v6Now(){return new Date().toISOString();}

async function v6ReadMeta(){return await idbGet('syncMetaV6')||{};}
async function v6WriteMeta(meta){await idbSet('syncMetaV6',meta);return meta;}
async function v6RefreshMeta(){
  if(!db)return {};
  const meta=await v6ReadMeta();
  const sig=await v6JsonSig(state.plans);
  if(!meta.plansSig){
    meta.plansSig=sig;
    meta.plansDirty=false;
    meta.plansBaseRevision=meta.plansBaseRevision||null;
  }else if(!v6ApplyingRemote && meta.plansSig!==sig){
    meta.plansSig=sig;
    meta.plansDirty=true;
  }
  return v6WriteMeta(meta);
}

persist=async function(){
  await v6BasePersist();
  try{await v6RefreshMeta();}catch(e){console.warn('sync metadata update failed',e);}
};

function v6Cfg(){return {
  owner:document.getElementById('syncOwner').value.trim(),
  repo:document.getElementById('syncRepo').value.trim(),
  token:document.getElementById('syncToken').value.trim(),
  password:document.getElementById('syncPassword').value
};}
function v6FileUrl(c,path){
  return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
}
async function v6GetFile(c,path){
  const r=await v2Gh(v6FileUrl(c,path),c.token);
  if(!r.data)return null;
  return {sha:r.data.sha,env:JSON.parse(v2TD.decode(v2Unb64(r.data.content)))};
}
async function v6PutFile(c,path,env,sha=null,message='Update encrypted fitness data'){
  const body={message,content:v2B64(v2TE.encode(JSON.stringify(env,null,2)))};
  if(sha)body.sha=sha;
  return v2Gh(v6FileUrl(c,path),c.token,{method:'PUT',body:JSON.stringify(body)});
}
async function v6PrivateCheck(c){
  if(!c.owner||!c.repo||!c.token||!c.password)throw new Error('请填写用户名、Private 仓库、Token 和同步密码。');
  await v2PrivateRepo(c);
}
function v6EmptyManifest(){return {
  format:'fitness-pwa-manifest-v2',
  updatedAt:v6Now(),
  plans:{path:'plans.enc.json',revision:null},
  sessions:[],
  body:[]
};}
function v6ValidateManifest(m){
  if(!m||m.format!=='fitness-pwa-manifest-v2')throw new Error('云端同步格式不支持。');
  m.plans=m.plans||{path:'plans.enc.json',revision:null};
  if(!Array.isArray(m.sessions))m.sessions=[];
  if(!Array.isArray(m.body))m.body=[];
  return m;
}
async function v6LoadManifest(c){
  const f=await v6GetFile(c,'manifest.enc.json');
  if(!f)return {manifest:v6EmptyManifest(),sha:null,exists:false};
  return {manifest:v6ValidateManifest(await v2Decrypt(f.env,c.password)),sha:f.sha,exists:true};
}
async function v6SaveManifest(c,m,sha){
  m.updatedAt=v6Now();
  await v6PutFile(c,'manifest.enc.json',await v2Encrypt(m,c.password),sha,'Update encrypted fitness manifest');
}

async function v6EnsureIds(){
  let changed=false;
  for(const s of state.sessions){if(!s.id){s.id=crypto.randomUUID();changed=true;}}
  for(const b of state.body){if(!b.id){b.id=crypto.randomUUID();changed=true;}}
  if(changed)await persist();
}
async function v6MapByHash(items){
  const map=new Map();
  for(const item of items)map.set(await v6ItemHash(item.id),item);
  return map;
}
async function v6VerifyOrCreateImmutable(c,kind,hash,item){
  const path=`${kind}/${hash}.enc.json`;
  const old=await v6GetFile(c,path);
  if(old){
    const p=await v2Decrypt(old.env,c.password);
    const expectedFormat=kind==='sessions'?'fitness-session-v1':'fitness-body-entry-v1';
    const remoteItem=kind==='sessions'?p?.session:p?.entry;
    if(p?.format!==expectedFormat||!remoteItem?.id||await v6ItemHash(remoteItem.id)!==hash)
      throw new Error(`${kind==='sessions'?'训练':'身体'}记录完整性检查失败`);
    return false;
  }
  const payload=kind==='sessions'
    ?{format:'fitness-session-v1',session:item}
    :{format:'fitness-body-entry-v1',entry:item};
  await v6PutFile(c,path,await v2Encrypt(payload,c.password),null,kind==='sessions'?'Add encrypted workout session':'Add encrypted body entry');
  return true;
}
async function v6DownloadImmutable(c,kind,hash){
  const f=await v6GetFile(c,`${kind}/${hash}.enc.json`);
  if(!f)throw new Error(`云端文件缺失：${hash.slice(0,8)}…`);
  const p=await v2Decrypt(f.env,c.password);
  const expectedFormat=kind==='sessions'?'fitness-session-v1':'fitness-body-entry-v1';
  const item=kind==='sessions'?p?.session:p?.entry;
  if(p?.format!==expectedFormat||!item?.id||await v6ItemHash(item.id)!==hash)throw new Error('云端记录完整性检查失败');
  return item;
}

async function v6UploadPlans(c,m,meta){
  const path='plans.enc.json';
  const old=await v6GetFile(c,path);
  const revision=crypto.randomUUID();
  const payload={format:'fitness-plans-v2',revision,updatedAt:v6Now(),plans:state.plans};
  await v6PutFile(c,path,await v2Encrypt(payload,c.password),old?.sha||null,'Update encrypted training plans');
  m.plans={path,revision};
  meta.plansBaseRevision=revision;
  meta.plansDirty=false;
  meta.plansSig=await v6JsonSig(state.plans);
  return true;
}
async function v6DownloadPlans(c,m){
  const f=await v6GetFile(c,m.plans?.path||'plans.enc.json');
  if(!f)throw new Error('云端计划文件缺失');
  const p=await v2Decrypt(f.env,c.password);
  if(p?.format!=='fitness-plans-v2'||p.revision!==m.plans.revision||!Array.isArray(p.plans))throw new Error('云端训练计划完整性检查失败');
  return p.plans;
}

async function v6Push(){
  const c=v6Cfg();
  try{
    v2Status('正在检查 Private 仓库…');
    await v6PrivateCheck(c);
    await v6EnsureIds();
    await v6RefreshMeta();
    const meta=await v6ReadMeta();
    const remote=await v6LoadManifest(c),m=remote.manifest;
    const remoteRev=m.plans?.revision||null;

    if(remote.exists && remoteRev && meta.plansBaseRevision!==remoteRev){
      if(meta.plansDirty)throw new Error('本机和云端都修改过训练计划。为避免覆盖，请先从云端合并并选择要保留的计划。');
      throw new Error('云端训练计划有更新，请先点“从云端合并”。');
    }

    let changed=false,addedSessions=0,addedBody=0;
    v2Status('正在增量加密新增记录…');

    const sessionMap=await v6MapByHash(state.sessions);
    const remoteSessions=new Set(m.sessions);
    for(const [hash,item] of sessionMap){
      if(remoteSessions.has(hash))continue;
      await v6VerifyOrCreateImmutable(c,'sessions',hash,item);
      remoteSessions.add(hash);addedSessions++;changed=true;
    }
    m.sessions=[...remoteSessions].sort();

    const bodyMap=await v6MapByHash(state.body);
    const remoteBody=new Set(m.body);
    for(const [hash,item] of bodyMap){
      if(remoteBody.has(hash))continue;
      await v6VerifyOrCreateImmutable(c,'body',hash,item);
      remoteBody.add(hash);addedBody++;changed=true;
    }
    m.body=[...remoteBody].sort();

    if(!remoteRev || meta.plansDirty){
      await v6UploadPlans(c,m,meta);changed=true;
    }

    if(changed){
      await v6SaveManifest(c,m,remote.sha);
      await v6WriteMeta(meta);
      v2Status(`同步完成：新增 ${addedSessions} 条训练、${addedBody} 条身体记录。`,true);
    }else{
      v2Status('云端已经包含本机全部记录，没有需要上传的新内容。',true);
    }
  }catch(e){v2Status(e.message,false);}
}

async function v6Pull(){
  const c=v6Cfg();
  try{
    v2Status('正在检查 Private 仓库并读取加密 manifest…');
    await v6PrivateCheck(c);
    await v6EnsureIds();
    await v6RefreshMeta();
    const meta=await v6ReadMeta();
    const remote=await v6LoadManifest(c);
    if(!remote.exists)throw new Error('云端还没有增量同步数据。请先在一台设备执行“增量加密同步”。');
    const m=remote.manifest,remoteRev=m.plans?.revision||null;

    if(remoteRev && meta.plansBaseRevision!==remoteRev && meta.plansDirty){
      const useCloud=confirm('检测到训练计划冲突：本机和云端都改过计划。\n\n确定：使用云端计划覆盖本机计划。\n取消：保留本机计划，本次同步停止。\n\n训练历史和身体数据不会因为这个选择被删除。');
      if(!useCloud)throw new Error('已取消同步，保留本机训练计划。');
    }

    let addedSessions=0,addedBody=0,plansPulled=false;
    const sessionMap=await v6MapByHash(state.sessions);
    for(const hash of m.sessions){
      if(sessionMap.has(hash))continue;
      const item=await v6DownloadImmutable(c,'sessions',hash);
      state.sessions.push(item);sessionMap.set(hash,item);addedSessions++;
    }

    const bodyMap=await v6MapByHash(state.body);
    for(const hash of m.body){
      if(bodyMap.has(hash))continue;
      const item=await v6DownloadImmutable(c,'body',hash);
      state.body.push(item);bodyMap.set(hash,item);addedBody++;
    }

    if(remoteRev && meta.plansBaseRevision!==remoteRev){
      state.plans=await v6DownloadPlans(c,m);
      meta.plansBaseRevision=remoteRev;
      meta.plansDirty=false;
      meta.plansSig=await v6JsonSig(state.plans);
      plansPulled=true;
    }

    v6ApplyingRemote=true;
    await v6BasePersist();
    v6ApplyingRemote=false;
    await v6WriteMeta(meta);

    renderAll();
    if(typeof v3Draft!=='undefined'){
      v3Draft={planIndex:v3CurrentPlanIndex(),sets:{},completed:{}};
      if(typeof v3RenderWorkout==='function')v3RenderWorkout();
    }
    v2Status(`合并完成：新增 ${addedSessions} 条训练、${addedBody} 条身体记录${plansPulled?'；训练计划已更新':''}。`,true);
  }catch(e){v6ApplyingRemote=false;v2Status(e.message,false);}
}

async function v6Remember(){
  const c=v6Cfg();
  v2SyncConfig={owner:c.owner,repo:c.repo};
  await idbSet('syncConfig',v2SyncConfig);
  v2Status('已在本机保存仓库地址；Token 和同步密码未保存。',true);
}

async function v6Init(){
  try{await v6RefreshMeta();}catch(e){console.warn(e);}
  const push=document.getElementById('pushSyncBtn');
  const pull=document.getElementById('pullSyncBtn');
  const remember=document.getElementById('rememberSyncBtn');
  if(push){push.textContent='增量加密同步';push.onclick=v6Push;}
  if(pull){pull.textContent='从云端合并';pull.onclick=v6Pull;}
  if(remember)remember.onclick=v6Remember;
}
window.addEventListener('load',()=>setTimeout(v6Init,240));
