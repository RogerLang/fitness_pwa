/* v14 cleanup and chart polish.
 * - Removes only clearly inferior duplicate local sessions (same date/plan/reps, but missing weights).
 * - Keeps quick/full pull followed by the same conservative cleanup.
 * - Draws labeled x/y axes and ticks on the progress chart.
 */

function v14ExerciseMap(session){
  const m=new Map();
  for(const ex of session?.exercises||[]) if(ex?.name) m.set(ex.name,ex);
  return m;
}
function v14RepVector(ex){
  return (ex?.sets||[]).map(s=>s?.reps===null||s?.reps===undefined?'_':String(s.reps)).join(',');
}
function v14DuplicatePreference(a,b){
  if(!a||!b||a.date!==b.date||a.plan!==b.plan)return 0;
  const am=v14ExerciseMap(a),bm=v14ExerciseMap(b);
  const common=[...am.keys()].filter(k=>bm.has(k));
  const needed=Math.max(3,Math.min(am.size,bm.size)-1);
  if(common.length<needed)return 0;

  let comparable=0,aRepair=0,bRepair=0;
  for(const name of common){
    const ae=am.get(name),be=bm.get(name);
    const ar=v14RepVector(ae),br=v14RepVector(be);
    if(!ar||!br||ar.replaceAll('_','')===''||br.replaceAll('_','')==='')continue;
    comparable++;
    if(ar!==br)return 0;
    const n=Math.min(ae.sets?.length||0,be.sets?.length||0);
    for(let i=0;i<n;i++){
      const as=ae.sets[i]||{},bs=be.sets[i]||{};
      if(as.reps===null||as.reps===undefined||bs.reps===null||bs.reps===undefined)continue;
      const aw=as.weight,bw=bs.weight;
      if((aw===null||aw===undefined)&&bw!==null&&bw!==undefined&&Number(bw)>0)aRepair++;
      if((bw===null||bw===undefined)&&aw!==null&&aw!==undefined&&Number(aw)>0)bRepair++;
    }
  }
  if(comparable<3)return 0;
  const ar=typeof v13SessionRichness==='function'?v13SessionRichness(a):0;
  const br=typeof v13SessionRichness==='function'?v13SessionRichness(b):0;
  if(aRepair>=2&&aRepair>bRepair&&br>ar)return -1;
  if(bRepair>=2&&bRepair>aRepair&&ar>br)return 1;
  return 0;
}

async function v14CleanupDuplicateSessions(){
  if(!Array.isArray(state.sessions)||state.sessions.length<2)return 0;
  const remove=new Set();
  for(let i=0;i<state.sessions.length;i++){
    if(remove.has(i))continue;
    for(let j=i+1;j<state.sessions.length;j++){
      if(remove.has(j))continue;
      const pref=v14DuplicatePreference(state.sessions[i],state.sessions[j]);
      if(pref<0){remove.add(i);break;}
      if(pref>0)remove.add(j);
    }
  }
  if(!remove.size)return 0;
  state.sessions=state.sessions.filter((_,i)=>!remove.has(i));
  if(typeof v11BasePersist==='function')await v11BasePersist();
  else await persist();
  renderHistory();
  renderProgressOptions();
  if(typeof v3RenderWorkout==='function')v3RenderWorkout();
  return remove.size;
}

if(typeof v12PullPlansOnly==='function'){
  const v14BaseQuickPull=v12PullPlansOnly;
  v12PullPlansOnly=async function(){
    const ok=await v14BaseQuickPull();
    if(ok){
      const removed=await v14CleanupDuplicateSessions();
      if(removed&&typeof v12TodayStatus==='function')v12TodayStatus(`已更新，并清理 ${removed} 条旧重复记录。`,true);
    }
    return ok;
  };
}

const v14BaseFullPull=typeof v11Pull==='function'?v11Pull:null;
async function v14FullPull(){
  if(!v14BaseFullPull)return;
  await v14BaseFullPull();
  const removed=await v14CleanupDuplicateSessions();
  if(removed&&typeof v2Status==='function')v2Status(`合并完成，并清理 ${removed} 条旧重复记录。`,true);
}

function v14ProgressData(name){
  const history=typeof v13ExerciseHistory==='function'?v13ExerciseHistory(name):[];
  const weighted=history.some(h=>(h.ex?.sets||[]).some(s=>Number(s.weight)>0&&Number(s.reps)>0));
  const points=[];
  for(const h of history){
    const sets=(h.ex?.sets||[]).filter(s=>Number(s.reps)>0);
    if(!sets.length)continue;
    if(weighted){
      let best=null;
      for(const s of sets){
        const w=Number(s.weight),r=Number(s.reps);
        if(w>0&&r>0){const e=w*(1+r/30);if(best===null||e>best)best=e;}
      }
      if(best!==null)points.push({date:h.date,value:best});
    }else{
      points.push({date:h.date,value:sets.reduce((sum,s)=>sum+Number(s.reps||0),0)});
    }
  }
  return {history,weighted,points};
}
function v14ShortDate(d){
  const s=String(d||'');
  return /^\d{4}-\d{2}-\d{2}$/.test(s)?s.slice(5):s;
}

drawProgress=function(){
  const select=document.getElementById('progressExercise');
  const name=select?.value||'';
  const {history,weighted,points}=v14ProgressData(name);
  const canvas=document.getElementById('progressChart'),summary=document.getElementById('progressSummary');
  if(!canvas||!summary)return;
  const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height;
  const L=78,R=24,T=28,B=66;
  const plotW=W-L-R,plotH=H-T-B;
  ctx.clearRect(0,0,W,H);
  ctx.font='14px system-ui';
  ctx.textBaseline='middle';

  if(!points.length){
    ctx.strokeStyle='#d1d5db';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(L,T);ctx.lineTo(L,H-B);ctx.lineTo(W-R,H-B);ctx.stroke();
    ctx.fillStyle='#6b7280';ctx.textAlign='center';ctx.font='24px system-ui';ctx.fillText('暂无可计算数据',L+plotW/2,T+plotH/2);
    summary.textContent=history.length?'已有训练次数记录，但当前没有足够的重量/次数组合用于计算。':'';
    return;
  }

  const vals=points.map(p=>p.value);
  let min=Math.min(...vals),max=Math.max(...vals);
  if(min===max){const pad=Math.max(1,Math.abs(min)*0.12);min-=pad;max+=pad;}
  else{const pad=(max-min)*0.12;min-=pad;max+=pad;}
  if(!weighted)min=Math.max(0,min);
  const x=i=>L+plotW*(points.length===1?0.5:i/(points.length-1));
  const y=v=>T+plotH*(1-(v-min)/(max-min||1));

  const yTicks=4;
  ctx.textAlign='right';ctx.font='13px system-ui';
  for(let i=0;i<=yTicks;i++){
    const value=min+(max-min)*i/yTicks;
    const yy=y(value);
    ctx.strokeStyle='#eef0f3';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(L,yy);ctx.lineTo(W-R,yy);ctx.stroke();
    ctx.fillStyle='#6b7280';
    ctx.fillText(weighted?value.toFixed(1):Math.round(value).toString(),L-10,yy);
  }

  ctx.strokeStyle='#cbd0d8';ctx.lineWidth=1.5;
  ctx.beginPath();ctx.moveTo(L,T);ctx.lineTo(L,H-B);ctx.lineTo(W-R,H-B);ctx.stroke();

  const tickIndices=[];
  const maxXTicks=Math.min(5,points.length);
  if(points.length===1)tickIndices.push(0);
  else for(let i=0;i<maxXTicks;i++)tickIndices.push(Math.round(i*(points.length-1)/(maxXTicks-1)));
  [...new Set(tickIndices)].forEach(i=>{
    const xx=x(i);
    ctx.strokeStyle='#cbd0d8';ctx.beginPath();ctx.moveTo(xx,H-B);ctx.lineTo(xx,H-B+5);ctx.stroke();
    ctx.fillStyle='#6b7280';ctx.textAlign='center';ctx.font='13px system-ui';ctx.fillText(v14ShortDate(points[i].date),xx,H-B+20);
  });

  ctx.fillStyle='#4b5563';ctx.textAlign='center';ctx.font='13px system-ui';
  ctx.fillText('日期',L+plotW/2,H-14);
  ctx.save();ctx.translate(18,T+plotH/2);ctx.rotate(-Math.PI/2);
  ctx.fillText(weighted?'估算 1RM (kg)':'总次数',0,0);ctx.restore();

  ctx.strokeStyle='#111827';ctx.lineWidth=3;ctx.beginPath();
  points.forEach((p,i)=>{const xx=x(i),yy=y(p.value);i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);});ctx.stroke();
  ctx.fillStyle='#111827';
  points.forEach((p,i)=>{ctx.beginPath();ctx.arc(x(i),y(p.value),6,0,Math.PI*2);ctx.fill();});

  const metric=weighted?'估算 1RM':'总次数',unit=weighted?' kg':' 次';
  if(points.length===1)summary.textContent=`${name}：目前只有 1 次有效记录，${metric} ${points[0].value.toFixed(weighted?1:0)}${unit}。再积累训练后会形成趋势。`;
  else summary.textContent=`${name}：${metric}从 ${points[0].value.toFixed(weighted?1:0)}${unit} 到 ${points.at(-1).value.toFixed(weighted?1:0)}${unit}。`;
};

window.addEventListener('load',()=>setTimeout(async()=>{
  const removed=await v14CleanupDuplicateSessions();
  if(removed&&typeof v12TodayStatus==='function')v12TodayStatus(`已自动清理 ${removed} 条旧重复训练记录。`,true);
  const pull=document.getElementById('pullSyncBtn');
  if(pull&&v14BaseFullPull)pull.onclick=v14FullPull;
  document.querySelectorAll('#workoutContainer .suggestion').forEach(el=>el.remove());
  if(document.getElementById('progressExercise'))drawProgress();
},780));
