/* v4 training-page UX: inline plan editing, per-set completion, normal end-of-page action bar. */
let v3Draft = { planIndex: null, sets: {}, completed: {} };

function v3CurrentPlanIndex(){
  const sel = document.getElementById('planSelect');
  return sel && !sel.disabled ? Number(sel.value || 0) : 0;
}
function v3DraftKey(ei,si,k){ return `${ei}:${si}:${k}`; }
function v3DoneKey(ei,si){ return `${ei}:${si}`; }
function v3EnsureDraftPlan(){
  const pi = v3CurrentPlanIndex();
  if(v3Draft.planIndex !== pi) v3Draft = {planIndex:pi,sets:{},completed:{}};
  return pi;
}
function v3CaptureDraft(){
  const pi = v3EnsureDraftPlan();
  document.querySelectorAll('#workoutContainer input[data-e][data-s][data-k]').forEach(i=>{
    v3Draft.sets[v3DraftKey(i.dataset.e,i.dataset.s,i.dataset.k)] = i.value;
  });
  document.querySelectorAll('#workoutContainer .workout-set-row[data-e][data-s]').forEach(row=>{
    v3Draft.completed[v3DoneKey(row.dataset.e,row.dataset.s)] = row.classList.contains('set-completed');
  });
  v3Draft.planIndex = pi;
}
function v3RestoreValue(ei,si,k){
  const key=v3DraftKey(ei,si,k);
  return Object.prototype.hasOwnProperty.call(v3Draft.sets,key) ? v3Draft.sets[key] : '';
}
function v3Escape(s=''){
  return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function v3RenderWorkout(){
  const c=document.getElementById('workoutContainer');
  if(!state.plans.length){
    c.innerHTML='<div class="card empty">请先导入训练计划 JSON。</div>';
    return;
  }
  const pi=v3EnsureDraftPlan();
  const plan=state.plans[pi];
  c.innerHTML='';
  (plan.exercises||[]).forEach((ex,ei)=>{
    const card=document.createElement('div');
    card.className='card exercise-card';
    card.dataset.e=ei;
    const target=ex.repRange?`${ex.repRange[0]}–${ex.repRange[1]} 次`:'';
    card.innerHTML=`
      <div class="exercise-head">
        <div>
          <div class="exercise-title">${v3Escape(ex.name)}</div>
          <div class="exercise-meta">${target}${ex.note?` · ${v3Escape(ex.note)}`:''}</div>
        </div>
        <button class="small secondary exercise-edit-toggle" data-e="${ei}">调整</button>
      </div>
      <div class="set-row set-header"><span>组</span><span>重量 kg</span><span>次数</span><span>RIR</span><span>完成</span></div>
    `;
    const sets=Math.max(1,Number(ex.sets)||1);
    for(let si=0;si<sets;si++){
      const row=document.createElement('div');
      const done=!!v3Draft.completed[v3DoneKey(ei,si)];
      row.className='set-row workout-set-row'+(done?' set-completed':'');
      row.dataset.e=ei;
      row.dataset.s=si;
      const w=v3RestoreValue(ei,si,'weight'), reps=v3RestoreValue(ei,si,'reps'), rir=v3RestoreValue(ei,si,'rir');
      row.innerHTML=`
        <span>${si+1}</span>
        <input type="number" step="0.5" inputmode="decimal" data-e="${ei}" data-s="${si}" data-k="weight" value="${v3Escape(w)}" placeholder="${ex.defaultWeight??''}">
        <input type="number" step="1" inputmode="numeric" data-e="${ei}" data-s="${si}" data-k="reps" value="${v3Escape(reps)}">
        <input type="number" step="1" min="0" max="10" inputmode="numeric" data-e="${ei}" data-s="${si}" data-k="rir" value="${v3Escape(rir)}" placeholder="1–2">
        <button class="small set-complete ${done?'':'secondary'}" data-e="${ei}" data-s="${si}">${done?'✓':'完成'}</button>
      `;
      card.appendChild(row);
    }
    const config=document.createElement('div');
    config.className='exercise-inline-editor hidden';
    config.dataset.e=ei;
    config.innerHTML=`
      <div class="inline-editor-grid">
        <label class="wide">动作名称<input data-edit="name" value="${v3Escape(ex.name||'')}"></label>
        <label>最低次数<input data-edit="repMin" type="number" min="1" step="1" value="${ex.repRange?.[0]??8}"></label>
        <label>最高次数<input data-edit="repMax" type="number" min="1" step="1" value="${ex.repRange?.[1]??12}"></label>
        <label>默认 kg<input data-edit="defaultWeight" type="number" step="0.5" value="${ex.defaultWeight??''}"></label>
        <label>加重 kg<input data-edit="increment" type="number" min="0" step="0.5" value="${ex.increment??2.5}"></label>
      </div>
      <label>备注<textarea data-edit="note">${v3Escape(ex.note||'')}</textarea></label>
      <div class="row between wrap top-gap">
        <label class="row compact-check"><input data-edit="optional" type="checkbox" ${ex.optional?'checked':''}> 可选动作</label>
        <button class="small danger delete-exercise-inline" data-e="${ei}">删除动作</button>
      </div>
    `;
    card.appendChild(config);
    const footer=document.createElement('div');
    footer.className='exercise-card-actions';
    footer.innerHTML=`
      <div class="row">
        <button class="small secondary remove-set" data-e="${ei}" ${sets<=1?'disabled':''}>− 1组</button>
        <button class="small secondary add-set" data-e="${ei}">+ 1组</button>
      </div>
    `;
    card.appendChild(footer);
    const sug=document.createElement('div');
    sug.className='suggestion';
    sug.textContent=progressionSuggestion(ex);
    card.appendChild(sug);
    c.appendChild(card);
  });
  const addCard=document.createElement('div');
  addCard.className='card add-exercise-card';
  addCard.innerHTML='<button id="addExerciseInlineBtn" class="secondary">+ 添加动作</button>';
  c.appendChild(addCard);
}

renderWorkout = v3RenderWorkout;

async function v3PersistAndRender(){
  await persist();
  renderPlanSelect();
  v3RenderWorkout();
  renderProgressOptions();
  if(typeof v2RenderEditor==='function') v2RenderEditor();
}
function v3NewExercise(){
  return {name:'新动作',sets:3,repRange:[8,12],defaultWeight:null,increment:2.5,note:'',optional:false};
}
function v3ShiftDraftAfterDeleteExercise(deletedEi){
  const nextSets={}, nextCompleted={};
  Object.entries(v3Draft.sets).forEach(([key,val])=>{
    const [e,s,k]=key.split(':'); const ei=Number(e);
    if(ei===deletedEi) return;
    const ne=ei>deletedEi?ei-1:ei;
    nextSets[v3DraftKey(ne,s,k)]=val;
  });
  Object.entries(v3Draft.completed).forEach(([key,val])=>{
    const [e,s]=key.split(':'); const ei=Number(e);
    if(ei===deletedEi)return;
    const ne=ei>deletedEi?ei-1:ei;
    nextCompleted[v3DoneKey(ne,s)]=val;
  });
  v3Draft.sets=nextSets;v3Draft.completed=nextCompleted;
}
function v3TrimLastSetDraft(ei,lastSi){
  ['weight','reps','rir'].forEach(k=>delete v3Draft.sets[v3DraftKey(ei,lastSi,k)]);
  delete v3Draft.completed[v3DoneKey(ei,lastSi)];
}
async function v3WorkoutClick(e){
  const b=e.target.closest('button'); if(!b)return;
  const pi=v3EnsureDraftPlan();
  const plan=state.plans[pi]; if(!plan)return;
  const ei=Number(b.dataset.e);
  if(b.classList.contains('exercise-edit-toggle')){
    const editor=b.closest('.exercise-card').querySelector('.exercise-inline-editor');
    editor.classList.toggle('hidden');
    b.textContent=editor.classList.contains('hidden')?'调整':'收起';
    return;
  }
  if(b.classList.contains('set-complete')){
    const si=Number(b.dataset.s), row=b.closest('.workout-set-row');
    const done=!row.classList.contains('set-completed');
    row.classList.toggle('set-completed',done);
    v3Draft.completed[v3DoneKey(ei,si)]=done;
    b.textContent=done?'✓':'完成';
    b.classList.toggle('secondary',!done);
    return;
  }
  if(b.classList.contains('add-set')){
    v3CaptureDraft();plan.exercises[ei].sets=Math.max(1,Number(plan.exercises[ei].sets)||1)+1;await v3PersistAndRender();return;
  }
  if(b.classList.contains('remove-set')){
    const ex=plan.exercises[ei],sets=Math.max(1,Number(ex.sets)||1);if(sets<=1)return;
    v3CaptureDraft();v3TrimLastSetDraft(ei,sets-1);ex.sets=sets-1;await v3PersistAndRender();return;
  }
  if(b.classList.contains('delete-exercise-inline')){
    if(!confirm('删除这个动作？历史训练记录不会被删除。'))return;
    v3CaptureDraft();plan.exercises.splice(ei,1);v3ShiftDraftAfterDeleteExercise(ei);await v3PersistAndRender();return;
  }
  if(b.id==='addExerciseInlineBtn'){
    v3CaptureDraft();plan.exercises??=[];plan.exercises.push(v3NewExercise());await v3PersistAndRender();
  }
}
function v3WorkoutInput(e){
  const el=e.target;
  if(el.matches('input[data-e][data-s][data-k]')){
    v3EnsureDraftPlan();v3Draft.sets[v3DraftKey(el.dataset.e,el.dataset.s,el.dataset.k)]=el.value;
  }
}
async function v3WorkoutChange(e){
  const el=e.target;
  const editor=el.closest('.exercise-inline-editor'); if(!editor||!el.dataset.edit)return;
  const pi=v3EnsureDraftPlan(),ei=Number(editor.dataset.e),ex=state.plans[pi].exercises[ei],f=el.dataset.edit;
  if(f==='name')ex.name=el.value.trim()||'未命名动作';
  else if(f==='repMin'){ex.repRange??=[8,12];ex.repRange[0]=Math.max(1,Number(el.value)||1);}
  else if(f==='repMax'){ex.repRange??=[8,12];ex.repRange[1]=Math.max(1,Number(el.value)||1);}
  else if(f==='defaultWeight')ex.defaultWeight=el.value===''?null:Number(el.value);
  else if(f==='increment')ex.increment=Math.max(0,Number(el.value)||0);
  else if(f==='note')ex.note=el.value;
  else if(f==='optional')ex.optional=el.checked;
  await persist();
  v3CaptureDraft();
  v3RenderWorkout();
  renderProgressOptions();
}

async function v3SaveWorkout(){
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
      const parsed={
        weight:raw.weight===''||raw.weight===undefined?null:Number(raw.weight),
        reps:raw.reps===''||raw.reps===undefined?null:Number(raw.reps),
        rir:raw.rir===''||raw.rir===undefined?null:Number(raw.rir),
        completed:!!v3Draft.completed[v3DoneKey(ei,si)]
      };
      if(parsed.completed || [parsed.weight,parsed.reps,parsed.rir].some(v=>v!==null))sets.push(parsed);
    }
    return {name:ex.name,sets};
  }).filter(ex=>ex.sets.length);
  if(!exercises.length){alert('还没有输入训练数据。');return;}
  state.sessions.push({id:crypto.randomUUID(),date:isoDate(),plan:plan.name,exercises});
  await persist();renderHistory();renderProgressOptions();
  v3Draft={planIndex:pi,sets:{},completed:{}};v3RenderWorkout();alert('已保存。');
}
function v3ResetWorkout(){
  const pi=v3CurrentPlanIndex();v3Draft={planIndex:pi,sets:{},completed:{}};v3RenderWorkout();
}

function v3OnPlanChange(){
  v3Draft={planIndex:v3CurrentPlanIndex(),sets:{},completed:{}};v3RenderWorkout();
}

window.addEventListener('load',()=>setTimeout(()=>{
  const wc=document.getElementById('workoutContainer');
  if(wc){wc.addEventListener('click',v3WorkoutClick);wc.addEventListener('input',v3WorkoutInput);wc.addEventListener('change',v3WorkoutChange);}
  const sel=document.getElementById('planSelect');if(sel)sel.onchange=v3OnPlanChange;
  const save=document.getElementById('saveWorkoutBtn');if(save)save.onclick=v3SaveWorkout;
  const reset=document.getElementById('resetWorkoutBtn');if(reset)reset.onclick=v3ResetWorkout;
  v3Draft={planIndex:v3CurrentPlanIndex(),sets:{},completed:{}};v3RenderWorkout();
},160));
