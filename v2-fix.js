/* v2.1 integration fix: keep the plan editor synchronized whenever app.js re-renders after import/wipe. */
const v2BaseRenderAll = renderAll;
renderAll = function(){
  v2BaseRenderAll();
  v2RenderEditor();
};
