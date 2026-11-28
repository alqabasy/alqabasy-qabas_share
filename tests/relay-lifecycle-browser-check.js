async page => {
 const results=[],check=(ok,name)=>{if(!ok)throw new Error(name);results.push(name);};
 await page.goto('http://127.0.0.1:8001/__demo/');
 await page.clock.install();
 await page.evaluate(async()=>{
  const {createAttachments}=await import('/assets/relay-attachments.js');
  const host=document.createElement('div');host.id='lifecycle-fixture';document.body.replaceChildren(host);
  window.fixtureMode='processing';window.fixturePolls=0;window.fixtureTransfers=0;window.fixtureUrls=[];
  const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.fixtureUrls.push(url);revoke(url);};
  window.fixtureAttachments=createAttachments({api:{abandonEvidence:async id=>({evidenceId:id,failureCode:'USER_ABANDONED'}),createUpload:async()=>({sessionId:'session'}),completeUpload:async()=>{window.fixtureTransfers++;return {evidenceId:'evidence'};},evidence:async()=>{window.fixturePolls++;if(window.fixtureMode==='network')throw {status:0};return {status:window.fixtureMode==='ready'?'READY':window.fixtureMode==='rejected'?'REJECTED':'PROCESSING'};}},changed:()=>{},expired:()=>{}});
  host.append(window.fixtureAttachments.mount({key:'files',label:'المرفقات',constraints:{maxFiles:5}},0).wrap);
 });
 const pick=async()=>page.locator('input[type=file]').first().setInputFiles({name:'one.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4')});
 await pick();await page.locator('.relay-tile[data-state=processing]').waitFor();
 for(let i=0;i<25;i++)await page.clock.runFor(31000);
 check(await page.locator('.relay-tile[data-state=failed]').count()===1,'slow processing bounded');
 await page.evaluate(()=>window.fixtureMode='ready');await page.getByRole('button',{name:'التحقق مجددًا'}).click();await page.locator('.relay-tile[data-state=ready]').waitFor();
 check(await page.evaluate(()=>window.fixtureTransfers===1),'processing retry never reuploads evidence');
 await page.getByRole('button',{name:'إزالة one.pdf'}).click();check(await page.evaluate(()=>window.fixtureUrls.length===1),'removal releases object URL');
 await page.evaluate(()=>window.fixtureMode='network');await pick();for(let i=0;i<4;i++)await page.clock.runFor(120000);
 check(await page.locator('.relay-tile[data-state=failed]').count()===1,'poll network retry bounded');
 await page.evaluate(()=>window.fixtureMode='ready');await page.getByRole('button',{name:'التحقق مجددًا'}).click();await page.locator('.relay-tile[data-state=ready]').waitFor();check(await page.evaluate(()=>window.fixtureTransfers===2),'poll network recovery reuses evidence');
 await page.evaluate(()=>window.fixtureAttachments.dispose());check(await page.evaluate(()=>window.fixtureUrls.length>=2),'disposal releases previews');
 await page.clock.resume();
 const context=await page.context().browser().newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const mobile=await context.newPage();await mobile.goto('http://127.0.0.1:8001/__demo/');await mobile.getByRole('button',{name:'إضافة صور أو مستندات'}).click();
 check(await mobile.getByRole('dialog').isVisible(),'touch device opens accessible choice sheet');
 const chooserPromise=mobile.waitForEvent('filechooser');await mobile.getByRole('button',{name:'التقاط صورة',exact:true}).click();const chooser=await chooserPromise;
 check(await chooser.element().getAttribute('capture')==='environment','camera delegates to native rear camera');await chooser.setFiles([]);
 await mobile.getByRole('button',{name:'إضافة صور أو مستندات'}).click();await mobile.keyboard.press('Escape');check(await mobile.getByRole('button',{name:'إضافة صور أو مستندات'}).evaluate(e=>e===document.activeElement),'sheet restores keyboard focus');
 await context.close();return results;
}

