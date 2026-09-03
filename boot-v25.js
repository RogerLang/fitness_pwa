/* v25 first-paint gate.
 * Keeps the training screen hidden until legacy boot redraws finish, then restores the
 * current draft once and reveals the final decorated workout in a single paint.
 */
(function(){
  const body=document.body;
  let settling=false;
  let revealRequested=false;
  const baseReveal=typeof v16RevealToday==='function'?v16RevealToday:null;

  // performance-v16 performs one extra v13 decoration immediately before reveal. The
  // current render chain already includes v13 + progression + warm-up decoration, so
  // repeating only v13 here temporarily replaces planned rep placeholders with old reps.
  if(baseReveal){
    v16RevealToday=function(){
      if(revealRequested)return;
      revealRequested=true;
      const previousDecorator=typeof v13DecorateWorkout==='function'?v13DecorateWorkout:null;
      try{
        if(previousDecorator)v13DecorateWorkout=function(){};
        baseReveal();
      }finally{
        if(previousDecorator)v13DecorateWorkout=previousDecorator;
      }
    };
  }

  async function settleTrainingBoot(){
    if(settling)return;
    settling=true;
    try{
      // v3-ui still has a legacy load+160 ms redraw. Keep it behind the gate, then do
      // one final draft-aware render after it finishes.
      await new Promise(resolve=>setTimeout(resolve,190));
      if(typeof v7RestoreDraft==='function'&&typeof v3CurrentPlanIndex==='function'){
        await v7RestoreDraft(v3CurrentPlanIndex());
      }else if(typeof v3RenderWorkout==='function'){
        v3RenderWorkout();
      }
    }catch(e){
      console.warn('final workout boot render failed',e);
    }

    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(baseReveal&&typeof v16TodayRevealed!=='undefined'&&!v16TodayRevealed){
        try{v16RevealToday();}catch(e){console.warn('training reveal failed',e);}
      }
      body.classList.remove('app-booting','app-settling');
      body.classList.add('app-ready');
    }));
  }

  if(document.readyState==='complete')settleTrainingBoot();
  else window.addEventListener('load',settleTrainingBoot,{once:true});
})();
