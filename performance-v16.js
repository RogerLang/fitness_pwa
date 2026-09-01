/* v16 UI/performance layer.
 * - History renders 20 sessions at a time and only when the History page is opened.
 * - Progress is calculated only on the Progress page and supports 3m/6m/1y/all ranges.
 * - Training page stays behind a boot placeholder until local plan/draft state has been restored.
 */
let v16HistoryLimit=20;
let v16ProgressRange='1y';
let v16TodayRevealed=false;

function v16DateValue(s){return String(s?.date||'');}
function v16SetCompact(set){
  if(!set)return '未记录';
  const w=set.weight!==null&&set.weight!==undefined&&Number(set.weight)>0?`${set.weight}kg`:'';
  const r=set.reps!==null&&set.reps!==undefined?`${set.reps}次`:'';
  const rir=set.rir!==null&&set.rir!==undefined?` R${set.rir}`:'';
  return `${w&&r?`${w}×${set.reps}`:(r||w||'未记录')}${rir}`;
}

function v16HistoryCard(session){
  const exercises=(session.exercises||[]).map(ex=>{
    const sets=(ex.sets||[]).map((set,i)=>`<span class="v16-set-chip"><b>${i+1}</b>${esc(v16SetCompact(set))}</span>`).join('');
    return `<div class="v16-history-ex"><div class="v16-history-name">${esc(ex.name)}</div><div class="v16-history-sets">${sets}</div></div>`;
  }).join('');
  const note=session.note?`<div class="v16-history-note">${esc(session.note)}</div>`:'';
  return `<article class="v16-history-card"><div class="v16-history-head"><strong>${esc(session.date||'')}</strong><span class="badge">${esc(session.plan||'训练')}</span></div>${exercises}${note}</article>`;
}

function v16RenderHistory(){
  const box=document.getElementById('historyList');
  if(!box)return;
  const arr=[...state.sessions].sort((a,b)=>v16DateValue(b).localeCompare(v16DateValue(a)));
  if(!arr.length){box.innerHTML='<div class="empty">暂无训练记录</div>';return;}
  const shown=arr.slice(0,v16HistoryLimit);
  box.innerHTML=shown.map(v16HistoryCard).join('')+
    (shown.length<arr.length?`<div class="v16-more-row"><button id="v16LoadMore" class="secondary">加载更多（${shown.length}/${arr.length}）</button></div>`:'');
  const more=document.getElementById('v16LoadMore');
  if(more)more.onclick=()=>{v16HistoryLimit+=20;v16RenderHistory();};
}

renderHistory=function(){
  const page=document.getElementById('history');
  const box=document.getElementById('historyList');
  if(!page||!box)return;
  if(!page.classList.contains('active')){box.innerHTML='';return;}
  v16RenderHistory();
};

function v16RangeCutoff(){
  if(v16ProgressRange==='all')return null;
  const d=new Date();
  if(v16ProgressRange==='3m')d.setMonth(d.getMonth()-3);
  else if(v16ProgressRange==='6m')d.setMonth(d.getMonth()-6);
  else d.setFullYear(d.getFullYear()-1);
  d.setHours(0,0,0,0);
  return d;
}
function v16WithinRange(date){
  const cutoff=v16RangeCutoff();
  if(!cutoff)return true;
  const d=new Date(`${String(date)}T00:00:00`);
  return !Number.isNaN(d.getTime())&&d>=cutoff;
}
function v16ExerciseHistory(name){
  return [...state.sessions]
    .filter(s=>v16WithinRange(s.date))
    .sort((a,b)=>v16DateValue(a).localeCompare(v16DateValue(b)))
    .map(s=>({date:s.date,ex:(s.exercises||[]).find(e=>e.name===name)}))
    .filter(x=>x.ex);
}
function v16ProgressData(name){
  const history=v16ExerciseHistory(name);
  const weighted=history.some(h=>(h.ex.sets||[]).some(s=>Number(s.weight)>0&&Number(s.reps)>0));
  const points=[];
  for(const h of history){
    const sets=(h.ex.sets||[]).filter(s=>Number(s.reps)>0);
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
function v16ShortDate(d){
  const s=String(d||'');
  return /^\d{4}-\d{2}-\d{2}$/.test(s)?s.slice(5):s;
}
function v16RangeLabel(){return ({'3m':'近 3 个月','6m':'近 6 个月','1y':'近 1 年','all':'全部'})[v16ProgressRange]||'近 1 年';}

function v16SyncRangeButtons(){
  document.querySelectorAll('#progressRange .v16-range-btn').forEach(btn=>{
    btn.classList.toggle('active',btn.dataset.range===v16ProgressRange);
  });
}
function v16BindRangeButtons(){
  document.querySelectorAll('#progressRange .v16-range-btn').forEach(btn=>{
    btn.onclick=()=>{
      v16ProgressRange=btn.dataset.range||'1y';
      v16SyncRangeButtons();
      if(document.getElementById('progress')?.classList.contains('active'))drawProgress();
    };
  });
  v16SyncRangeButtons();
}

renderProgressOptions=function(){
  const sel=document.getElementById('progressExercise');
  if(!sel)return;
  const old=sel.value;
  const names=typeof allExerciseNames==='function'?allExerciseNames():[];
  sel.innerHTML=names.map(n=>`<option>${esc(n)}</option>`).join('');
  if([...sel.options].some(o=>o.value===old))sel.value=old;
  if(document.getElementById('progress')?.classList.contains('active'))drawProgress();
};

drawProgress=function(){
  if(!document.getElementById('progress')?.classList.contains('active'))return;
  const select=document.getElementById('progressExercise');
  const name=select?.value||'';
  const {history,weighted,points}=v16ProgressData(name);
  const canvas=document.getElementById('progressChart'),summary=document.getElementById('progressSummary');
  if(!canvas||!summary)return;
  const ctx=canvas.getContext('2d'),W=canvas.width,H=canvas.height;
  const L=78,R=24,T=28,B=66,plotW=W-L-R,plotH=H-T-B;
  ctx.clearRect(0,0,W,H);
  ctx.font='14px system-ui';ctx.textBaseline='middle';

  if(!points.length){
    ctx.strokeStyle='#d1d5db';ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(L,T);ctx.lineTo(L,H-B);ctx.lineTo(W-R,H-B);ctx.stroke();
    ctx.fillStyle='#6b7280';ctx.textAlign='center';ctx.font='22px system-ui';ctx.fillText('该时间范围暂无可计算数据',L+plotW/2,T+plotH/2);
    summary.textContent=history.length?`${v16RangeLabel()}内已有记录，但缺少可计算的重量/次数组合。`:`${v16RangeLabel()}内暂无该动作记录。`;
    return;
  }

  const vals=points.map(p=>p.value);
  let min=Math.min(...vals),max=Math.max(...vals);
  if(min===max){const pad=Math.max(1,Math.abs(min)*0.12);min-=pad;max+=pad;}
  else{const pad=(max-min)*0.12;min-=pad;max+=pad;}
  if(!weighted)min=Math.max(0,min);
  const x=i=>L+plotW*(points.length===1?0.5:i/(points.length-1));
  const y=v=>T+plotH*(1-(v-min)/(max-min||1));

  ctx.textAlign='right';ctx.font='13px system-ui';
  for(let i=0;i<=4;i++){
    const value=min+(max-min)*i/4,yy=y(value);
    ctx.strokeStyle='#eef0f3';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(L,yy);ctx.lineTo(W-R,yy);ctx.stroke();
    ctx.fillStyle='#6b7280';ctx.fillText(weighted?value.toFixed(1):Math.round(value).toString(),L-10,yy);
  }
  ctx.strokeStyle='#cbd0d8';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(L,T);ctx.lineTo(L,H-B);ctx.lineTo(W-R,H-B);ctx.stroke();

  const maxXTicks=Math.min(5,points.length),ticks=[];
  if(points.length===1)ticks.push(0);
  else for(let i=0;i<maxXTicks;i++)ticks.push(Math.round(i*(points.length-1)/(maxXTicks-1)));
  [...new Set(ticks)].forEach(i=>{
    const xx=x(i);ctx.strokeStyle='#cbd0d8';ctx.beginPath();ctx.moveTo(xx,H-B);ctx.lineTo(xx,H-B+5);ctx.stroke();
    ctx.fillStyle='#6b7280';ctx.textAlign='center';ctx.fillText(v16ShortDate(points[i].date),xx,H-B+20);
  });

  ctx.fillStyle='#4b5563';ctx.textAlign='center';ctx.fillText('日期',L+plotW/2,H-14);
  ctx.save();ctx.translate(18,T+plotH/2);ctx.rotate(-Math.PI/2);ctx.fillText(weighted?'估算 1RM (kg)':'总次数',0,0);ctx.restore();

  ctx.strokeStyle='#111827';ctx.lineWidth=3;ctx.beginPath();
  points.forEach((p,i)=>{const xx=x(i),yy=y(p.value);i?ctx.lineTo(xx,yy):ctx.moveTo(xx,yy);});ctx.stroke();
  ctx.fillStyle='#111827';points.forEach((p,i)=>{ctx.beginPath();ctx.arc(x(i),y(p.value),6,0,Math.PI*2);ctx.fill();});

  const metric=weighted?'估算 1RM':'总次数',unit=weighted?' kg':' 次';
  if(points.length===1)summary.textContent=`${name} · ${v16RangeLabel()}：1 次有效记录，${metric} ${points[0].value.toFixed(weighted?1:0)}${unit}。`;
  else summary.textContent=`${name} · ${v16RangeLabel()}：${metric}从 ${points[0].value.toFixed(weighted?1:0)}${unit} 到 ${points.at(-1).value.toFixed(weighted?1:0)}${unit}。`;
};

const v16BaseSwitchPage=switchPage;
switchPage=function(id){
  v16BaseSwitchPage(id);
  if(id==='history')v16RenderHistory();
};

function v16RevealToday(){
  if(v16TodayRevealed)return;
  v16TodayRevealed=true;
  try{if(typeof v13DecorateWorkout==='function')v13DecorateWorkout();}catch(e){console.warn('previous workout decoration failed',e);}
  document.querySelectorAll('#workoutContainer .suggestion').forEach(el=>el.remove());
  document.body.classList.remove('app-booting');
}

if(typeof v7RestoreDraft==='function'){
  const v16BaseRestoreDraft=v7RestoreDraft;
  v7RestoreDraft=async function(...args){
    try{return await v16BaseRestoreDraft(...args);}
    finally{
      try{if(typeof v14CleanupDuplicateSessions==='function')await v14CleanupDuplicateSessions();}catch(e){console.warn('boot cleanup failed',e);}
      requestAnimationFrame(v16RevealToday);
    }
  };
}

v16BindRangeButtons();
setTimeout(v16RevealToday,1800);
