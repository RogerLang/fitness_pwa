/* Progression planning layer.
 * - Builds the next-session plan from prior completed sessions.
 * - Uses double progression with two-session confirmation before adding load.
 * - Uses RIR as a secondary gate: a final set at RIR 0 does not trigger a load increase.
 * - Default weight step is 6 kg for deadlift and 5 kg for other loaded exercises.
 * - Keeps planned targets separate from actual workout inputs and stores the plan snapshot with each new session.
 */

const PROGRESSION_VERSION = 1;

function progressionNum(value){
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}
function progressionDefaultStep(ex){
  return /硬拉/.test(String(ex?.name||''))?6:5;
}
function progressionWeightStep(ex){
  if(ex?.weightStep!==undefined&&ex?.weightStep!==null&&ex.weightStep!==''){
    const n=Number(ex.weightStep);
    if(Number.isFinite(n)&&n>=0)return n;
  }
  return progressionDefaultStep(ex);
}
function progressionRepRange(ex){
  let min=Number(ex?.repRange?.[0]);
  let max=Number(ex?.repRange?.[1]);
  if(!Number.isFinite(min)||min<1)min=8;
  if(!Number.isFinite(max)||max<min)max=Math.max(min,12);
  return [Math.round(min),Math.round(max)];
}
function progressionSetCount(ex){
  const n=Math.round(Number(ex?.sets));
  return Number.isFinite(n)&&n>0?n:1;
}
function progressionPositiveWeight(set){
  const w=progressionNum(set?.weight);
  return w!==null&&w>0?w:null;
}
function progressionWorkingWeight(sets){
  const weights=(sets||[]).map(progressionPositiveWeight).filter(w=>w!==null);
  if(!weights.length)return null;
  const counts=new Map();
  weights.forEach(w=>counts.set(w,(counts.get(w)||0)+1));
  let best=weights[0],bestCount=0;
  for(const [weight,count] of counts){
    if(count>bestCount){best=weight;bestCount=count;}
  }
  return best;
}
function progressionLastRir(sets){
  for(let i=(sets||[]).length-1;i>=0;i--){
    const rir=progressionNum(sets[i]?.rir);
    if(rir!==null)return rir;
  }
  return null;
}
function progressionSessionHistory(exName,planName=''){
  const all=state.sessions
    .map((session,index)=>({session,index}))
    .filter(x=>(x.session?.exercises||[]).some(e=>e?.name===exName))
    .sort((a,b)=>String(b.session?.date||'').localeCompare(String(a.session?.date||''))||(b.index-a.index))
    .map(x=>x.session);
  const samePlan=all.filter(s=>s?.plan===planName);
  const source=samePlan.length?samePlan:all;
  return source.map(session=>({
    session,
    exercise:(session.exercises||[]).find(e=>e?.name===exName)
  }));
}
function progressionEvaluate(historyItem,planExercise){
  if(!historyItem?.exercise)return null;
  const [repMin,repMax]=progressionRepRange(planExercise);
  const required=progressionSetCount(planExercise);
  const sets=(historyItem.exercise.sets||[]).filter(s=>progressionNum(s?.reps)!==null&&Number(s.reps)>0);
  if(!sets.length)return null;
  const observed=sets.slice(0,required);
  const weight=progressionWorkingWeight(observed);
  const sameWeight=weight===null?true:observed.every(s=>progressionPositiveWeight(s)===weight);
  const complete=observed.length>=required;
  const allTop=complete&&sameWeight&&observed.every(s=>Number(s.reps)>=repMax);
  const lastRir=progressionLastRir(observed);
  return {
    historyItem,
    observed,
    weight,
    complete,
    sameWeight,
    allTop,
    lastRir,
    rirAllowsProgress:lastRir===null||lastRir>=1,
    repMin,
    repMax,
    required
  };
}
function progressionNextRepTargets(evaluation,planExercise){
  const [repMin,repMax]=progressionRepRange(planExercise);
  const count=progressionSetCount(planExercise);
  if(!evaluation)return Array(count).fill(repMin);
  return Array.from({length:count},(_,i)=>{
    const reps=progressionNum(evaluation.observed?.[i]?.reps);
    if(reps===null||reps<=0)return repMin;
    return Math.min(repMax,Math.max(repMin,Math.round(reps)+1));
  });
}
function progressionSuggestion(planExercise,planName=''){
  const [repMin,repMax]=progressionRepRange(planExercise);
  const setCount=progressionSetCount(planExercise);
  const step=progressionWeightStep(planExercise);
  const history=progressionSessionHistory(planExercise?.name,planName);
  const evaluations=history
    .map(item=>progressionEvaluate(item,planExercise))
    .filter(Boolean);
  const last=evaluations[0]||null;
  const previous=evaluations[1]||null;
  const fallbackWeight=progressionNum(planExercise?.defaultWeight);

  if(!last){
    return {
      version:PROGRESSION_VERSION,
      status:'first',
      statusLabel:'首次建立基线',
      weight:fallbackWeight,
      reps:Array(setCount).fill(repMin),
      repRange:[repMin,repMax],
      weightStep:step,
      confirmation:0,
      reason:`选择能完成 ${repMin}–${repMax} 次、约 RIR 1–2 的重量。`
    };
  }

  const baseWeight=last.weight??fallbackWeight;
  const lastBelowMin=last.complete&&last.observed.every(s=>Number(s.reps)<repMin);
  const previousBelowMin=previous&&previous.complete&&previous.observed.every(s=>Number(s.reps)<repMin);
  const sameReviewWeight=previous&&((baseWeight===null&&previous.weight===null)||(baseWeight!==null&&previous.weight===baseWeight));
  if(lastBelowMin&&previousBelowMin&&sameReviewWeight&&!last.historyItem.exercise?.weightOverride&&!previous.historyItem.exercise?.weightOverride){
    return {
      version:PROGRESSION_VERSION,
      status:'review',
      statusLabel:'检查疲劳',
      weight:baseWeight,
      reps:Array(setCount).fill(repMin),
      repRange:[repMin,repMax],
      weightStep:step,
      confirmation:0,
      reason:'连续两次全部工作组低于目标次数下限；优先检查恢复和动作状态，必要时再考虑降低一档。'
    };
  }
  if(last.allTop){
    if(!last.rirAllowsProgress){
      return {
        version:PROGRESSION_VERSION,
        status:'confirm',
        statusLabel:'再确认一次',
        weight:baseWeight,
        reps:Array(setCount).fill(repMax),
        repRange:[repMin,repMax],
        weightStep:step,
        confirmation:1,
        reason:'已达到次数上限，但最后一组为 RIR 0；本次保持重量确认。'
      };
    }
    const confirmed=previous&&previous.allTop&&previous.rirAllowsProgress&&
      ((baseWeight===null&&previous.weight===null)||(baseWeight!==null&&previous.weight===baseWeight));
    if(confirmed&&baseWeight!==null&&step>0){
      return {
        version:PROGRESSION_VERSION,
        status:'increase',
        statusLabel:'升档',
        weight:baseWeight+step,
        reps:Array(setCount).fill(repMin),
        repRange:[repMin,repMax],
        weightStep:step,
        confirmation:2,
        reason:`连续两次达到 ${repMax} 次上限，下一次增加 ${step} kg，并从次数区间下部重新推进。`
      };
    }
    return {
      version:PROGRESSION_VERSION,
      status:'confirm',
      statusLabel:'进阶确认 1/2',
      weight:baseWeight,
      reps:Array(setCount).fill(repMax),
      repRange:[repMin,repMax],
      weightStep:step,
      confirmation:1,
      reason:'第一次完成全部工作组次数上限；保持当前重量，再完成一次即可进入升档判断。'
    };
  }

  return {
    version:PROGRESSION_VERSION,
    status:'build',
    statusLabel:'累计次数',
    weight:baseWeight,
    reps:progressionNextRepTargets(last,planExercise),
    repRange:[repMin,repMax],
    weightStep:step,
    confirmation:0,
    reason:`保持当前重量，在 ${repMin}–${repMax} 次区间内继续增加总次数。`
  };
}
function progressionFormatWeight(weight){
  return weight===null||weight===undefined?'自选重量':`${Number(weight)} kg`;
}
function progressionFormatReps(reps){
  return (reps||[]).join(' / ');
}
function progressionPlanHtml(suggestion){
  const confirm=suggestion.confirmation?`<span class="progression-chip">${suggestion.confirmation}/2</span>`:'';
  return `<div class="progression-plan-head"><strong>本次计划</strong><span class="progression-chip">${esc(suggestion.statusLabel)}</span>${confirm}</div>
    <div class="progression-plan-target">${esc(progressionFormatWeight(suggestion.weight))} · ${esc(progressionFormatReps(suggestion.reps))} 次</div>
    <div class="progression-plan-reason">${esc(suggestion.reason)}</div>`;
}
function progressionDecorateWorkout(){
  if(!state.plans.length)return;
  const pi=typeof v3CurrentPlanIndex==='function'?v3CurrentPlanIndex():0;
  const plan=state.plans[pi];
  if(!plan)return;
  (plan.exercises||[]).forEach((ex,ei)=>{
    const card=document.querySelector(`#workoutContainer .exercise-card[data-e="${ei}"]`);
    if(!card)return;
    const suggestion=progressionSuggestion(ex,plan.name);
    let box=card.querySelector('.progression-plan');
    if(!box){
      box=document.createElement('div');
      box.className='progression-plan';
      const last=card.querySelector('.last-performance');
      if(last)last.insertAdjacentElement('afterend',box);
      else card.querySelector('.exercise-head')?.insertAdjacentElement('afterend',box);
    }
    box.innerHTML=progressionPlanHtml(suggestion);

    card.querySelectorAll('.workout-set-row[data-s]').forEach(row=>{
      const si=Number(row.dataset.s);
      const w=row.querySelector('input[data-k="weight"]');
      const reps=row.querySelector('input[data-k="reps"]');
      if(w){
        w.dataset.plannedValue=suggestion.weight??'';
        if(w.value==='')w.placeholder=suggestion.weight??'';
      }
      if(reps){
        const target=suggestion.reps?.[si]??suggestion.repRange?.[0]??'';
        reps.dataset.plannedValue=target;
        if(reps.value==='')reps.placeholder=target;
      }
    });

    const legacyStepInput=card.querySelector('.exercise-inline-editor input[data-edit="increment"], .exercise-inline-editor input[data-edit="weightStep"]');
    if(legacyStepInput){
      const label=legacyStepInput.closest('label');
      if(label?.firstChild)label.firstChild.textContent='重量档位 kg';
      legacyStepInput.dataset.edit='weightStep';
      legacyStepInput.min='0';
      legacyStepInput.step='0.5';
      legacyStepInput.value=String(progressionWeightStep(ex));
      legacyStepInput.title='硬拉默认 6 kg；其他器械默认 5 kg；0 表示不自动加重量';
    }
  });
}

const progressionBaseRenderWorkout=typeof v3RenderWorkout==='function'?v3RenderWorkout:null;
if(progressionBaseRenderWorkout){
  v3RenderWorkout=function(){
    progressionBaseRenderWorkout();
    progressionDecorateWorkout();
  };
  renderWorkout=v3RenderWorkout;
}

const progressionBaseWorkoutChange=typeof v3WorkoutChange==='function'?v3WorkoutChange:null;
if(progressionBaseWorkoutChange){
  v3WorkoutChange=async function(e){
    const el=e.target;
    if(el?.dataset?.edit==='weightStep'){
      const editor=el.closest('.exercise-inline-editor');
      if(!editor)return;
      const pi=typeof v3EnsureDraftPlan==='function'?v3EnsureDraftPlan():0;
      const ei=Number(editor.dataset.e);
      const ex=state.plans?.[pi]?.exercises?.[ei];
      if(!ex)return;
      ex.weightStep=Math.max(0,Number(el.value)||0);
      await persist();
      if(typeof v3CaptureDraft==='function')v3CaptureDraft();
      v3RenderWorkout();
      if(typeof renderProgressOptions==='function')renderProgressOptions();
      return;
    }
    return progressionBaseWorkoutChange(e);
  };
}

function progressionPlanSnapshot(plan){
  return new Map((plan?.exercises||[]).map(ex=>[
    ex.name,
    progressionSuggestion(ex,plan.name)
  ]));
}
function progressionActualWorkingWeight(exercise){
  return progressionWorkingWeight((exercise?.sets||[]).filter(s=>progressionNum(s?.reps)!==null||progressionNum(s?.weight)!==null));
}

const progressionBaseSaveWorkout=typeof v3SaveWorkout==='function'?v3SaveWorkout:null;
if(progressionBaseSaveWorkout){
  v3SaveWorkout=async function(){
    const pi=typeof v3CurrentPlanIndex==='function'?v3CurrentPlanIndex():0;
    const plan=state.plans?.[pi];
    const planned=progressionPlanSnapshot(plan);
    const beforeIds=new Set(state.sessions.map(s=>s?.id));
    const beforeLength=state.sessions.length;
    const result=await progressionBaseSaveWorkout();
    if(state.sessions.length<=beforeLength)return result;
    const session=[...state.sessions].reverse().find(s=>s?.id&&!beforeIds.has(s.id))||state.sessions.at(-1);
    if(!session)return result;
    (session.exercises||[]).forEach(ex=>{
      const p=planned.get(ex.name);
      if(!p)return;
      const actualWeight=progressionActualWorkingWeight(ex);
      ex.planned={
        version:p.version,
        weight:p.weight,
        reps:[...(p.reps||[])],
        repRange:[...(p.repRange||[])],
        weightStep:p.weightStep,
        status:p.status
      };
      ex.weightOverride=p.weight!==null&&actualWeight!==null&&actualWeight!==p.weight;
    });
    await persist();
    return result;
  };
}

window.addEventListener('load',()=>setTimeout(()=>{
  progressionDecorateWorkout();
},1050));
