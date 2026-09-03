/* Workout-card presentation polish.
 * Keeps frequently used set inputs visible while moving low-frequency set-count controls
 * behind the existing adjustment toggle. Also presents previous performance, generated
 * plans, and optional warm-up prescriptions with a consistent visual hierarchy.
 */
(function(){
  function uiEsc(value=''){
    if(typeof esc==='function')return esc(value);
    return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function valueOrNull(value){
    if(value===null||value===undefined||value==='')return null;
    const n=Number(value);
    return Number.isFinite(n)?n:null;
  }
  function previousSummary(ex,planName){
    if(typeof v13LatestExercise!=='function')return null;
    const previous=v13LatestExercise(ex?.name,planName);
    const sets=(previous?.sets||[]).filter(set=>
      valueOrNull(set?.weight)!==null||valueOrNull(set?.reps)!==null||valueOrNull(set?.rir)!==null
    );
    if(!sets.length)return null;

    const reps=sets.map(set=>valueOrNull(set.reps));
    const weights=sets.map(set=>valueOrNull(set.weight));
    const positiveWeights=weights.filter(weight=>weight!==null&&weight>0);
    const sameWeight=positiveWeights.length===sets.length&&positiveWeights.every(weight=>weight===positiveWeights[0]);

    let target;
    if(sameWeight){
      target=`${positiveWeights[0]} kg · ${reps.map(rep=>rep??'–').join(' / ')} 次`;
    }else{
      target=sets.map((set,index)=>{
        const weight=weights[index];
        const rep=reps[index];
        const weightText=weight!==null&&weight>0?`${weight}kg`:'–';
        const repText=rep!==null?rep:'–';
        return `${weightText} × ${repText}`;
      }).join(' · ');
    }

    const rirs=sets.map(set=>valueOrNull(set.rir));
    const detail=rirs.some(rir=>rir!==null)
      ? `RIR ${rirs.map(rir=>rir??'–').join(' / ')}`
      : '';
    return {target,detail};
  }
  function warmupSummary(ex){
    const sets=Array.isArray(ex?.warmupSets)?ex.warmupSets:[];
    return sets
      .map(set=>{
        const weight=valueOrNull(set?.weight);
        const reps=String(set?.reps??'').trim();
        if(weight===null&&!reps)return null;
        const weightText=weight!==null?`${weight} kg`:'自选重量';
        return `${weightText} × ${reps||'自选次数'}`;
      })
      .filter(Boolean);
  }
  function renderWarmup(card,ex){
    const lines=warmupSummary(ex);
    let box=card.querySelector('.warmup-plan');
    if(!lines.length){
      if(box)box.remove();
      return;
    }
    if(!box){
      box=document.createElement('div');
      box.className='warmup-plan';
      const setHeader=card.querySelector('.set-header');
      if(setHeader)setHeader.insertAdjacentElement('beforebegin',box);
      else card.querySelector('.exercise-head')?.insertAdjacentElement('afterend',box);
    }
    box.innerHTML=`<div class="warmup-plan-head"><strong>专项热身</strong><span class="progression-chip">不计入正式组</span></div>`+
      `<div class="warmup-plan-sets">${lines.map((line,index)=>`<span><b>${index+1}</b>${uiEsc(line)}</span>`).join('')}</div>`+
      `<div class="warmup-plan-note">按顺序完成，保留余力，随后进入正式工作组。</div>`;
  }
  function polishCard(card,plan){
    const editor=card.querySelector('.exercise-inline-editor');
    card.classList.toggle('adjustments-open',!!editor&&!editor.classList.contains('hidden'));

    const ei=Number(card.dataset.e);
    const ex=plan?.exercises?.[ei];
    if(!ex)return;
    renderWarmup(card,ex);

    const last=card.querySelector('.last-performance');
    if(last&&last.dataset.unifiedContext!=='1'){
      const summary=previousSummary(ex,plan.name);
      if(summary){
        last.dataset.unifiedContext='1';
        last.innerHTML=`<div class="workout-context-head"><strong>上次记录</strong></div>`+
          `<div class="workout-context-target">${uiEsc(summary.target)}</div>`+
          (summary.detail?`<div class="workout-context-detail">${uiEsc(summary.detail)}</div>`:'');
      }
    }
  }
  function polishWorkoutCards(){
    if(typeof state==='undefined'||!state.plans?.length)return;
    const pi=typeof v3CurrentPlanIndex==='function'?v3CurrentPlanIndex():0;
    const plan=state.plans[pi];
    if(!plan)return;
    document.querySelectorAll('#workoutContainer .exercise-card').forEach(card=>polishCard(card,plan));
  }
  function initWorkoutCardPolish(){
    const container=document.getElementById('workoutContainer');
    if(!container)return;
    polishWorkoutCards();
    const observer=new MutationObserver(()=>polishWorkoutCards());
    observer.observe(container,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initWorkoutCardPolish,{once:true});
  else initWorkoutCardPolish();
})();
