async (page) => {
  const results=[];
  const check=(value,name)=>{if(!value)throw new Error(name);results.push(name);};
  const origin='http://127.0.0.1:8000';
  const html=await (await page.request.get(origin+'/relay.html')).text();
  const fixture={title:'تأكيد رصيد الحساب',instructions:'برجاء إرسال رصيد الحساب وكشف الحساب المتاح لديكم.',expiresAt:'2099-12-01T00:00:00Z',status:'OPEN',allowPartial:true,allowMultiple:true,form:{schemaVersion:1,fields:[{key:'balance',type:'decimal',label:'رصيد الحساب',required:true},{key:'files',type:'attachments',label:'المرفقات',required:true,constraints:{maxFiles:3,allowedMediaTypes:['application/pdf','image/png']}}]}};
  let mode='ready',requests=[],uploads=0,submissions=[],release;
  const envelope=(route,data,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify({success:status<400,...(status<400?{data}:{error:{code:'fixture'}})})});
  await page.route(origin+'/r/**',route=>route.fulfill({contentType:'text/html',body:html}));
  await page.route('**/env-config.js',route=>route.fulfill({contentType:'text/javascript',body:''}));
  await page.route('https://api.alqabasy.com/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;requests.push(path);
    if(path.endsWith('/uploads')){uploads++;return envelope(route,{sessionId:'s'+uploads});}
    if(path.endsWith('/complete')){
      if(mode==='hold')await new Promise(resolve=>release=resolve);
      if(mode==='413')return envelope(route,{},413);
      if(mode==='network')return route.abort();
      return envelope(route,{evidenceId:'e'+uploads});
    }
    if(path.includes('/evidence/'))return envelope(route,{status:mode==='processing'?'PROCESSING':mode==='rejected'?'REJECTED':'READY'});
    if(path.endsWith('/submissions')){submissions.push(JSON.parse(req.postData()));if(mode==='submit-network'){mode='ready';return route.abort();}if(mode==='submit-fail')return envelope(route,{},422);return envelope(route,{status:'SUBMITTED',submissionId:'response-1'});}
    return envelope(route,fixture);
  });
  const open=async()=>{await page.goto(origin+'/r/'+'A'.repeat(43));await page.getByRole('heading',{name:fixture.title}).waitFor();};
  const file=(name='statement.pdf')=>({name,mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nfixture')});
  const pick=async files=>page.locator('input[type=file]').first().setInputFiles(files);
  const send=()=>page.getByRole('button',{name:'إرسال الرد',exact:true});
  await open();check(await send().isDisabled(),'empty response disabled');
  await page.getByRole('textbox').fill('-١٢٣٫٤٥');check(await send().isEnabled(),'balance only enabled');
  await send().dblclick();await page.getByRole('heading',{name:'تم استلام ردك',exact:true}).waitFor();check(submissions.length===1&&submissions[0].answers.balance==='-123.45','Arabic negative value and double submit guard');
  await page.getByRole('button',{name:'إضافة معلومات أخرى'}).click();await page.getByRole('textbox').fill('١');await send().click();await page.getByRole('heading',{name:'تم استلام ردك',exact:true}).waitFor();check(submissions[1].supersedesSubmissionId==='response-1','additional response retains contract');
  await open();mode='hold';await pick(file());await page.locator('.relay-tile[data-state=uploading]').waitFor();check(await send().isDisabled(),'upload blocks submit');check(await page.getByRole('button',{name:'إزالة statement.pdf'}).isVisible(),'upload cancellation available');
  await page.getByRole('button',{name:'إزالة statement.pdf'}).click();release();await page.waitForTimeout(100);check(await page.locator('.relay-tile').count()===0,'removed upload cannot reappear');
  mode='processing';await page.evaluate(()=>document.addEventListener('change',e=>{if(e.target.type==='file'&&e.target.files.length)window.fixtureFile=e.target.files[0];},{capture:true}));await pick(file());await page.locator('.relay-tile[data-state=processing]').waitFor();check(await send().isEnabled(),'processing evidence accepted per contract');
  await page.evaluate(()=>{const input=document.querySelector('input[type=file]'),transfer=new DataTransfer();transfer.items.add(window.fixtureFile);input.files=transfer.files;input.dispatchEvent(new Event('change'));});check((await page.locator('.relay-error').allTextContents()).join('').includes('بالفعل'),'duplicate prevented');
  await page.getByRole('button',{name:'معاينة statement.pdf'}).click();check(await page.getByRole('dialog').isVisible(),'PDF preview opens');await page.keyboard.press('Escape');
  mode='ready';await open();await pick([file('one.pdf'),file('two.pdf'),file('three.pdf'),file('four.pdf')]);await page.locator('.relay-tile[data-state=ready]').first().waitFor();check(await page.locator('.relay-tile').count()===3,'configured attachment limit');
  check(await send().isEnabled(),'attachments only enabled');
  await open();await pick({name:'bad.html',mimeType:'text/html',buffer:Buffer.from('test')});check(await page.locator('.relay-tile').count()===0,'unsupported file blocked');
  await pick({name:'large.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(21*1024*1024)});check(await page.locator('.relay-tile').count()===0,'oversized file blocked');
  mode='ready';await pick(file('good.pdf'));await page.locator('.relay-tile[data-state=ready]').waitFor();mode='413';await pick(file('bad.pdf'));await page.locator('.relay-tile[data-state=failed]').waitFor();check(await send().isDisabled(),'mixed failure blocks submission');check(await page.locator('.relay-tile[data-state=failed]').getByText('محاولة مجددًا').isHidden(),'permanent failure has no retry');await page.getByRole('button',{name:'إزالة bad.pdf'}).click();check(await send().isEnabled(),'removal restores eligibility');
  mode='submit-fail';await send().click();await page.locator('#relay-notice').filter({hasText:'لم نتمكن'}).waitFor();check(await page.locator('.relay-tile[data-state=ready]').count()===1,'submission failure preserves attachments');
  mode='submit-network';await send().click();await page.getByRole('button',{name:'التحقق وإعادة الإرسال'}).waitFor();check(await page.getByRole('textbox').isDisabled(),'ambiguous response freezes payload');const previous=submissions.at(-1);await page.getByRole('button',{name:'التحقق وإعادة الإرسال'}).click();await page.getByRole('heading',{name:'تم استلام ردك',exact:true}).waitFor();check(JSON.stringify(previous)===JSON.stringify(submissions.at(-1)),'ambiguous retry uses identical payload and key');
  mode='ready';fixture.allowPartial=false;await open();await page.getByRole('textbox').fill('10');check(await send().isDisabled(),'required attachment retained under strict policy');await pick(file());await page.locator('.relay-tile[data-state=ready]').waitFor();check(await send().isEnabled(),'strict required fields satisfied');
  for(const status of ['EXPIRED','CANCELLED','FULFILLED','ANSWERED']){fixture.status=status;fixture.allowMultiple=false;await page.goto(origin+'/r/'+'A'.repeat(43));await page.waitForTimeout(100);check(await page.locator('form').count()===0,'request state '+status);}
  fixture.status='OPEN';fixture.allowPartial=true;fixture.allowMultiple=true;await open();
  for(const width of [320,360,390,430,768,1024,1440]){await page.setViewportSize({width,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow '+width);}
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:'output/playwright/relay-after-mobile.png',fullPage:true});
  await pick([{name:'صورة كشف الحساب.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5ZkAAAAASUVORK5CYII=', 'base64')},file('كشف حساب طويل للتأكد من اتجاه النص.pdf')]);await page.locator('.relay-tile[data-state=ready]').first().waitFor();await page.screenshot({path:'output/playwright/relay-gallery-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:'output/playwright/relay-after-desktop.png',fullPage:true});
  return results;
}
