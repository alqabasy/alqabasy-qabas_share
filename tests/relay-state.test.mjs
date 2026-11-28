import test from 'node:test';
import assert from 'node:assert/strict';
import {fileError,limits,attachmentProblem,userError,recoverable} from '../assets/relay-state.js';
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
 assert.match(fileError(field,{...file,size:21*1024*1024},[]),/حجم/);
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
