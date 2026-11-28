/** @typedef {{key:string,type:string,label:string,required:boolean,description?:string,placeholder?:string,errorMessage?:string,constraints?:Record<string,any>}} RelayField */
/** @typedef {{schemaVersion:number,locale:string,title:string,fields:RelayField[]}} RelayForm */
/** @typedef {{title:string,instructions?:string,expiresAt:string,allowPartial:boolean,allowMultiple:boolean,status:string,form:RelayForm}} RelayRequest */
export class RelayError extends Error {
  constructor(status, code, message, field, messageKey, params) { super(message || code || 'request_failed'); this.status=status; this.code=code; this.field=field; this.messageKey=messageKey; this.params=params; }
}
export function createRelayApi(origin, token) {
  const base = `${origin.replace(/\/+$/, '')}/api/v1/r/${encodeURIComponent(token)}`;
  async function call(path='', method='GET', body, binary=false, onProgress, signal) {
    const url=base+path;
    const headers={Accept:'application/json'};
    if (body !== undefined) headers['Content-Type']=binary?'application/octet-stream':'application/json';
    if (binary && onProgress) {
      return await new Promise((resolve,reject)=>{
        const xhr=new XMLHttpRequest(); xhr.open(method,url); xhr.withCredentials=false;
        xhr.setRequestHeader('Accept','application/json'); xhr.setRequestHeader('Content-Type','application/octet-stream');
        const abort=()=>xhr.abort();
        signal?.addEventListener('abort',abort,{once:true});
        xhr.onloadend=()=>signal?.removeEventListener('abort',abort);
        xhr.timeout=120000;
        xhr.ontimeout=()=>reject(new RelayError(0,'timeout'));
        xhr.onabort=()=>reject(new DOMException('Aborted','AbortError'));
        if(signal?.aborted){signal.removeEventListener('abort',abort);reject(new DOMException('Aborted','AbortError'));return;}
        xhr.upload.onprogress=e=>{ if(e.lengthComputable) onProgress(Math.round(e.loaded/e.total*100)); };
        xhr.onerror=()=>reject(new RelayError(0,'network','Network error'));
        xhr.onload=()=>{let payload={};try{payload=JSON.parse(xhr.responseText)}catch{}; if(xhr.status<200||xhr.status>=300||payload.success!==true) reject(new RelayError(xhr.status,payload.error?.code,payload.error?.message,payload.error?.field,payload.error?.messageKey,payload.error?.params));else resolve(payload.data);};
        xhr.send(body);
      });
    }
    const controller=new AbortController();
    const abort=()=>controller.abort();
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)controller.abort();
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},30000);
    try {
    const response=await fetch(url,{method,headers,body:body===undefined?undefined:binary?body:JSON.stringify(body),cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
    const payload=await response.json().catch(()=>({}));
    if(response.ok&&typeof payload.success!=='boolean')throw new RelayError(0,'ambiguous');
    if(!response.ok||payload.success!==true) throw new RelayError(response.status,payload.error?.code,payload.error?.message,payload.error?.field,payload.error?.messageKey,payload.error?.params);
    return payload.data;
    } catch(error) {
      if(timedOut)throw new RelayError(0,'timeout');
      if(error.name==='AbortError'||error instanceof RelayError)throw error;
      throw new RelayError(0,'network');
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  return {
    /** @returns {Promise<RelayRequest>} */ get:()=>call(),
    createUpload:(fieldKey,file,signal)=>call('/uploads','POST',{fieldKey,name:file.name,mimeType:file.type,sizeBytes:file.size},false,undefined,signal),
    completeUpload:(sessionId,file,onProgress,signal)=>call(`/uploads/${encodeURIComponent(sessionId)}/complete`,'POST',file,true,onProgress,signal),
    evidence:(id,signal)=>call(`/evidence/${encodeURIComponent(id)}`,'GET',undefined,false,undefined,signal),
    abandonEvidence:(id,signal)=>call(`/evidence/${encodeURIComponent(id)}`,'DELETE',undefined,false,undefined,signal),
    submit:(idempotencyKey,answers,supersedesSubmissionId)=>call('/submissions','POST',{idempotencyKey,answers,...(supersedesSubmissionId?{supersedesSubmissionId}:{})})
  };
}
