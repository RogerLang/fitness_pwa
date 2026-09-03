/* Simple same-level warm-up card support.
 * Warm-up exercises stay in the normal exercise list. This file only removes progression
 * decoration from them and applies per-set placeholder targets. No MutationObserver.
 */
(function(){
  function warmupPresets(ex){
    return Array.isArray(ex?.setPresets)?ex.setPresets:[];
  }

  function decorateWarmupCards(){
    if(typeof state==='undefined'||!state.plans?.length)return;
    const pi=typeof v3CurrentPlanIndex==='function'?v3CurrentPlanIndex():0;
    const plan=state.plans?.[pi];
    if(!plan)return;

    (plan.exercises||[]).forEach((ex,ei)=>{
      if(!ex?.warmup)return;
      const card=document.querySelector(`#workoutContainer .exercise-card[data-e="${ei}"]`);
      if(!card)return;

      card.querySelector('.progression-plan')?.remove();
      const meta=card.querySelector('.exercise-meta');
      if(meta)meta.textContent=ex.note||'专项热身；不计入正式组与进阶';

      warmupPresets(ex).forEach((preset,si)=>{
        const row=card.querySelector(`.workout-set-row[data-s="${si}"]`);
        if(!row)return;
        const weight=row.querySelector('input[data-k="weight"]');
        const reps=row.querySelector('input[data-k="reps"]');
        const rir=row.querySelector('input[data-k="rir"]');

        if(weight){
          weight.removeAttribute('data-planned-value');
          if(weight.value==='')weight.placeholder=preset?.weight??'';
        }
        if(reps){
          reps.removeAttribute('data-planned-value');
          if(reps.value==='')reps.placeholder=preset?.repsLabel??preset?.reps??'';
        }
        if(rir&&rir.value==='')rir.placeholder='';
      });
    });
  }

  const baseRender=typeof v3RenderWorkout==='function'?v3RenderWorkout:null;
  if(baseRender){
    v3RenderWorkout=function(){
      baseRender();
      decorateWarmupCards();
    };
    renderWorkout=v3RenderWorkout;
  }

  const baseSave=typeof v3SaveWorkout==='function'?v3SaveWorkout:null;
  if(baseSave){
    v3SaveWorkout=async function(){
      const before=state.sessions.length;
      const result=await baseSave();
      if(state.sessions.length<=before)return result;

      const pi=typeof v3CurrentPlanIndex==='function'?v3CurrentPlanIndex():0;
      const plan=state.plans?.[pi];
      const warmupNames=new Set((plan?.exercises||[]).filter(ex=>ex?.warmup).map(ex=>ex.name));
      const session=state.sessions.at(-1);
      let changed=false;
      (session?.exercises||[]).forEach(ex=>{
        if(!warmupNames.has(ex?.name))return;
        if(Object.prototype.hasOwnProperty.call(ex,'planned')){delete ex.planned;changed=true;}
        if(Object.prototype.hasOwnProperty.call(ex,'weightOverride')){delete ex.weightOverride;changed=true;}
      });
      if(changed&&typeof persist==='function')await persist();
      return result;
    };
  }

  window.addEventListener('load',()=>setTimeout(decorateWarmupCards,1150));
})();
