import {createRelayApi,RelayError} from './relay-api.js';
import {validate} from './relay-validation.js';
import {createAttachments} from './relay-attachments.js';
import {userError} from './relay-state.js';

const root=document.getElementById('relay-content');
const match=/^\/r\/([A-Za-z0-9_-]{43})\/?$/.exec(location.pathname);
const demoMode=location.pathname==='/__demo/'||location.pathname==='/__demo';
const api=demoMode?createDemoApi():match?createRelayApi(window.__ENV__?.API_BASE_URL||'https://api.alqabasy.com',match[1]):null;
const supported=new Set(['text','multiline_text','decimal','integer','date','select','boolean','attachments','evidence']);
let request, receipt, draftKey, draftAnswers, attachments, updateAction=()=>{};
let submission='editing', requestState='loading';
let lockedAnswers;
window.addEventListener('pagehide',()=>attachments?.dispose());
window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
function el(tag,cls='',value){const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=value;return n;}
function button(label,fn,cls='button'){const b=el('button',cls,label);b.type='button';b.addEventListener('click',fn);return b;}
function createDemoApi(){let uploadCount=0;return {get:async()=>({title:'مراجعة تعاملاتك',instructions:'دخل الرصيد، صور الكرت او التقارير او الكشوف المتاحه للفترة',expiresAt:new Date(Date.now()+86400000*14).toISOString(),allowPartial:true,allowMultiple:true,status:'ANSWERED',form:{title:'مراجعة تعاملات الفتره',fields:[{key:'balance_end_of_period',type:'integer',label:'رصيد نهاية المده',required:true},{key:'attachments',type:'attachments',label:'المرفقات',required:true,constraints:{maxFiles:5,allowedMediaTypes:['application/pdf','image/jpeg','image/png']}}],locale:'ar-EG',schemaVersion:1}}),createUpload:async()=>({sessionId:`demo-upload-${++uploadCount}`}),completeUpload:async(sessionId,file,onProgress)=>{onProgress?.(100);return {evidenceId:`demo-evidence-${sessionId}`};},evidence:async()=>({status:'READY'}),submit:async()=>({status:'SUBMITTED',submissionId:'demo-submission'})};}
function show(node){root.replaceChildren(node);root.setAttribute('aria-busy','false');}
function state(title,detail,action){const w=el('div','share-state');w.append(el('h1','',title),el('p','',detail));if(action)w.append(action);show(w);}
function notice(text){let n=document.getElementById('relay-notice');if(!n){n=el('p','message');n.id='relay-notice';n.role='alert';document.querySelector('.relay-actions')?.prepend(n);}if(n){n.textContent=text;n.hidden=!text;}}
function unavailable(error){
  attachments?.dispose();requestState='unavailable';
  if([401,403,404].includes(error.status))return state('الرابط غير متاح','تحقق من الرابط أو اطلب رابطًا جديدًا من المرسل.');
  if(error.status===410)return state('انتهت صلاحية الرابط','اطلب رابطًا جديدًا من المرسل للمتابعة.');
  state('تعذّر فتح الطلب',userError(error),button('المحاولة مجددًا',load));
}
async function load(){
  if(!api)return state('الرابط غير صالح','تحقق من الرابط الذي وصلك.');
  requestState='loading';state('جارٍ فتح الطلب','ستظهر المعلومات المطلوبة خلال لحظات.');root.setAttribute('aria-busy','true');
  const slow=setTimeout(()=>{const detail=root.querySelector('.share-state p');if(requestState==='loading'&&detail)detail.textContent='يستغرق فتح الطلب وقتًا أطول. تحقق من اتصالك بالإنترنت.';},8000);
  try{
    request=await api.get();
    if(request.status==='EXPIRED'||new Date(request.expiresAt)<=new Date())return unavailable({status:410});
    if(['FULFILLED','CANCELLED'].includes(request.status)){requestState='closed';return state('أُغلق هذا الطلب','لا يقبل هذا الرابط ردودًا جديدة. يمكنك التواصل مع المرسل.');}
    if(!request.allowMultiple&&['ANSWERED','PARTIALLY_ANSWERED'].includes(request.status)){requestState='closed';return state('تم استلام رد سابق','لا يقبل هذا الرابط ردًا إضافيًا.');}
    if(request.form?.schemaVersion!==1||!Array.isArray(request.form.fields)||request.form.fields.some(f=>f.required&&!supported.has(f.type)))return state('تعذّر عرض النموذج','تواصل مع المرسل للحصول على طلب جديد.');
    requestState='active';render();
  }catch(e){unavailable(e);}finally{clearTimeout(slow);}
}
function fieldView(field,index){const wrap=el('div','relay-field'),id=`relay-field-${index}`,label=el('label','',field.label);label.htmlFor=id;wrap.append(label);if(field.required&&!request.allowPartial)label.append(el('span','required',' · مطلوب'));if(field.description){const d=el('p','field-hint',field.description);d.id=`${id}-hint`;wrap.append(d);}let input;
  if(field.type==='multiline_text')input=el('textarea','relay-input');else if(field.type==='select'){input=el('select','relay-input');input.append(new Option('اختر إجابة',''));for(const option of field.constraints?.options||[]){const value=typeof option==='string'?option:option.value;const name=typeof option==='string'?option:option.label;input.append(new Option(name,value));}}else if(field.type==='boolean'){input=el('input');input.type='checkbox';wrap.classList.add('relay-check');}else if(['attachments','evidence'].includes(field.type)){
    return attachments.mount({...field,showRequired:field.required&&!request.allowPartial},index);
  }else{input=el('input','relay-input');input.type=field.type==='date'?'date':'text';if(field.type==='decimal'){input.inputMode='decimal';input.classList.add('relay-numeric');input.dir='ltr';}if(field.type==='integer'){input.inputMode='numeric';input.classList.add('relay-numeric');input.dir='ltr';}}
  const placeholders={text:'اكتب إجابتك هنا',multiline_text:'أضف التفاصيل هنا',decimal:'مثال: ١٢٣٫٤٥',integer:'مثال: ١٢٣٤'};
  if(typeof field.placeholder==='string'&&field.placeholder)input.placeholder=field.placeholder;else if(placeholders[field.type])input.placeholder=placeholders[field.type];
  if(field.type==='date'){if(typeof field.constraints?.min==='string')input.min=field.constraints.min;if(typeof field.constraints?.max==='string')input.max=field.constraints.max;}
  input.id=id;if(field.required&&!request.allowPartial)input.required=true;if(field.constraints?.maxLength&&'maxLength'in input)input.maxLength=field.constraints.maxLength;if(field.description)input.setAttribute('aria-describedby',`${id}-hint`);const err=el('p','relay-error');err.id=`${id}-error`;err.setAttribute('role','alert');err.hidden=true;function error(message){err.textContent=message;err.hidden=!message;input.setAttribute('aria-invalid',String(!!message));input.setAttribute('aria-describedby',[field.description?`${id}-hint`:'',message?err.id:''].filter(Boolean).join(' '));}
  wrap.append(input,err);input.addEventListener('input',()=>{error('');updateAction();});input.addEventListener('blur',()=>error(validate({...field,required:field.required&&!request.allowPartial},input)[0]));
  return {wrap,input,error,field};}
function render(){
  attachments?.dispose();submission='editing';lockedAnswers=null;
  attachments=createAttachments({api,changed:()=>updateAction(),expired:unavailable});
  const shell=el('div','relay-layout'),intro=el('header','relay-intro');
  intro.append(el('h1','',request.title||request.form.title));
  if(request.instructions)intro.append(el('p','relay-description',request.instructions));
  if(request.expiresAt&&!Number.isNaN(Date.parse(request.expiresAt)))intro.append(el('p','relay-deadline',`متاح حتى ${new Intl.DateTimeFormat('ar-EG',{dateStyle:'medium'}).format(new Date(request.expiresAt))}`));
  shell.append(intro);
  const form=el('form','relay-form');form.noValidate=true;form.setAttribute('aria-label','نموذج الرد');
  const fields=el('fieldset','relay-fields'),controls=[];fields.append(el('legend','visually-hidden','المعلومات المطلوبة'));
  for(const [index,field] of request.form.fields.entries()){if(!supported.has(field.type))continue;const control=fieldView(field,index);controls.push(control);fields.append(control.wrap);}
  const actions=el('div','relay-actions'),submit=el('button','button','إرسال الرد'),guidance=el('p','field-hint');
  guidance.id='submission-guidance';guidance.role='status';submit.type='submit';submit.setAttribute('aria-describedby',guidance.id);actions.append(submit,guidance);
  if(request.allowPartial)actions.append(el('p','relay-partial','أرسل ما يتوفر لديك من المعلومات أو المرفقات.'));
  form.append(fields,actions);shell.append(form);show(shell);
  function collect(showErrors=false){
    const answers={};let first,message='';
    for(const control of controls){
      const {field,input,error}=control;let issue='',value;
      if(['attachments','evidence'].includes(field.type)){
        const rows=attachments.rows(field.key);issue=attachments.problem(field.key);
        if(!issue&&field.required&&!request.allowPartial&&!rows.length)issue='أضف مرفقًا واحدًا على الأقل.';
        value=rows.filter(r=>['processing','ready'].includes(r.state)).map(r=>r.id);
        if(value.length)answers[field.key]=value;
      }else{
        [issue,value]=validate({...field,required:field.required&&!request.allowPartial},input);
        if(!issue&&value!==''&&!(field.type==='boolean'&&!value&&!field.required))answers[field.key]=value;
      }
      if(showErrors)error(issue);
      if(issue){first??=input;message ||= issue;}
    }
    if(!message&&!Object.keys(answers).length)message='أضف المعلومات أو المرفقات المطلوبة لتتمكن من الإرسال.';
    return {answers,first,message};
  }
  updateAction=()=>{
    if(!form.isConnected)return;
    const {message}=collect();
    submit.disabled=submission==='submitting'||(submission!=='uncertain'&&!!message)||requestState!=='active';
    submit.textContent=submission==='submitting'?'جارٍ الإرسال…':submission==='uncertain'?'التحقق وإعادة الإرسال':'إرسال الرد';
    guidance.textContent=submission==='uncertain'?'لم نتأكد من استلام الرد. أعد المحاولة بنفس البيانات بأمان.':message;
    fields.disabled=['submitting','uncertain'].includes(submission);
  };
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(submission==='submitting'||requestState!=='active')return;
    const result=collect(true);
    if(submission!=='uncertain'&&result.message){result.first?.focus();updateAction();return;}
    const answers=lockedAnswers||result.answers,serialized=JSON.stringify(answers);
    if(serialized!==draftAnswers){draftKey=`reply-${crypto.randomUUID()}`;draftAnswers=serialized;}
    submission='submitting';updateAction();notice('');
    try{
      const response=await api.submit(draftKey,answers,receipt&&request.allowMultiple?receipt.submissionId:undefined);
      if(!response?.submissionId||!['SUBMITTED','EVIDENCE_PENDING'].includes(response.status))throw new RelayError(0,'ambiguous');
      receipt=response;submission='submitted';attachments.dispose();
      state('تم استلام ردك','شكرًا لتعاونكم. '+(receipt.status==='EVIDENCE_PENDING'?'تم استلام المعلومات والمرفقات، وجارٍ تجهيزها.':'تم إرسال المعلومات بنجاح.')+' يمكنك إغلاق هذه الصفحة الآن.',request.allowMultiple?button('إضافة معلومات أخرى',()=>{draftKey=null;draftAnswers=null;render();}):null);
      root.querySelector('h1').tabIndex=-1;root.querySelector('h1').focus();
    }catch(error){
      if(error.status===410)return unavailable(error);
      // Keep the exact payload/key after an ambiguous outcome; edits could create a second response.
      if(!error.status||error.status>=500){submission='uncertain';lockedAnswers=answers;notice('انقطع التأكيد قبل معرفة النتيجة. بقيت معلوماتك محفوظة في هذه الصفحة.');}
      else {submission='failed';lockedAnswers=null;notice(error.status===409?'تعذّر قبول الرد. تواصل مع المرسل للتأكد من حالة الطلب.':`لم يتم إرسال الرد. ${userError(error)}`);}
      if(error.field){const control=controls.find(c=>c.field.key===error.field);control?.error('تحقق من هذه الإجابة.');control?.input.focus();}
    }finally{updateAction();}
  });
  updateAction();
}
load();
