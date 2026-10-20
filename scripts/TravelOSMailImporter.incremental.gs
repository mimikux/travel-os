/**
 * Travel OS Gmail -> Supabase incremental import (2026-10-19)
 * Keep the existing CONFIG with ENDPOINT, SECRET, MAILBOX above this file.
 * Do not put CONFIG.SECRET on a public GitHub repository.
 *
 * Set one Apps Script time trigger: importTravelMail, every 15 minutes.
 * Remove the earlier 5-minute trigger, otherwise both will run.
 * To backfill older messages temporarily, increase LOOKBACK_DAYS and reset
 * the stored cursor flags for selected IDs only; do not clear production data.
 */
const IMPORT_OPTIONS = Object.freeze({
  LOOKBACK_DAYS: 14,
  THREADS_PER_SCAN: 30,
  MESSAGES_PER_RUN: 8,
  BATCH_SIZE: 8
});

/**
 * Read PDFs only for recognized airline e-ticket emails. This conversion
 * requires Apps Script Advanced Google service "Drive API" (v3) plus Drive
 * access authorization. Temporary Google Docs are always trashed/deleted.
 *
 * It deliberately avoids external PDF/OCR SaaS and logs no private text.
 * For scanned PDFs, Drive conversion may be imperfect: human review stays on.
 */
function extractAirlinePdfText_(mail, attachments) {
  const forwarded=String(mail.getPlainBody()||'');
  const subject=String(mail.getSubject()||'');
  if(!(/中華航空.*電子機票|China Airlines.*e-?Ticket/i.test(subject)
    && /(?:eticket@amadeus\.com|chinaairlines\.com)/i.test(forwarded+' '+mail.getFrom()))) return '';
  const pdfs=attachments.filter(a=>/\.pdf$/i.test(String(a.getName()||''))
    && a.getSize()>0 && a.getSize()<=6*1024*1024).slice(0,2);
  const chunks=[];
  for (const attachment of pdfs) {
    let tempId='';
    try {
      // Drive.Files.create comes from the Advanced Drive API, not DriveApp.
      const temp=Drive.Files.create({
        name:'Travel OS temporary PDF extraction',
        mimeType:'application/vnd.google-apps.document'
      },attachment.copyBlob(),{fields:'id',ocrLanguage:'en'});
      tempId=String(temp.id||'');
      if(!tempId)throw new Error('Missing temporary Drive file ID');
      const readable=DocumentApp.openById(tempId).getBody().getText().trim();
      if(readable.length>=25){
        chunks.push('[[Travel OS PDF text: '+attachment.getName()+']]\n'
          +readable.slice(0,85000)+'\n[[End Travel OS PDF text]]');
      }else{
        console.warn('PDF converted but yielded insufficient text: '+attachment.getName());
      }
    }catch(err){
      console.warn('PDF extraction failed ('+attachment.getName()+'): '+String(err?.message||err));
    }finally{
      if(tempId)try{Drive.Files.delete(tempId)}catch(e){
        console.warn('Could not delete temporary converted PDF: '+tempId);
      }
    }
  }
  return chunks.join('\n\n');
}

function importTravelMail(){
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(1000))return;
  try{
    const store=PropertiesService.getScriptProperties();
    const search='in:inbox newer_than:'+IMPORT_OPTIONS.LOOKBACK_DAYS+'d '+
      '-from:noreply-apps-scripts-notifications@google.com '+
      '-subject:"Summary of failures for Google Apps Script:"';
    const threads=GmailApp.search(search,0,IMPORT_OPTIONS.THREADS_PER_SCAN);
    const messages=[];
    for(const thread of threads){
      for(const mail of thread.getMessages()){
        if(!mail.isInInbox())continue;
        const id=mail.getId();
        if(store.getProperty('travel-ingest:'+id)==='ok')continue;
        if(/Summary of failures for Google Apps Script:/i.test(mail.getSubject()))continue;
        if(/noreply-apps-scripts-notifications@google\.com/i.test(mail.getFrom()))continue;
        messages.push({mail,thread,id});
      }
    }
    messages.sort((a,b)=>a.mail.getDate().getTime()-b.mail.getDate().getTime());
    const selected=messages.slice(0,IMPORT_OPTIONS.MESSAGES_PER_RUN);
    if(!selected.length){console.log('No new eligible mail.');return;}
    for(let offset=0;offset<selected.length;offset+=IMPORT_OPTIONS.BATCH_SIZE){
      const items=selected.slice(offset,offset+IMPORT_OPTIONS.BATCH_SIZE);
      const payload={mailboxEmail:CONFIG.MAILBOX,messages:items.map(({mail,thread,id})=>{
        const attachments=mail.getAttachments({includeInlineImages:false});
        const original=mail.getPlainBody();
        const pdfText=extractAirlinePdfText_(mail,attachments);
        return ({
        id,
        threadId:thread.getId(),
        date:mail.getDate().toISOString(),
        from:mail.getFrom(),
        to:String(mail.getTo()||'').split(',').map(s=>s.trim()).filter(Boolean),
        subject:mail.getSubject(),
        body:(original.slice(0,90000)+(pdfText?'\n\n'+pdfText:'')).slice(0,180000),
        // Metadata only. Do not call getBytes() on every attachment:
        // repeatedly reading attachment bodies is a major quota expense.
        attachments:attachments.map(a=>({
          name:a.getName(),mimeType:a.getContentType(),size:a.getSize()
        }))
      });}))};
      const response=UrlFetchApp.fetch(CONFIG.ENDPOINT,{
        method:'post',
        contentType:'application/json',
        headers:{'x-travel-ingest-secret':CONFIG.SECRET},
        payload:JSON.stringify(payload),
        muteHttpExceptions:true
      });
      const status=response.getResponseCode();
      let data={};
      try{data=JSON.parse(response.getContentText())}catch(_){}
      if(status<200||status>=300||data.ok!==true){
        console.error('Upload failed status='+status+' error='+String(data.error||'unknown'));
        return; // do not mark attempted messages as processed
      }
      for(const {id} of items)store.setProperty('travel-ingest:'+id,'ok');
      console.log('Imported or already known: '+items.length);
    }
  }catch(err){
    const message=String(err?.message||err);
    if(/Service invoked too many times|Limit Exceeded|quota/i.test(message)){
      console.warn('Gmail quota reached. Skip until next trigger; no crash: '+message);
      return;
    }
    console.error('Travel OS importer failed: '+message);
    // Avoid creating an endless Google script failure notification loop.
  }finally{lock.releaseLock();}
}
/** Run once to remove duplicate importTravelMail triggers, then create one 15m trigger. */
function installTravelMailTrigger15m(){
  for(const trigger of ScriptApp.getProjectTriggers()){
    if(trigger.getHandlerFunction()==='importTravelMail')ScriptApp.deleteTrigger(trigger);
  }
  ScriptApp.newTrigger('importTravelMail').timeBased().everyMinutes(15).create();
  console.log('One 15-minute importer trigger installed.');
}
