import {activeRows, limits, fileError, userError, recoverable, attachmentProblem, evidencePresentation} from './relay-state.js';

// Reserve at least half the public 180/15-minute budget for uploads, removals and replies.
const pollCalls=[];
const node=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text)n.textContent=text;return n;};
const action=(text,fn,cls='relay-small-button')=>{const b=node('button',cls,text);b.type='button';b.onclick=fn;return b;};

export function createAttachments({api,changed,expired}) {
  const groups=new Map();
  let running=0,disposed=false;
  function current(row,version){return !disposed&&row.state!=='removed'&&row.version===version;}
  function refresh(){for(const group of groups.values()){
    const rows=activeRows(group.rows),busy=rows.filter(r=>['selected','uploading'].includes(r.state));
    group.add.hidden=rows.length>0;group.more.hidden=!rows.length;
    const more=group.more.querySelector("button");more.disabled=rows.length>=limits(group.field).count;more.textContent=more.disabled?"اكتمل عدد المرفقات":"إضافة المزيد";
    group.add.disabled=rows.length>=limits(group.field).count;
    const problems=rows.map((row,index)=>row.error?`المرفق ${new Intl.NumberFormat('ar-EG').format(index+1)}: ${row.error}`:'').filter(Boolean).join('\n');
    if(group.issues.textContent!==problems)group.issues.textContent=problems;group.issues.hidden=!problems;
    group.summary.textContent=busy.length?`جارٍ رفع المرفقات — ${new Intl.NumberFormat('ar-EG').format(rows.length-busy.length)} من ${new Intl.NumberFormat('ar-EG').format(rows.length)}`:rows.some(r=>r.state==='processing')?'جارٍ تجهيز المرفقات… يمكنك إرسال الرد الآن.':'';
  }changed();}
  function dialog(title,trigger){
    const d=node('dialog','relay-dialog'),heading=node('h2','',title),close=action('إغلاق',()=>d.close());
    heading.id=`dialog-${crypto.randomUUID()}`;d.setAttribute('aria-labelledby',heading.id);
    d.append(close,heading);document.body.append(d);
    d.addEventListener('close',()=>{d.remove();if(trigger?.isConnected)trigger.focus();},{once:true});
    d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});
    return d;
  }
  function preview(row,trigger){
    const d=dialog('معاينة المرفق',trigger),name=node('p','relay-preview-name',row.file.name);name.dir='auto';d.append(name);
    if(row.file.type.startsWith('image/')){const img=node('img','relay-preview-image');img.src=row.url;img.alt=row.file.name;d.append(img);}
    else {d.append(node('p','field-hint','افتح المستند على جهازك للتحقق من محتواه.'));const link=node('a','button','فتح المستند');link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';if(row.file.type!=='application/pdf')link.download=row.file.name;d.append(link);}
    d.showModal();
  }
  function draw(row){
    if(!row.ui){
      const tile=node('li','relay-tile'),view=action('',()=>preview(row,view),'relay-thumbnail');
      view.setAttribute('aria-label',`معاينة ${row.file.name}`);
      if(row.file.type.startsWith('image/')){const img=node('img');img.src=row.url;img.alt='';view.append(img);}
      else view.append(node('span','relay-document',row.file.type==='application/pdf'?'PDF':row.file.name.split('.').pop().slice(0,8).toUpperCase()));
      const status=node('p','relay-file-status'),progress=node('progress');status.role='status';progress.max=100;progress.setAttribute('aria-label',`تقدم رفع ${row.file.name}`);
      const retry=action('التحقق مجددًا',()=>{row.state=row.id?'processing':'selected';row.error='';row.polls=0;draw(row);if(row.id)poll(row);else pump();refresh();});
      const remove=action('إزالة',()=>removeRow(row));
      remove.classList.add('relay-remove');retry.classList.add('relay-retry');
      remove.setAttribute('aria-label',`إزالة ${row.file.name}`);
      const actions=node('div','relay-tile-actions');actions.append(retry,remove);tile.append(view,status,progress,actions);row.group.list.append(tile);
      row.ui={tile,view,status,progress,retry,remove};
    }
    const {tile,status,progress,retry,remove}=row.ui;
    remove.disabled=row.state==='removing'||row.removalDenied;remove.textContent=row.state==='removing'?'جارٍ الإزالة…':'إزالة';
    tile.dataset.state=row.state;status.classList.toggle('visually-hidden',row.state==='ready');status.setAttribute('aria-live',row.state==='uploading'?'off':'polite');
    status.textContent=({removing:'جارٍ إزالة المرفق',selected:'بانتظار الرفع',uploading:row.progress===100?'جارٍ تجهيز المرفق':`جارٍ الرفع${row.progress==null?'':` ${row.progress}٪`}`,processing:'جارٍ تجهيز المرفق',ready:'تمت الإضافة',rejected:'لم نتمكن من قبول هذا الملف.',failed:'تعذّر رفع المرفق.'})[row.state];
    if(row.progress==null)progress.removeAttribute('value');else progress.value=row.progress;
    retry.hidden=row.state!=='failed'||!row.retryable;
    refresh();
  }
  async function removeRow(row){
    if(disposed||['removed','removing'].includes(row.state)||row.removalDenied)return;
    row.state='removing';row.version++;clearTimeout(row.timer);draw(row);
    // Do not race DELETE against a completion still writing the stored object.
    // Initialization is also allowed to finish so its evidence ID is retained.
    if(row.task)await row.task;
    if(disposed)return;
    row.controller=new AbortController();
    try{
      if(row.completionUncertain){
        const status=await api.evidence(row.id,row.controller.signal);
        if(!status.session?.completedAt&&!['READY','PROCESSING','REJECTED'].includes(status.status)){
          throw new Error('Completion still uncertain');
        }
        row.completionUncertain=false;
      }
      if(row.id){
        const result=await api.abandonEvidence(row.id,row.controller.signal);
        if(result?.evidenceId!==row.id||result.failureCode!=='USER_ABANDONED')throw new Error('Removal not confirmed');
      }
      if(disposed)return;
      row.state='removed';URL.revokeObjectURL(row.url);row.ui.tile.remove();refresh();
      (row.group.more.hidden?row.group.add:row.group.more.querySelector('button')).focus();pump();
    }catch(error){
      if(disposed)return;
      row.state='failed';row.retryable=false;row.removalDenied=error.code==='evidence.abandon_unavailable';
      row.error=row.completionUncertain?'لم نتأكد من اكتمال الرفع. انتظر قليلًا ثم حاول إزالة المرفق مجددًا.':`لم تتم إزالة المرفق. ${userError(error)}`;
      draw(row);if(error.status===410)expired(error);
    }
  }
  async function poll(row){
    const version=row.version;
    if(!current(row,version)||row.state!=='processing')return;
    while(pollCalls.length&&pollCalls[0]<=Date.now()-900000)pollCalls.shift();
    if(pollCalls.length>=90){row.state='failed';row.retryable=true;row.error='انتظر قليلًا قبل التحقق من المرفقات مجددًا.';draw(row);return;}
    pollCalls.push(Date.now());
    row.controller=new AbortController();
    try {
      const result=await api.evidence(row.id,row.controller.signal);
      if(!current(row,version))return;
      row.failureCode=result.failureCode;row.scanAttempts=result.scanAttempts;row.action=result.action;
      Object.assign(row,evidencePresentation(result));
      row.failures=0;
    }catch(error){
      if(!current(row,version))return;
      if(error.status===410){expired(error);return;}
      row.failures=(row.failures||0)+1;
      if(!recoverable(error)||row.failures>=3){row.state='failed';row.retryable=recoverable(error);row.error=userError(error);}
    }
    if(!current(row,version))return;
    if(row.state==='processing'&&++row.polls>=24){row.state='failed';row.retryable=true;row.error='يستغرق تجهيز المرفق وقتًا أطول. تحقق مجددًا.';}
    draw(row);
    if(row.state==='processing')row.timer=setTimeout(()=>poll(row),Math.min(120000,30000*2**(row.failures||0)));
  }
  async function upload(row){
    const version=++row.version;row.controller=new AbortController();row.state='uploading';row.progress=null;draw(row);
    try {
      const session=await api.createUpload(row.group.field.key,row.file,row.controller.signal);
      row.id=session.evidenceId;row.sessionId=session.sessionId;
      if(!current(row,version))return;
      row.completionUncertain=true;
      const result=await api.completeUpload(session.sessionId,row.file,p=>{if(current(row,version)){row.progress=p;draw(row);}},row.controller.signal);
      if(result?.evidenceId){row.id=result.evidenceId;row.completionUncertain=false;}
      if(!current(row,version))return;
      if(!result?.evidenceId)throw new Error('Invalid completion envelope');
      row.id=result.evidenceId;row.state='processing';row.polls=0;draw(row);poll(row);
    }catch(error){
      if(!current(row,version))return;
      row.state='failed';row.error=userError(error);
      // No automatic POST replay. Preserve the session evidence ID for safe removal.
      if(error.status&&error.status<500&&error.code!=='evidence.upload_in_progress')row.completionUncertain=false;
      row.retryable=false;
      if(recoverable(error))row.error+=' أزل المرفق واختره مجددًا إذا أردت إعادة رفعه.';
      draw(row);if(error.status===410)expired(error);
    }finally{running--;pump();}
  }
  function pump(){if(disposed)return;for(const group of groups.values())for(const row of group.rows){if(running>=2)return;if(row.state==='selected'){running++;row.task=upload(row);}}}
  function mount(field,index){
    const wrap=node('div','relay-field'),label=node('h2','relay-field-label',field.label),picker=node('div','relay-upload');
    if(field.showRequired)label.append(node('span','required',' · مطلوب'));
    const list=node('ul','relay-files'),summary=node('p','field-hint'),err=node('p','relay-error');err.id=`attachment-error-${index}`;err.role='alert';summary.role='status';
    list.setAttribute('aria-label',field.label);const issues=node('p','relay-error relay-file-errors');issues.role='alert';issues.hidden=true;const group={field,rows:[],list,summary,issues};groups.set(field.key,group);
    function error(message){err.textContent=message;err.hidden=!message;group.add.setAttribute('aria-invalid',String(!!message));}
    function addFiles(files){error('');for(const file of files){const message=fileError(field,file,group.rows);if(message){error(message);continue;}const row={file,group,state:'selected',version:0,url:URL.createObjectURL(file)};group.rows.push(row);draw(row);}pump();refresh();}
    const makeInput=(types,camera=false)=>{const input=node('input','visually-hidden');input.type='file';input.accept=types.join(',');input.multiple=!camera&&limits(field).count>1;if(camera)input.setAttribute('capture','environment');input.tabIndex=-1;input.setAttribute('aria-hidden','true');input.onchange=()=>{addFiles([...input.files]);input.value='';};picker.append(input);return input;};
    const types=limits(field).types,all=makeInput(types),images=types.filter(t=>t.startsWith('image/')),photos=images.length?makeInput(images):null,camera=images.length?makeInput(images,true):null;
    function choose(event){const trigger=event.currentTarget;if(!matchMedia('(pointer: coarse)').matches||!camera){all.click();return;}const d=dialog('إضافة مرفق',trigger);for(const [text,input] of [['التقاط صورة',camera],['اختيار صور',photos],['اختيار مستند',all]])d.append(action(text,()=>{d.close();input.click();},'relay-camera-button'));d.showModal();}
    group.add=action('إضافة صور أو مستندات',choose,'relay-camera-button');group.add.id=`relay-field-${index}`;group.add.setAttribute('aria-describedby',err.id);
    group.more=node('li','relay-add-tile');group.more.append(action('إضافة المزيد',choose,'relay-add-more'));group.more.hidden=true;list.append(group.more);
    picker.append(group.add,node('p','field-hint','صوّر المستند أو اختره من جهازك.'));
    const formatNames=types.map(t=>({'application/pdf':'PDF','image/jpeg':'JPG','image/png':'PNG'}[t]||t));
    picker.append(node('p','relay-limits',`${formatNames.join('، ')} · حتى ${new Intl.NumberFormat('ar-EG').format(limits(field).count)} ملفات · ٥٠ ميغابايت للملف`));
    picker.addEventListener('dragover',event=>event.preventDefault());picker.addEventListener('drop',event=>{event.preventDefault();if(!picker.closest('fieldset')?.disabled)addFiles([...event.dataTransfer.files]);});
    wrap.append(label);if(field.description)wrap.append(node('p','field-hint',field.description));wrap.append(picker,list,summary,issues,err);error('');
    return {wrap,input:group.add,error,field};
  }
  return {mount,rows:key=>activeRows(groups.get(key)?.rows||[]),problem:key=>attachmentProblem(groups.get(key)?.rows||[]),dispose(){disposed=true;for(const group of groups.values())for(const row of group.rows){row.version++;row.controller?.abort();clearTimeout(row.timer);URL.revokeObjectURL(row.url);}document.querySelectorAll('.relay-dialog').forEach(d=>d.close());}};
}
