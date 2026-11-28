import test from 'node:test';
import assert from 'node:assert/strict';
import {fileError,limits,attachmentProblem,userError,recoverable,evidencePresentation} from '../assets/relay-state.js';
const field={constraints:{maxFiles:7,allowedMediaTypes:['application/pdf']}};
const file={name:'statement.pdf',size:100,type:'application/pdf',lastModified:1};
test('configured counts are honored without the previous five-file cap',()=>{
 assert.equal(limits(field).count,7);
 assert.equal(fileError(field,file,Array.from({length:6},(_,i)=>({state:'ready',file:{...file,name:`${i}.pdf`}}))), '');
});
test('duplicate, removed, unsupported, oversized and empty files',()=>{
 assert.match(fileError(field,file,[{state:'ready',file}]),/بالفعل/);
 assert.equal(fileError(field,file,[{state:'removed',file}]),'');
 assert.match(fileError(field,{...file,type:'text/html'},[]),/غير مدعوم/);
 assert.match(fileError(field,{...file,size:51*1024*1024},[]),/حجم/);
 assert.match(fileError(field,{...file,size:0},[]),/فارغ/);
});
test('no pending transfers or failed attachments are silently omitted',()=>{
 assert.ok(attachmentProblem([{state:'ready'},{state:'uploading'}]));
 assert.ok(attachmentProblem([{state:'ready'},{state:'failed'}]));
 assert.equal(attachmentProblem([{state:'processing'},{state:'removed'}]),'');
});
test('error policy never exposes raw responses and separates permanent failures',()=>{
 assert.equal(recoverable({status:413}),false);
 assert.equal(recoverable({status:503}),true);
 assert.equal(recoverable({status:0}),true);
 assert.ok(!userError({status:500,message:'secret-token'}).includes('secret'));
});


test('structured evidence errors distinguish count, size and other conflicts',()=>{
 assert.match(userError({status:409,code:'evidence.file_limit_reached',params:{maxFiles:20,activeFiles:20}}),/٢٠/);
 assert.match(userError({status:413,code:'evidence.file_too_large',params:{maxBytes:52428800}}),/بايت/);
 assert.equal(userError({status:409,code:'evidence.abandon_unavailable'}),'تم إرسال هذا المرفق بالفعل ولا يمكن إزالته.');
 assert.equal(userError({status:409,code:'conflict',message:'Another conflict.'}),'تعذّر قبول العملية. ربما تغيّرت حالة الطلب.');
});
test('verified defaults and removal gate',()=>{
 assert.equal(limits({}).count,20);assert.equal(limits({}).bytes,50*1024*1024);
 assert.equal(fileError({}, {...file,size:50*1024*1024},[]),'');
 assert.ok(attachmentProblem([{state:'ready'},{state:'removing'}]));
});
test('server recovery actions distinguish temporary scan errors from rejection',()=>{
 assert.deepEqual(evidencePresentation({status:'READY',action:'NONE'}),{state:'ready',retryable:false,error:''});
 assert.equal(evidencePresentation({status:'FAILED',failureCode:'SCAN_UNAVAILABLE',retryable:true,action:'WAIT_OR_CONTACT_SUPPORT'}).retryable,true);
 assert.equal(evidencePresentation({status:'REJECTED',action:'START_NEW_UPLOAD',retryable:false}).retryable,false);
 assert.equal(evidencePresentation({status:'PENDING_UPLOAD',action:'UPLOAD_BYTES'}).state,'failed');
 assert.equal(evidencePresentation({status:'PENDING_UPLOAD',action:'WAIT_FOR_SCAN'}).state,'processing');
});
