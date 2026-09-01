/* v6 incremental encrypted sync.
 * Remote private repository layout:
 *   manifest.enc.json         encrypted manifest only
 *   plans.enc.json            encrypted current plans
 *   body.enc.json             encrypted current body log
 *   sessions/<sha256(uuid)>.enc.json  one immutable encrypted workout session
 */
let v6ApplyingRemote = false;
const v6BasePersist = persist;

async function v6HexDigest(text){
  const buf = await crypto.subtle.digest('SHA-256', v2TE.encode(String(text)));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
async function v6JsonSig(value){ return v6HexDigest(JSON.stringify(value)); }
async function v6SessionHash(id){ return v6HexDigest(id); }
function v6Now(){ return new Date().toISOString(); }
function v6TimeMs(s){ const n=Date.parse(s||''); return Number.isFinite(n)?n:0; }

async function v6ReadLocalMeta(){
  return await idbGet('syncMetaV6') || {};
}
async function v6WriteLocalMeta(meta){
  await idbSet('syncMetaV6', meta);
  return meta;
}
async function v6RefreshLocalMeta(){
  if(!db) return {};
  const meta=await v6ReadLocalMeta();
  const now=v6Now();
  const plansSig=await v6JsonSig(state.plans);
  const bodySig=await v6JsonSig(state.body);
  if(!meta.plansSig){meta.plansSig=plansSig;meta.plansUpdatedAt=now;}
  else if(!v6ApplyingRemote && meta.plansSig!==plansSig){meta.plansSig=plansSig;meta.plansUpdatedAt=now;}
  if(!meta.bodySig){meta.bodySig=bodySig;meta.bodyUpdatedAt=now;}
  else if(!v6ApplyingRemote && meta.bodySig!==bodySig){meta.bodySig=bodySig;meta.bodyUpdatedAt=now;}
  return v6WriteLocalMeta(meta);
}

persist = async function(){
  await v6BasePersist();
  try{ await v6RefreshLocalMeta(); }catch(e){ console.warn('sync metadata update failed',e); }
};

function v6Cfg(){
  return {
    owner: document.getElementById('syncOwner').value.trim(),
    repo: document.getElementById('syncRepo').value.trim(),
    token: document.getElementById('syncToken').value.trim(),
    password: document.getElementById('syncPassword').value
  };
}
function v6FileUrl(c,path){
  return `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
}
async function v6GetRemoteFile(c,path){
  const r=await v2Gh(v6FileUrl(c,path),c.token);
  if(!r.data) return null;
  const text=v2TD.decode(v2Unb64(r.data.content));
  return {sha:r.data.sha, env:JSON.parse(text)};
}
async function v6PutRemoteFile(c,path,env,sha=null,message='Update encrypted fitness data'){
  const body={message,content:v2B64(v2TE.encode(JSON.stringify(env,null,2)))};
  if(sha) body.sha=sha;
  return v2Gh(v6FileUrl(c,path),c.token,{method:'PUT',body:JSON.stringify(body)});
}
function v6EmptyManifest(){
  return {
    format:'fitness-pwa-manifest-v1',
    updatedAt:v6Now(),
    plans:{path:'plans.enc.json',updatedAt:null},
    body:{path:'body.enc.json',updatedAt:null},
    sessions:[]
  };
}
function v6ValidateManifest(m){
  if(!m || m.format!=='fitness-pwa-manifest-v1') throw new Error('云端 manifest 格式不支持');
  if(!Array.isArray(m.sessions)) m.sessions=[];
  if(!m.plans) m.plans={path:'plans.enc.json',updatedAt:null};
  if(!m.body) m.body={path:'body.enc.json',updatedAt:null};
  return m;
}
async function v6LoadManifest(c){
  const f=await v6GetRemoteFile(c,'manifest.enc.json');
  if(!f) return {manifest:v6EmptyManifest(),sha:null,exists:false};
  const m=v6ValidateManifest(await v2Decrypt(f.env,c.password));
  return {manifest:m,sha:f.sha,exists:true};
}
async function v6SaveManifest(c,manifest,sha){
  manifest.updatedAt=v6Now();
  const env=await v2Encrypt(manifest,c.password);
  await v6PutRemoteFile(c,'manifest.enc.json',env,sha,'Update encrypted fitness manifest');
}
async function v6PrivateCheck(c){
  if(!c.owner||!c.repo||!c.token||!c.password) throw new Error('请填写用户名、Private 仓库、Token 和同步密码。');
  await v2PrivateRepo(c);
}

async function v6EnsureSessionIds(){
  let changed=false;
  for(const s of state.sessions){
    if(!s.id){s.id=crypto.randomUUID();changed=true;}
  }
  if(changed) await persist();
}
async function v6LocalSessionMap(){
  await v6EnsureSessionIds();
  const map=new Map();
  for(const s of state.sessions){ map.set(await v6SessionHash(s.id),s); }
  return map;
}

async function v6UploadPlans(c,meta,manifest){
  const path='plans.enc.json';
  const old=await v6GetRemoteFile(c,path);
  const payload={format:'fitness-plans-v1',updatedAt:meta.plansUpdatedAt,plans:state.plans};
  await v6PutRemoteFile(c,path,await v2Encrypt(payload,c.password),old?.sha||null,'Update encrypted training plans');
  manifest.plans={path,updatedAt:meta.plansUpdatedAt};
}
async function v6UploadBody(c,meta,manifest){
  const path='body.enc.json';
  const old=await v6GetRemoteFile(c,path);
  const payload={format:'fitness-body-v1',updatedAt:meta.bodyUpdatedAt,body:state.body};
  await v6PutRemoteFile(c,path,await v2Encrypt(payload,c.password),old?.sha||null,'Update encrypted body data');
  manifest.body={path,updatedAt:meta.bodyUpdatedAt};
}
async function v6DownloadPlans(c,manifest){
  const path=manifest.plans?.path||'plans.enc.json';
  const f=await v6GetRemoteFile(c,path); if(!f) throw new Error('云端计划文件缺失');
  const p=await v2Decrypt(f.env,c.password);
  if(p?.format!=='fitness-plans-v1'||!Array.isArray(p.plans)) throw new Error('云端计划数据无效');
  return p;
}
async function v6DownloadBody(c,manifest){
  const path=manifest.body?.path||'body.enc.json';
  const f=await v6GetRemoteFile(c,path); if(!f) throw new Error('云端身体数据文件缺失');
  const p=await v2Decrypt(f.env,c.password);
  if(p?.format!=='fitness-body-v1'||!Array.isArray(p.body)) throw new Error('云端身体数据无效');
  return p;
}

async function v6Push(){
  const c=v6Cfg();
  try{
    v2Status('正在检查 Private 仓库…');
    await v6PrivateCheck(c);
    await v6RefreshLocalMeta();
    const meta=await v6ReadLocalMeta();
    const remote=await v6LoadManifest(c),m=remote.manifest;

    if(v6TimeMs(m.plans?.updatedAt)>v6TimeMs(meta.plansUpdatedAt))
      throw new Error('云端训练计划比本机新，请先点“从云端合并”。');
    if(v6TimeMs(m.body?.updatedAt)>v6TimeMs(meta.bodyUpdatedAt))
      throw new Error('云端身体数据比本机新，请先点“从云端合并”。');

    v2Status('正在增量加密训练记录…');
    const local=await v6LocalSessionMap();
    const remoteSet=new Set(m.sessions||[]);
    let added=0;
    for(const [hash,session] of local){
      if(remoteSet.has(hash)) continue;
      const path=`sessions/${hash}.enc.json`;
      const payload={format:'fitness-session-v1',session};
      await v6PutRemoteFile(c,path,await v2Encrypt(payload,c.password),null,'Add encrypted workout session');
      remoteSet.add(hash);added++;
    }
    m.sessions=[...remoteSet].sort();

    const remotePlansTime=v6TimeMs(m.plans?.updatedAt);
    const localPlansTime=v6TimeMs(meta.plansUpdatedAt);
    if(!m.plans?.updatedAt || localPlansTime>=remotePlansTime) await v6UploadPlans(c,meta,m);

    const remoteBodyTime=v6TimeMs(m.body?.updatedAt);
    const localBodyTime=v6TimeMs(meta.bodyUpdatedAt);
    if(!m.body?.updatedAt || localBodyTime>=remoteBodyTime) await v6UploadBody(c,meta,m);

    await v6SaveManifest(c,m,remote.sha);
    v2Status(`同步完成：新增 ${added} 条训练记录。计划和身体数据已加密更新。`,true);
  }catch(e){v2Status(e.message,false);}
}

async function v6Pull(){
  const c=v6Cfg();
  try{
    v2Status('正在检查 Private 仓库并读取加密 manifest…');
    await v6PrivateCheck(c);
    await v6RefreshLocalMeta();
    const meta=await v6ReadLocalMeta();
    const remote=await v6LoadManifest(c);
    if(!remote.exists) throw new Error('云端还没有增量同步数据。请先在一台设备执行“增量加密同步”。');
    const m=remote.manifest;

    const localMap=await v6LocalSessionMap();
    let added=0;
    for(const hash of m.sessions){
      if(localMap.has(hash)) continue;
      const f=await v6GetRemoteFile(c,`sessions/${hash}.enc.json`);
      if(!f) throw new Error(`云端训练记录文件缺失：${hash.slice(0,8)}…`);
      const p=await v2Decrypt(f.env,c.password);
      if(p?.format!=='fitness-session-v1'||!p.session?.id) throw new Error('云端训练记录格式无效');
      const actual=await v6SessionHash(p.session.id);
      if(actual!==hash) throw new Error('训练记录完整性检查失败');
      state.sessions.push(p.session);localMap.set(hash,p.session);added++;
    }

    let plansPulled=false,bodyPulled=false;
    if(m.plans?.updatedAt && v6TimeMs(m.plans.updatedAt)>v6TimeMs(meta.plansUpdatedAt)){
      const p=await v6DownloadPlans(c,m);state.plans=p.plans;plansPulled=true;
    }
    if(m.body?.updatedAt && v6TimeMs(m.body.updatedAt)>v6TimeMs(meta.bodyUpdatedAt)){
      const p=await v6DownloadBody(c,m);state.body=p.body;bodyPulled=true;
    }

    v6ApplyingRemote=true;
    await v6BasePersist();
    v6ApplyingRemote=false;

    const next=await v6ReadLocalMeta();
    next.plansSig=await v6JsonSig(state.plans);
    next.bodySig=await v6JsonSig(state.body);
    if(plansPulled) next.plansUpdatedAt=m.plans.updatedAt;
    else if(!next.plansUpdatedAt) next.plansUpdatedAt=meta.plansUpdatedAt||v6Now();
    if(bodyPulled) next.bodyUpdatedAt=m.body.updatedAt;
    else if(!next.bodyUpdatedAt) next.bodyUpdatedAt=meta.bodyUpdatedAt||v6Now();
    await v6WriteLocalMeta(next);

    renderAll();
    if(typeof v3Draft!=='undefined'){
      v3Draft={planIndex:v3CurrentPlanIndex(),sets:{},completed:{}};
      if(typeof v3RenderWorkout==='function') v3RenderWorkout();
    }
    v2Status(`合并完成：新增 ${added} 条训练记录${plansPulled?'；训练计划已更新':''}${bodyPulled?'；身体数据已更新':''}。`,true);
  }catch(e){v6ApplyingRemote=false;v2Status(e.message,false);}
}

async function v6Remember(){
  const c=v6Cfg();
  v2SyncConfig={owner:c.owner,repo:c.repo};
  await idbSet('syncConfig',v2SyncConfig);
  v2Status('已在本机保存仓库地址；Token 和同步密码未保存。',true);
}

async function v6Init(){
  try{await v6RefreshLocalMeta();}catch(e){console.warn(e);}
  const push=document.getElementById('pushSyncBtn');
  const pull=document.getElementById('pullSyncBtn');
  const remember=document.getElementById('rememberSyncBtn');
  if(push){push.textContent='增量加密同步';push.onclick=v6Push;}
  if(pull){pull.textContent='从云端合并';pull.onclick=v6Pull;}
  if(remember) remember.onclick=v6Remember;
}
window.addEventListener('load',()=>setTimeout(v6Init,240));
