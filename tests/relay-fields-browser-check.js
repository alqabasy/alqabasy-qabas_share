async page => {
 const results=[],check=(ok,name)=>{if(!ok)throw new Error(name);results.push(name);};
 const origin='http://127.0.0.1:8000',html=await (await page.request.get(origin+'/relay.html')).text();
 const fields=[{key:'text',type:'text',label:'الاسم',required:true},{key:'notes',type:'multiline_text',label:'التفاصيل'},{key:'count',type:'integer',label:'العدد',constraints:{min:1,max:9}},{key:'date',type:'date',label:'التاريخ'},{key:'choice',type:'select',label:'الاختيار',constraints:{options:[{label:'الأول',value:'one'}]}},{key:'confirm',type:'boolean',label:'تأكيد',required:true},{key:'evidence',type:'evidence',label:'المستند',constraints:{allowedMediaTypes:['application/pdf'],maxFiles:1}}];
 let status=200,payload;
 await page.route(origin+'/r/**',r=>r.fulfill({contentType:'text/html',body:html}));
 await page.route('https://api.alqabasy.com/**',r=>{if(r.request().url().endsWith('/submissions')){payload=JSON.parse(r.request().postData());return r.fulfill({contentType:'application/json',body:JSON.stringify({success:true,data:{status:'SUBMITTED',submissionId:'receipt'}})});}return r.fulfill({status,contentType:'application/json',body:JSON.stringify(status===200?{success:true,data:{title:'عنوان طلب عربي طويل '.repeat(8),instructions:'تعليمات الطلب '.repeat(30),status:'OPEN',allowPartial:false,allowMultiple:false,form:{schemaVersion:1,fields}}}:{success:false,error:{code:'fixture'}})});});
 const open=()=>page.goto(origin+'/r/'+'B'.repeat(43));
 await open();await page.getByLabel('الاسم').fill('مورد');await page.getByLabel('التفاصيل').fill('نص متعدد السطور\nللتأكد من الحفاظ على الإجابة');await page.getByLabel('العدد').fill('۹');await page.getByLabel('التاريخ').fill('2026-11-28');await page.getByLabel('الاختيار').selectOption('one');await page.getByLabel('تأكيد').check();
 check(await page.getByRole('button',{name:'إرسال الرد',exact:true}).isEnabled(),'all non-attachment field types work');
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'long Arabic text wraps '+width);}
 await page.getByRole('button',{name:'إرسال الرد',exact:true}).click();await page.getByRole('heading',{name:'تم استلام ردك',exact:true}).waitFor();check(payload.answers.count==='9'&&payload.answers.confirm===true&&payload.answers.choice==='one'&&payload.answers.date==='2026-11-28','dynamic values preserve contract');check(await page.getByRole('button',{name:'إضافة معلومات أخرى'}).count()===0,'single response has no additional action');
 await page.screenshot({path:'output/playwright/relay-success.png',fullPage:true});
 for(const code of [401,404,410,503]){status=code;await open();await page.waitForTimeout(100);check(await page.locator('form').count()===0,'request HTTP '+code+' is contextual');}
 status=200;await page.getByRole('button',{name:'المحاولة مجددًا'}).click();await page.getByLabel('الاسم').waitFor();check(await page.locator('form').count()===1,'temporary request failure recovers');
 return results;
}
