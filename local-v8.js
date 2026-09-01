/* v8 fixed sync password UX.
 * Keeps the already-used cloud encryption password fixed on each device after it is saved.
 * Password remains device-local in IndexedDB and is never committed or uploaded.
 */
let v8PasswordVisible=false;

async function v8PasswordFingerprint(password){
  if(!password)return '';
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(password));
  const hex=[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('').toUpperCase();
  return `${hex.slice(0,4)}-${hex.slice(4,8)}`;
}

function v8EnsurePasswordTools(){
  const input=document.getElementById('syncPassword');
  if(!input||document.getElementById('syncPasswordTools'))return;
  const tools=document.createElement('div');
  tools.id='syncPasswordTools';
  tools.className='sync-password-tools';
  tools.innerHTML=`
    <button id="syncPasswordRevealBtn" type="button" class="small secondary">显示</button>
    <button id="syncPasswordCopyBtn" type="button" class="small secondary">复制密码</button>
  `;
  input.insertAdjacentElement('afterend',tools);
  const note=document.createElement('div');
  note.id='syncPasswordFixedState';
  note.className='sync-password-fixed-state muted';
  tools.insertAdjacentElement('afterend',note);

  document.getElementById('syncPasswordRevealBtn').onclick=()=>{
    v8PasswordVisible=!v8PasswordVisible;
    input.type=v8PasswordVisible?'text':'password';
    document.getElementById('syncPasswordRevealBtn').textContent=v8PasswordVisible?'隐藏':'显示';
  };
  document.getElementById('syncPasswordCopyBtn').onclick=async()=>{
    if(!input.value){
      if(typeof v2Status==='function')v2Status('当前设备还没有固定同步密码。',false);
      return;
    }
    try{
      await navigator.clipboard.writeText(input.value);
      if(typeof v2Status==='function')v2Status('同步密码已复制到剪贴板。',true);
    }catch(e){
      if(typeof v2Status==='function')v2Status('浏览器未允许复制，请点“显示”后手动复制。',false);
    }
  };
}

async function v8ApplyPasswordState(){
  const input=document.getElementById('syncPassword');
  const stateBox=document.getElementById('syncPasswordFixedState');
  if(!input||!stateBox||!db)return;
  const c=await idbGet('syncCredentialsV7');
  const fixed=!!c?.password;
  if(fixed && input.value!==c.password)input.value=c.password;
  input.readOnly=fixed;
  input.classList.toggle('fixed-secret',fixed);
  const fp=fixed?await v8PasswordFingerprint(c.password):'';
  stateBox.textContent=fixed
    ? `已固定保存在本机 · 密码指纹 ${fp} · 三台设备的指纹应一致`
    : '首次输入正确的云端同步密码后，点“保存本机同步信息”，以后将自动锁定。';
  const remember=document.getElementById('rememberSyncBtn');
  if(remember)remember.textContent=fixed?'同步信息已保存':'保存并固定同步信息';
  const copy=document.getElementById('syncPasswordCopyBtn');
  const reveal=document.getElementById('syncPasswordRevealBtn');
  if(copy)copy.disabled=!input.value;
  if(reveal)reveal.disabled=!input.value;
}

if(typeof v7SaveCredentials==='function'){
  const v8BaseSaveCredentials=v7SaveCredentials;
  v7SaveCredentials=async function(showStatus=false){
    const ok=await v8BaseSaveCredentials(showStatus);
    if(ok)await v8ApplyPasswordState();
    return ok;
  };
}

window.addEventListener('load',()=>setTimeout(async()=>{
  v8EnsurePasswordTools();
  try{await v8ApplyPasswordState();}catch(e){console.warn('fixed password state failed',e);}
},520));
