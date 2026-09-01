/* v13 training context, history readability, and progress resilience.
 * - Quick plan pull also fetches missing/repaired workout history so previous reps are available.
 * - Workout cards show previous set performance as hints.
 * - Saving falls back to previous/default weight when reps are entered without retyping weight.
 * - History is rendered as readable session/exercise cards.
 * - Progress uses e1RM when weighted data exists, otherwise total reps (useful for bodyweight work).
 */

function v13Clone(x){return JSON.parse(JSON.stringify(x));}
function v13SessionDateValue(s){return String(s?.date||'');}
function v13LatestExercise(exName,planName=''){
  const sessions=[...state.sessions].sort((a,b)=>v13SessionDateValue(b).localeCompare(v13SessionDateValue(a)));
  const preferred=sessions.find(s=>s.plan===planName&&(s.exercises||[]).some(e=>e.name===exName));
  const session=preferred||sessions.find(s=>(s.exercises||[]).some(e=>e.name===exName));
  return session?.exercises?.find(e=>e.name===exName)||null;
}
function v13PreviousSet(exName,si,planName=''){
  const ex=v13LatestExercise(exName,planName);
  return ex?.sets?.[si]||null;
}
function v13SetText(set){
  if(!set)return '';
  const reps=set.reps!==null&&set.reps!==undefined?`${set.reps}次`:'';
  const weight=set.weight!==null&&set.weight!==undefined&&Number(set.weight)>0?`${set.weight}kg`:'';
  const main=weight&&reps?`${weight} × ${reps}`:(reps||weight||'');
  const rir=set.rir!==null&&set.rir!==undefined?` · RIR ${set.rir}`:'';
  return `${main}${rir}`;
}

function v13DecorateWorkout(){
  if(!state.plans.length)return;
  const pi=typeof v3CurrentPlanIndex==='function'?v3CurrentPlanIndex():0;
  const plan=state.plans[pi];
  if(!plan)return;
  (plan.exercises||[]).forEach((ex,ei)=>{
    const card=document.querySelector(`#workoutContainer .exercise-card[data-e="${ei}"]`);
    if(!card)return;
    const last=v13LatestExercise(ex.name,plan.name);
    const old=card.querySelector('.last-performance');
    if(old)old.remove();
    if(last?.sets?.length){
      const line=document.createElement('div');
      line.className='last-performance';
      line.textContent='上次：'+last.sets.map((s,i)=>`${i+1}组 ${v13SetText(s)}`).join(' ｜ ');
      const head=card.querySelector('.exercise-head');
      if(head)head.insertAdjacentElement('afterend',line);
    }
    card.querySelectorAll('.workout-set-row[data-s]').forEach(row=>{
      const si=Number(row.dataset.s);
      const prev=last?.sets?.[si]||null;
      const w=row.querySelector('input[data-k="weight"]');
      const r=row.querySelector('input[data-k="reps"]');
      const rir=row.querySelector('input[data-k="rir"]');
      const suggestedWeight=prev?.weight!==null&&prev?.weight!==undefined?prev.weight:ex.defaultWeight;
      if(w){
        if(w.value==='')w.placeholder=suggestedWeight??'';
        w.dataset.prevValue=suggestedWeight??'';
      }
      if(r){
        if(r.value==='')r.placeholder=prev?.reps??'';
        r.dataset.prevValue=prev?.reps??'';
      }
      if(rir){
        if(rir.value==='')rir.placeholder=prev?.rir??'1–2';
        rir.dataset.prevValue=prev?.rir??'';
      }
    });
  });
}

const v13BaseRenderWorkout=v3RenderWorkout;
v3RenderWorkout=function(){
  v13BaseRenderWorkout();
  v13DecorateWorkout();
};
renderWorkout=v3RenderWorkout;

async function v13SaveWorkout(){
  if(!state.plans.length)return;
  const pi=v3EnsureDraftPlan(),plan=state.plans[pi];
  v3CaptureDraft();
  const exercises=(plan.exercises||[]).map((ex,ei)=>{
    const sets=[];
    for(let si=0;si<Math.max(1,Number(ex.sets)||1);si++){
      const raw={
        weight:v3Draft.sets[v3DraftKey(ei,si,'weight')],
        reps:v3Draft.sets[v3DraftKey(ei,si,'reps')],
        rir:v3Draft.sets[v3DraftKey(ei,si,'rir')]
      };
      const completed=!!v3Draft.completed[v3DoneKey(ei,si)];
      const touched=Object.values(raw).some(v=>v!==''&&v!==undefined&&v!==null);
      if(!completed&&!touched)continue;
      const prev=v13PreviousSet(ex.name,si,plan.name);
      let weight=raw.weight===''||raw.weight===undefined||raw.weight===null?null:Number(raw.weight);
      let reps=raw.reps===''||raw.reps===undefined||raw.reps===null?null:Number(raw.reps);
      const rir=raw.rir===''||raw.rir===undefined||raw.rir===null?null:Number(raw.rir);
      if(weight===null&&(reps!==null||completed)){
        if(prev?.weight!==null&&prev?.weight!==undefined)weight=Number(prev.weight);
        else if(ex.defaultWeight!==null&&ex.defaultWeight!==undefined)weight=Number(ex.defaultWeight);
      }
      if(reps===null&&completed&&prev?.reps!==null&&prev?.reps!==undefined)reps=Number(prev.reps);
      sets.push({weight,reps,rir,completed});
    }
    return {name:ex.name,sets};
  }).filter(ex=>ex.sets.length);
  if(!exercises.length){alert('还没有输入训练数据。');return;}
  state.sessions.push({id:crypto.randomUUID(),date:isoDate(),plan:plan.name,exercises});
  await persist();
  renderHistory();renderProgressOptions();
  v3Draft={planIndex:pi,sets:{},completed:{}};
  if(typeof v7ClearDraft==='function')try{await v7ClearDraft(pi);}catch{}
  v3RenderWorkout();
  alert('已保存。');
}
v3SaveWorkout=v13SaveWorkout;

renderHistory=function(){
  const box=document.getElementById('historyList');
  const arr=[...state.sessions].sort((a,b)=>v13SessionDateValue(b).localeCompare(v13SessionDateValue(a)));
  if(!arr.length){box.innerHTML='<div class="empty">暂无训练记录</div>';return;}
  box.innerHTML=arr.map(s=>{
    const exercises=(s.exercises||[]).map(ex=>{
      const chips=(ex.sets||[]).map((set,i)=>{
        const txt=v13SetText(set)||'未记录';
        return `<span class="history-set-chip"><b>${i+1}</b> ${esc(txt)}</span>`;
      }).join('');
      return `<div class="history-exercise-block"><div class="history-exercise-name">${esc(ex.name)}</div><div class="history-set-list">${chips}</div></div>`;
    }).join('');
    const note=s.note?`<div class="history-session-note">${esc(s.note)}</div>`:'';
    return `<article class="history-session-card"><div class="history-session-head"><div class="history-session-date">${esc(s.date||'')}</div><span class="badge">${esc(s.plan||'训练')}</span></div>${exercises}${note}</article>`;
  }).join('');
};

function v13ExerciseHistory(name){
  return [...state.sessions]
    .sort((a,b)=>v13SessionDateValue(a).localeCompare(v13SessionDateValue(b)))
    .map(s=>({date:s.date,ex:(s.exercises||[]).find(e=>e.name===name)}))
    .filter(x=>x.ex);
}

drawProgress=function(){
  const select=document.getElementById('progressExercise');
  const name=select?.value||'';
  const history=v13ExerciseHistory(name);
  const hasPositiveWeight=history.some(h=>(h.ex.sets||[]).some(s=>Number(s.weight)>0&&Number(s.reps)>0));
  const points=[];
  history.forEach(h=>{
    const sets=(h.ex.sets||[]).filter(s=>Number(s.reps)>0);
    if(!sets.length)return;
    if(hasPositiveWeight){
      let best=null;
      sets.forEach(s=>{
        const w=Number(s.weight),r=Number(s.reps);
        if(w>0&&r>0){const e=w*(1+r/30);if(best===null||e>best)best=e;}
      });
      if(best!==null)points.push({date:h.date,value:best});
    }else{
      points.push({date:h.date,value:sets.reduce((sum,s)=>sum+Number(s.reps||0),0)});
    }
  });

  const canvas=document.getElementById('progressChart'),summary=document.getElementById('progressSummary');
  if(!canvas||!summary)return;
  const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height,p=48;
  ctx.clearRect(0,0,W,H);
  ctx.strokeStyle='#d1d5db';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(p,p);ctx.lineTo(p,H-p);ctx.lineTo(W-p,H-p);ctx.stroke();
  if(!points.length){
    ctx.fillStyle='#6b7280';ctx.font='24px system-ui';ctx.fillText('暂无可计算数据',W/2-84,H/2);
    summary.textContent=history.length?'已有训练次数记录，但当前没有足够的重量/次数组合用于计算。':'';
    return;
  }
  const vals=points.map(x=>x.value);
  let min=Math.min(...vals),max=Math.max(...vals);
  if(min===max){const pad=Math.max(1,Math.abs(min)*0.08);min-=pad;max+=pad;}else{const pad=(max-min)*0.1;min-=pad;max+=pad;}
  const x=i=>p+(W-2*p)*(points.length===1?0.5:i/(points.length-1));
  const y=v=>(H-p)-(H-2*p)*((v-min)/(max-min||1));
  ctx.strokeStyle='#111827';ctx.lineWidth=3;ctx.beginPath();
  points.forEach((pt,i)=>{const X=x(i),Y=y(pt.value);i?ctx.lineTo(X,Y):ctx.moveTo(X,Y);});ctx.stroke();
  ctx.fillStyle='#111827';
  points.forEach((pt,i)=>{ctx.beginPath();ctx.arc(x(i),y(pt.value),6,0,Math.PI*2);ctx.fill();});
  const metric=hasPositiveWeight?'估算 1RM':'总次数';
  const unit=hasPositiveWeight?' kg':' 次';
  if(points.length===1){
    summary.textContent=`${name}：目前只有 1 次有效记录，${metric} ${points[0].value.toFixed(hasPositiveWeight?1:0)}${unit}。再积累训练后会形成趋势。`;
  }else{
    const first=points[0],last=points.at(-1);
    summary.textContent=`${name}：${metric}从 ${first.value.toFixed(hasPositiveWeight?1:0)}${unit} 到 ${last.value.toFixed(hasPositiveWeight?1:0)}${unit}。`;
  }
};

function v13SessionRichness(s){
  let score=0;
  (s?.exercises||[]).forEach(ex=>(ex.sets||[]).forEach(set=>{
    if(set.weight!==null&&set.weight!==undefined)score+=2;
    if(set.reps!==null&&set.reps!==undefined)score+=2;
    if(set.rir!==null&&set.rir!==undefined)score+=1;
    if(set.completed)score+=0.25;
  }));
  return score;
}
function v13NeedsRepair(s){
  return (s?.exercises||[]).some(ex=>(ex.sets||[]).some(set=>set.reps!==null&&set.reps!==undefined&&(set.weight===null||set.weight===undefined)));
}
async function v13SessionHashIndex(){
  const map=new Map();
  for(let i=0;i<state.sessions.length;i++){
    const s=state.sessions[i];
    if(!s.id)continue;
    map.set(await v11ItemHash(s.id),i);
  }
  return map;
}
async function v13MergeRemoteSessions(c,m){
  let added=0,repaired=0;
  const index=await v13SessionHashIndex();
  for(const hash of m.sessions||[]){
    if(!index.has(hash)){
      const remote=await v11DownloadImmutable(c,'sessions',hash);
      state.sessions.push(remote);index.set(hash,state.sessions.length-1);added++;continue;
    }
    const i=index.get(hash),local=state.sessions[i];
    if(!v13NeedsRepair(local))continue;
    const remote=await v11DownloadImmutable(c,'sessions',hash);
    if(v13SessionRichness(remote)>v13SessionRichness(local)){
      state.sessions[i]=remote;repaired++;
    }
  }
  return {added,repaired};
}

async function v13PullTrainingContext(){
  const c=v11Cfg();
  try{
    if(typeof v7SaveCredentials==='function')await v7SaveCredentials(false);
    v12TodayStatus('正在拉取最新计划和上次训练…');
    await v11PrivateCheck(c);
    await v11EnsureIds();
    await v11RefreshMeta();
    const meta=await v11ReadMeta();
    const remote=await v11LoadManifest(c);
    if(!remote.exists)throw new Error('GitHub 还没有同步数据。');
    const m=remote.manifest,remoteRev=m.plans?.revision||null;

    const oldIndex=typeof v3CurrentPlanIndex==='function'?v3CurrentPlanIndex():0;
    const oldName=state.plans[oldIndex]?.name||'';
    if(typeof v3CaptureDraft==='function')v3CaptureDraft();
    const savedDraft=typeof v3Draft!=='undefined'?v13Clone(v3Draft):null;
    let plansPulled=false;

    if(remoteRev&&meta.plansBaseRevision!==remoteRev){
      if(typeof v12HasWorkoutDraft==='function'&&v12HasWorkoutDraft()){
        throw new Error('当前还有未保存的训练输入。请先保存本次训练或清空输入，再更新训练计划。');
      }
      if(meta.plansDirty){
        const useCloud=confirm('本机训练计划也有修改。继续会使用 GitHub 最新计划覆盖本机计划；训练历史不会删除。继续？');
        if(!useCloud){v12TodayStatus('已取消，保留本机训练计划。',false);return false;}
      }
      state.plans=await v11DownloadPlans(c,m);
      meta.plansBaseRevision=remoteRev;
      meta.plansDirty=false;
      meta.plansSig=await v11JsonSig(state.plans);
      plansPulled=true;
    }

    const merged=await v13MergeRemoteSessions(c,m);
    v11ApplyingRemote=true;
    await v11BasePersist();
    v11ApplyingRemote=false;
    await v11WriteMeta(meta);

    renderAll();
    let nextIndex=state.plans.findIndex(p=>p.name===oldName);
    if(nextIndex<0)nextIndex=0;
    const sel=document.getElementById('planSelect');
    if(sel&&!sel.disabled)sel.value=String(nextIndex);
    if(typeof v3Draft!=='undefined'){
      v3Draft=plansPulled?{planIndex:nextIndex,sets:{},completed:{}}:(savedDraft||{planIndex:nextIndex,sets:{},completed:{}});
      v3Draft.planIndex=nextIndex;
      v3RenderWorkout();
    }
    try{await idbSet('workoutActivePlanV7',nextIndex);}catch{}
    renderHistory();renderProgressOptions();
    const parts=[];
    if(plansPulled)parts.push('计划已更新');
    if(merged.added)parts.push(`新增 ${merged.added} 条训练`);
    if(merged.repaired)parts.push(`修复 ${merged.repaired} 条训练记录`);
    v12TodayStatus(parts.length?parts.join('；')+'。':'训练计划和训练记录已经是最新。',true);
    return true;
  }catch(e){
    v11ApplyingRemote=false;
    v12TodayStatus(e.message,false);
    return false;
  }
}

v12PullPlansOnly=v13PullTrainingContext;

window.addEventListener('load',()=>setTimeout(()=>{
  const save=document.getElementById('saveWorkoutBtn');
  if(save)save.onclick=v13SaveWorkout;
  renderHistory();
  if(document.getElementById('progressExercise'))drawProgress();
  v13DecorateWorkout();
},620));
