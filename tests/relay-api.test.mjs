import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayApi,RelayError} from '../assets/relay-api.js';

test('Relay client follows the documented endpoints and envelopes',async()=>{
  const original=globalThis.fetch,calls=[];
  globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({success:true,data:{ok:true}}),{status:options.method==='GET'?200:201});};
  try{const api=createRelayApi('https://api.alqabasy.com/','A'.repeat(43));await api.get();await api.createUpload('attachments',{name:'a.pdf',type:'application/pdf',size:12});await api.evidence('evidence-id');await api.submit('reply-stable-key',{amount:'123.45',attachments:['evidence-id']});assert.deepEqual(calls.map(c=>[c.options.method,new URL(c.url).pathname]),[['GET',`/api/v1/r/${'A'.repeat(43)}`],['POST',`/api/v1/r/${'A'.repeat(43)}/uploads`],['GET',`/api/v1/r/${'A'.repeat(43)}/evidence/evidence-id`],['POST',`/api/v1/r/${'A'.repeat(43)}/submissions`]]);assert.equal(JSON.parse(calls[3].options.body).idempotencyKey,'reply-stable-key');assert.equal(calls[0].options.referrerPolicy,'no-referrer');assert.equal(calls[0].options.cache,'no-store');}finally{globalThis.fetch=original;}
});
test('Relay errors retain status and code without leaking the token',async()=>{const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({success:false,error:{code:'EXPIRED',message:'Expired'}}),{status:410});try{await assert.rejects(createRelayApi('https://api.alqabasy.com','A'.repeat(43)).get(),e=>e instanceof RelayError&&e.status===410&&e.code==='EXPIRED');}finally{globalThis.fetch=original;}});

test('completion sends the original binary only, never JSON or base64',async()=>{
 const original=globalThis.fetch;let captured;
 globalThis.fetch=async(url,options)=>{captured={url,options};return new Response(JSON.stringify({success:true,data:{evidenceId:'e1'}}));};
 try{const file=new Blob(['original bytes'],{type:'application/pdf'});await createRelayApi('https://api.example','A'.repeat(43)).completeUpload('session',file);assert.equal(captured.options.body,file);assert.equal(captured.options.headers['Content-Type'],'application/octet-stream');assert.match(captured.url,/uploads\/session\/complete$/);}finally{globalThis.fetch=original;}
});
test('network failures map to typed errors and caller abort is preserved',async()=>{
 const original=globalThis.fetch;
 try{globalThis.fetch=async()=>{throw new TypeError('Failed to fetch');};await assert.rejects(createRelayApi('https://api.example','A'.repeat(43)).get(),e=>e instanceof RelayError&&e.code==='network');
 globalThis.fetch=async()=>{throw new DOMException('Aborted','AbortError');};await assert.rejects(createRelayApi('https://api.example','A'.repeat(43)).get(),e=>e.name==='AbortError');}finally{globalThis.fetch=original;}
});

test('a malformed successful response is an ambiguous outcome',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('<html>proxy</html>',{status:200});
 try{await assert.rejects(createRelayApi('https://api.example','A'.repeat(43)).submit('same-key',{value:'1'}),e=>e.code==='ambiguous'&&e.status===0);}finally{globalThis.fetch=original;}
});
