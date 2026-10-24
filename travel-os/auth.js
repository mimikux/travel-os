(() => {
  const cfg=window.TRAVEL_CONFIG;
  let client=null;
  let currentSession=null;
  let state='loading';
  let manualSignOut=false;
  let trustedDeviceApproved=false;
  let pairingInProgress=false;
  const LAST_ACTIVE_KEY='travel-os-last-active';
  const SIGNED_OUT_KEY='travel-os-explicit-signed-out-v1';
  const listeners=new Set();
  let authListenerAttached=false;

  function readLastActive(){
    try{return Number(localStorage.getItem(LAST_ACTIVE_KEY)||0)}catch(_){return 0}
  }
  function markActive(){
    try{localStorage.setItem(LAST_ACTIVE_KEY,String(Date.now()))}catch(_){}
  }
  function locallySignedOut(){try{return localStorage.getItem(SIGNED_OUT_KEY)==='1'}catch(_){return false}}
  function rememberSignOut(){try{localStorage.setItem(SIGNED_OUT_KEY,'1')}catch(_){}}
  function clearLocalSignOut(){try{localStorage.removeItem(SIGNED_OUT_KEY)}catch(_){}}
  function withinIdleWindow(){
    // Kept for compatibility with older callers. Trusted-device sessions no longer
    // expire because the app has been idle or backgrounded.
    return true;
  }

  function emit(){ for(const fn of listeners){ try{fn(snapshot())}catch(_){ } } }
  function withTimeout(promise,ms,label='timeout'){
    return Promise.race([
      promise,
      new Promise((_,reject)=>setTimeout(()=>reject(new Error(label)),ms))
    ]);
  }
  function snapshot(){ return {state,session:currentSession,user:currentSession?.user||null,cloudAuthenticated:Boolean(currentSession)}; }
  function setState(next){
    state=next;
    document.documentElement.dataset.authState=next;
    const gate=document.getElementById('authGate');
    const form=document.getElementById('magicLinkForm');
    const rootForm=document.getElementById('tripLinkForm');
    const msg=document.getElementById('authMessage');
    const foot=document.getElementById('authFoot');
    if(gate){
      const ready=(next==='ready'||next==='offline_ready')&&(!cfg.tripSlug||trustedDeviceApproved);
      gate.hidden=ready;
      gate.style.display=ready?'none':'';
      gate.setAttribute('aria-hidden',String(ready));
    }
    if(next==='ready') markActive();
    if(form){
      const showForm=['signed_out','reauth_required','unauthorized_email','device_error','sdk_error'].includes(next);
      form.hidden=!showForm;
      form.style.display=form.hidden?'none':'grid';
    }
    const showRoot=false;
    if(rootForm){rootForm.hidden=!showRoot;rootForm.style.display=showRoot?'grid':'none'}
    if(msg){
      if(next==='loading') msg.textContent='正在確認這台裝置的登入狀態…';
      else if(next==='registering_device') msg.textContent='已找到登入狀態，正在驗證 Trusted Device…';
      else if(next==='signed_out') msg.textContent='請輸入 Email 與一次性登入碼。';
      else if(next==='reauth_required') msg.textContent=navigator.onLine?'雲端登入尚未恢復。可使用 Owner 登入碼，或將 Magic Link 貼入此 App。':'此裝置沒有已授權的離線旅程，請連網登入一次後再使用離線模式。';
      else if(next==='redeeming_code') msg.textContent='正在驗證一次性登入碼並授權裝置…';
      else if(next==='unauthorized_email') msg.textContent='此信箱不在授權清單，請找 Trip Owner 加入再登入。';
      else if(next==='device_error') msg.textContent='帳號已登入，但這台裝置驗證失敗。請保持連線後重新整理。';
      else if(next==='sdk_error') msg.textContent='登入模組載入失敗，請重新整理。';
    }
    if(msg) msg.classList.toggle('auth-error',next==='unauthorized_email');
    if(foot){
      foot.textContent=next==='loading'||next==='registering_device'?'已授權裝置會自動登入，無須再次配對。':next==='reauth_required'?'重新配對不會覆蓋雲端行程或登出其他裝置。':'登入碼由 Owner 產生，有效 60 分鐘，每組只能使用一次，不寄驗證信。';
    }
    emit();
    if(showRoot&&msg)msg.textContent='主畫面 App 尚未登入。請貼上 Owner 分享的旅程連結，前往該旅程輸入登入碼。';
  }

  // Bind once, including clients created when the connection returns after an offline start.
  // Never call remote bootstrap while disconnected, which would replace the cached view.
  function attachAuthListener(){
    if(!client||authListenerAttached)return;
    authListenerAttached=true;
    client.auth.onAuthStateChange((event,session)=>{
      currentSession=session||null;
      if(!navigator.onLine && state==='offline_ready' && trustedDeviceApproved && !manualSignOut){
        setState('offline_ready');return;
      }
      if(locallySignedOut()&&!pairingInProgress){
        currentSession=null;trustedDeviceApproved=false;setState('signed_out');return;
      }
      if(currentSession){
        manualSignOut=false;
        if(!cfg.tripSlug){
          trustedDeviceApproved=true;
          setState(pairingInProgress?'redeeming_code':'ready');
        }else{
          const silent=state==='ready'&&trustedDeviceApproved;
          if(!silent)setState('registering_device');
          // An auth callback must not await another Supabase API call.
          setTimeout(()=>registerTrustedDevice({silent}).catch(()=>{}),0);
        }
      }else if(manualSignOut || locallySignedOut()){
        setState('signed_out');
      }else if(event==='SIGNED_OUT'){
        setTimeout(()=>resumeSessionCheck({keepReady:true}).catch(()=>{}),0);
      }
    });
  }
  function connectivityFailure(err){
    if(!navigator.onLine)return true;
    const message=String(err?.message||'')+' '+String(err?.name||'');
    return /failed to fetch|network(error| request)|err_internet_disconnected|fetch failed|load failed|aborted|timeout|functionsfetcherror/i.test(message);
  }

  let initPromise=null;
  async function init(){
    if(initPromise) return initPromise;
    initPromise=(async()=>{
    let localOfflineAccess=false;
    try{
      const device=await window.TravelStore.getDevice();
      if(locallySignedOut())throw new Error('explicit_sign_out');
      if(cfg.tripSlug){
        const cloudState=await window.TravelStore.getCloudState?.();
        const cachedTrip=await window.TravelStore.getTrip?.();
        localOfflineAccess=Boolean(
          device?.device_public_id && device?.device_secret &&
          (cloudState==="trusted_device" || cloudState?.state==="trusted_device") &&
          cachedTrip?.source==='cloud' && cachedTrip?.days?.length
        );
      }else{
        const cachedTrips=await window.TravelStore.listTrips?.();
        localOfflineAccess=Boolean(device?.device_public_id&&device?.device_secret&&cachedTrips?.some(t=>t.source==='cloud'));
      }
    }catch(_){ }
    if(!navigator.onLine){
      // No network calls or token-refresh races at cold start in airplane mode.
      // A trusted device with cached cloud data can read locally; first login cannot.
      if(localOfflineAccess){trustedDeviceApproved=true;setState('offline_ready');return snapshot();}
      setState('reauth_required');return snapshot();
    }
    if(!window.supabase?.createClient){
      if(localOfflineAccess){trustedDeviceApproved=true;setState('offline_ready');return snapshot();}
      setState('sdk_error');return snapshot();
    }
    client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    attachAuthListener();
    let sessionResult;
    try{
      sessionResult=await withTimeout(client.auth.getSession(),8000,'auth_session_timeout');
    }catch(err){
      console.warn('Initial auth session check timed out',err);
      if(localOfflineAccess){
        trustedDeviceApproved=true;setState('offline_ready');return snapshot();
      }
      setState('signed_out');
      return snapshot();
    }
    let {data}=sessionResult;
    currentSession=data.session||null;
    if(locallySignedOut()){
      currentSession=null;trustedDeviceApproved=false;setState('signed_out');return snapshot();
    }
    if(!currentSession){
      try{
        const refreshed=await withTimeout(client.auth.refreshSession(),8000,'auth_refresh_timeout');
        currentSession=refreshed?.data?.session||null;
      }catch(err){
        console.warn('Persisted auth refresh unavailable',err);
      }
    }
    if(!currentSession&&!locallySignedOut()){
      const restored=await resumeApprovedOwnerDevice();
      if(restored.ok)currentSession=restored.session;
    }
    if(currentSession){
      if(!cfg.tripSlug){
        trustedDeviceApproved=true;
        setState('ready');
      }else if(navigator.onLine){
        setState('registering_device');
        try{await registerTrustedDevice()}catch(err){
          if(localOfflineAccess&&connectivityFailure(err)){
            trustedDeviceApproved=true;setState('offline_ready');
          }
        }
      }else{
        trustedDeviceApproved=localOfflineAccess;
        setState(localOfflineAccess?'offline_ready':'reauth_required');
      }
    }else if(localOfflineAccess&&!locallySignedOut()){
      // A stale cloud login must not lock the user out of already downloaded
      // read-only data. Explicit sign-out still revokes this local fallback.
      trustedDeviceApproved=true;setState('offline_ready');
    }else if(state==='offline_ready'&&!navigator.onLine){
      setState('offline_ready');
    }else if(state==='offline_ready'&&localOfflineAccess&&!navigator.onLine){
      trustedDeviceApproved=true;setState('offline_ready');
    }else if(state==='offline_ready'){
      setState('reauth_required');
    }else if(state!=='ready') setState('signed_out');
    return snapshot();
    })().catch(err=>{
      console.error('Auth init failed',err);
      setState('signed_out');
      return snapshot();
    });
    return initPromise;
  }



  // Auth email links often open in a DIFFERENT Android browser context than
  // the installed PWA. A previously approved Owner Trusted Device can instead
  // obtain a one-time session in THIS app. No raw device secret is logged.
  let ownerRestorePending=null;
  let ownerRestoreLastAttempt=0;
  async function resumeApprovedOwnerDevice({force=false}={}){
    if(ownerRestorePending)return ownerRestorePending;
    if(manualSignOut||locallySignedOut())return {ok:false,reason:'not_available'};
    if(!client||!window.TravelStore?.getDevice)return {ok:false,reason:'client_not_ready'};
    if(!force&&Date.now()-ownerRestoreLastAttempt<20000)return {ok:false,reason:'cooldown'};
    ownerRestoreLastAttempt=Date.now();
    ownerRestorePending=(async()=>{
      try{
        const device=await window.TravelStore.getDevice();
        if(!/^[0-9a-f-]{36}$/i.test(String(device?.device_public_id||''))||
           !/^[0-9a-f]{64}$/i.test(String(device?.device_secret||'')))
          return {ok:false,reason:'invalid_local_device'};
        const res=await withTimeout(fetch(cfg.supabaseUrl+'/functions/v1/travel-owner-device-resume',{
          method:'POST',cache:'no-store',
          headers:{'Content-Type':'application/json','apikey':cfg.supabasePublishableKey},
          body:JSON.stringify({devicePublicId:device.device_public_id,deviceSecret:device.device_secret})
        }),12000,'device_resume_timeout');
        if(res.status===403)return {ok:false,reason:'device_not_approved'};
        if(!res.ok)return {ok:false,reason:'resume_service_unavailable'};
        const payload=await res.json();
        if(!payload?.ok||!payload?.tokenHash)return {ok:false,reason:'invalid_server_response'};
        const verified=await withTimeout(client.auth.verifyOtp({
          token_hash:payload.tokenHash,type:'magiclink'
        }),12000,'owner_resume_verify_timeout');
        if(verified?.error||!verified?.data?.session)return {ok:false,reason:'session_exchange_failed'};
        if(locallySignedOut()||manualSignOut)return {ok:false,reason:'explicit_signout'};
        currentSession=verified.data.session;
        if(!cfg.tripSlug){
          trustedDeviceApproved=true;
          setState('ready');
        }else{
          setState('registering_device');
          await registerTrustedDevice();
        }
        return {ok:true,session:currentSession};
      }catch(err){
        const message=String(err?.message||'');
        return {ok:false,reason:/fetch|network|timeout|abort/i.test(message)?'network_unavailable':'resume_failed'};
      }
    })().finally(()=>{ownerRestorePending=null;});
    return ownerRestorePending;
  }

  function parseUnusedOwnerMagicLink(raw){
    let url;
    try{url=new URL(String(raw||'').trim())}catch(_){throw new Error('invalid_magic_link')}
    if(url.protocol!=='https:'||url.origin!==new URL(cfg.supabaseUrl).origin||
        url.pathname!=='/auth/v1/verify')throw new Error('invalid_magic_link');
    const token=url.searchParams.get('token')||url.searchParams.get('token_hash')||'';
    const type=url.searchParams.get('type')||'';
    if(type!=='magiclink'||!(/^[a-zA-Z0-9_\-]{20,512}$/.test(token)))throw new Error('invalid_magic_link');
    return token;
  }
  async function verifyPastedMagicLink(raw){
    const token=parseUnusedOwnerMagicLink(raw);
    if(!client){
      if(!window.supabase?.createClient)throw new Error('sdk_unavailable');
      client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
      });
      attachAuthListener();
    }
    const result=await withTimeout(client.auth.verifyOtp({token_hash:token,type:'magiclink'}),12000,'verify_link_timeout');
    if(result?.error||!result?.data?.session)throw new Error('link_used_or_expired');
    currentSession=result.data.session;
    manualSignOut=false;clearLocalSignOut();
    if(!cfg.tripSlug){trustedDeviceApproved=true;setState('ready')}
    else{setState('registering_device');await registerTrustedDevice();}
    return {ok:true};
  }
  function bindMagicLinkPaste(){
    const btn=document.getElementById('pasteMagicToggle');
    const form=document.getElementById('pasteMagicForm');
    const status=document.getElementById('pasteMagicStatus');
    const input=document.getElementById('pasteMagicUrl');
    if(!btn||!form||!status||!input)return;
    btn.addEventListener('click',()=>{form.hidden=!form.hidden;if(!form.hidden)input.focus();});
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      const submit=form.querySelector('button[type="submit"]');
      if(submit)submit.disabled=true;
      status.textContent='正在此 App 驗證登入連結…';
      try{
        await verifyPastedMagicLink(input.value);
        input.value='';status.textContent='登入成功，正在載入旅程…';
      }catch(err){
        const m=String(err?.message||'');
        status.textContent=m==='invalid_magic_link'?'連結格式不正確，請複製郵件內「Sign in」的網址，不要複製信件內容。':
          m==='link_used_or_expired'?'此連結已使用或過期。請申請新的救援信，先複製連結、不要點開。':
          '無法驗證連結，請確認網路連線並稍後再試。';
      }finally{if(submit)submit.disabled=false;}
    });
  }

  // Pairing codes are Owner issued. No verification email is sent.
  async function signInWithDeviceCode(email,code){
    if(!client)throw new Error('auth_not_initialized');
    const normalized=String(email||'').trim().toLowerCase();
    const normalizedCode=String(code||'').toUpperCase().replace(/[\s-]/g,'');
    if(!/^[A-HJ-NP-Z2-9]{8}$/.test(normalizedCode))throw new Error('invalid_code_format');
    pairingInProgress=true;
    setState('redeeming_code');
    try{
      const device=await window.TravelStore.getDevice();
      const {data,error}=await client.functions.invoke('travel-device-code',{
        body:{
          action:'redeem',tripSlug:cfg.tripSlug,email:normalized,code:normalizedCode,
          devicePublicId:device.device_public_id,deviceSecret:device.device_secret,deviceName:device.label
        }
      });
      if(error){
        let code='device_login_failed';
        try{code=(await error.context?.clone().json())?.error||code}catch(_){}
        throw new Error(code);
      }
      if(!data?.ok||!data.tokenHash)throw new Error(data?.error||'device_login_failed');
      const verified=await client.auth.verifyOtp({token_hash:data.tokenHash,type:'magiclink'});
      if(verified.error||!verified.data?.session)throw new Error(verified.error?.message||'session_verification_failed');
      currentSession=verified.data.session;
      manualSignOut=false;
      clearLocalSignOut();
      trustedDeviceApproved=false;
      if(!cfg.tripSlug){
        const resolved=String(data.tripSlug||'').toLowerCase();
        if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(resolved))throw new Error('trip_resolution_failed');
        const query=new URLSearchParams(location.search);
        const share=query.get('share_target')==='1'?'&'+query.toString():'';
        location.replace(cfg.appBasePath+'?trip='+encodeURIComponent(resolved)+share);
        return {ok:true,tripSlug:resolved};
      }
      pairingInProgress=false;
      setState('registering_device');
      return {ok:true};
    }catch(err){
      pairingInProgress=false;
      setState('signed_out');
      throw err;
    }
  }

  async function registerTrustedDevice({silent=false}={}){
    if(!cfg.tripSlug) return {ok:true,role:null,trip:null,deviceId:null};
    try{
      const device=await window.TravelStore.getDevice();
      const {data,error}=await client.functions.invoke('travel-bootstrap',{
        body:{
          tripSlug:cfg.tripSlug,
          devicePublicId:device.device_public_id,
          deviceSecret:device.device_secret,
          deviceName:device.label
        }
      });
      if(error) throw error;
      if(!data?.ok) throw new Error(data?.error||'Device registration failed');
      await window.TravelStore.setCloudState('trusted_device');
      clearLocalSignOut();
      trustedDeviceApproved=true;
      setState('ready');
      window.dispatchEvent(new CustomEvent('travel-auth-ready',{detail:data}));
      return data;
    }catch(err){
      console.error('Trusted device bootstrap failed',err);
      if(state==='offline_ready'&&!navigator.onLine) return {ok:false,offline:true};
      trustedDeviceApproved=false;
      if(!silent) setState('device_error');
      throw err;
    }
  }

  async function signOut(){
    manualSignOut=true;
    rememberSignOut();
    if(client) await client.auth.signOut({scope:'local'});
    currentSession=null;
    trustedDeviceApproved=false;
    setState('signed_out');
  }

  async function resumeSessionCheck({keepReady=false}={}){
    // Offline is a local-only mode: never block the UI on session refresh.
    /* A user-requested session check must attempt cloud auth even if navigator.onLine is stale. */
    if(manualSignOut||locallySignedOut()){
      trustedDeviceApproved=false;setState('signed_out');return snapshot();
    }
    if(!client && window.supabase?.createClient){
      client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
      });
      attachAuthListener();
    }
    if(!client) return snapshot();
    const wasReady=state==='ready';
    let session=null;
    try{
      const {data,error}=await withTimeout(client.auth.getSession(),9000,'cloud_resume_session_timeout');
      if(error) throw error;
      session=data.session||null;
      if(!session){
        const refreshed=await withTimeout(client.auth.refreshSession(),9000,'cloud_resume_refresh_timeout');
        session=refreshed?.data?.session||null;
      }
    }catch(err){
      console.warn('Background auth refresh failed',err);
      if((keepReady||wasReady) && !manualSignOut) return snapshot();
      throw err;
    }
    if(!session&&!locallySignedOut()){
      const restored=await resumeApprovedOwnerDevice({force:true});
      if(restored.ok)session=restored.session;
    }
    currentSession=session;
    if(currentSession){
      manualSignOut=false;
      if(!cfg.tripSlug){
        trustedDeviceApproved=true;
        setState('ready');
      }else if(trustedDeviceApproved){
        setState('ready');
        registerTrustedDevice({silent:true}).catch(()=>{});
      }else{
        setState('registering_device');
        registerTrustedDevice().catch(()=>{});
      }
    }else if(manualSignOut){
      trustedDeviceApproved=false;
      setState('signed_out');
    }else{
      trustedDeviceApproved=false;
      setState('reauth_required');
    }
    return snapshot();
  }


  function tripSlugFromInvite(input){
    const text=String(input||'').trim();
    if(!text)return null;
    if(/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(text))return text.toLowerCase();
    const matched=text.match(/https?:\/\/[^\s<>\"']+/i);
    if(!matched)return null;
    const extracted=matched[0].split(/\\n|\\r|\\t/i)[0];
    try{
      const parsed=new URL(extracted);
      if(parsed.origin!==location.origin||!parsed.pathname.startsWith(cfg.appBasePath))return null;
      const slugValue=parsed.searchParams.get('trip')||parsed.pathname.slice(cfg.appBasePath.length).split('/')[0]||'';
      return (String(slugValue).toLowerCase().match(/^([a-z0-9]+(?:-[a-z0-9]+)*)/)||[])[1]||null;
    }catch{return null}
  }
  function bindTripLinkForm(){
    const form=document.getElementById('tripLinkForm');
    if(!form||form.dataset.bound==='1')return;
    form.dataset.bound='1';
    form.addEventListener('submit',event=>{
      event.preventDefault();
      const raw=document.getElementById('tripInviteText')?.value||'';
      const slug=tripSlugFromInvite(raw);
      const err=document.getElementById('tripLinkError');
      if(!slug){if(err)err.textContent='請貼上有效的 Travel OS 旅程網址或完整登入資訊。';return}
      const email=raw.match(/(?:Email|信箱|電子郵件)\s*[：:]\s*([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i);
      if(email){try{sessionStorage.setItem('travel-os-invite-email',email[1].toLowerCase())}catch(_){}}
      location.assign(cfg.appBasePath+'?trip='+encodeURIComponent(slug));
    });
  }

  function bindOwnerRecovery(){
    const button=document.getElementById('ownerRecoveryToggle');
    const form=document.getElementById('ownerRecoveryForm');
    const status=document.getElementById('ownerRecoveryStatus');
    const emailInput=document.getElementById('ownerRecoveryEmail');
    if(!button||!form||!status||!emailInput)return;
    button.onclick=()=>{form.hidden=!form.hidden; if(!form.hidden){emailInput.value=document.getElementById('authEmail')?.value||cfg.ownerEmail||'';emailInput.focus();}};
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      const submit=form.querySelector('button[type="submit"]');
      if(submit)submit.disabled=true;
      status.textContent='正在處理救援要求…';
      try{
        const response=await fetch(cfg.supabaseUrl+'/functions/v1/travel-owner-recovery',{
          method:'POST',headers:{'content-type':'application/json','apikey':cfg.supabasePublishableKey},
          body:JSON.stringify({email:emailInput.value,tripSlug:cfg.tripSlug||''})
        });
        if(!response.ok)throw new Error('recovery_unavailable');
        status.textContent='已受理。收到信後，請長按「Sign in」複製連結，再使用下方「在此 App 貼上 Magic Link」驗證；直接點信可能開在不同瀏覽器。';
      }catch(err){status.textContent='救援服務暫時無法連線，請稍後重試。';}
      finally{if(submit)submit.disabled=false;}
    });
  }

  function bindLoginForm(){
    const form=document.getElementById('magicLinkForm');
    if(!form||form.dataset.authBound==='1') return;
    form.dataset.authBound='1';
    const emailInput=document.getElementById('authEmail');
    if(emailInput){try{
      const pending=sessionStorage.getItem('travel-os-invite-email');
      if(pending&&!emailInput.value)emailInput.value=pending;
      sessionStorage.removeItem('travel-os-invite-email');
    }catch(_){}}
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      const email=document.getElementById('authEmail')?.value||'';
      const code=document.getElementById('authPairCode')?.value||'';
      const msg=document.getElementById('authMessage');
      const button=document.getElementById('magicLinkBtn');
      try{
        if(button)button.disabled=true;
        if(!client)await init();
        await signInWithDeviceCode(email,code);
      }catch(err){
        console.error('Device pairing login failed',err);
        const key=String(err?.message||'');
        if(msg)msg.textContent=
          key==='too_many_attempts'?'輸入錯誤次數過多，請 15 分鐘後再試。':
          key==='invalid_code'?'登入碼已使用、過期或輸入錯誤，請向 Owner 索取新碼。':
          key==='invalid_code_format'?'請輸入 8 位英數登入碼（可省略中間的連字號）。':
          key==='trip_resolution_failed'?'登入碼已驗證，無法辨識所屬旅程，請洽 Owner。':
          key==='device_revoked_or_mismatch'?'這台裝置已撤銷或識別不符，請聯絡 Owner。':
          '裝置登入失敗：'+(key||'網路或伺服器暫時異常');
      }finally{
        if(button)button.disabled=false;
      }
    });
  }


  // Switching Trip is not a sign-out. If a browser already holds a valid
  // Supabase session, recover it before navigating to a different Trip.
  // This never bypasses Supabase authentication or revives revoked devices.
  let tripSwitchRestore=null;
  async function tryRestoreCloudSession(){
    if(tripSwitchRestore)return tripSwitchRestore;
    tripSwitchRestore=(async()=>{
      /* Explicit restore tests real Supabase connectivity; the browser online flag is advisory. */
      if(manualSignOut||locallySignedOut())return {ok:false,reason:'explicit_signout'};
      if(!window.supabase?.createClient)return {ok:false,reason:'sdk_unavailable'};
      try{
        if(!client){
          client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
            auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
          });
          attachAuthListener();
        }
        const found=await withTimeout(client.auth.getSession(),9000,'switch_session_timeout');
        if(found?.error)throw found.error;
        let session=found?.data?.session||null;
        const expiry=Number(session?.expires_at||0);
        if(!session||(expiry>0&&expiry*1000<=Date.now()+30000)){
          const refreshed=await withTimeout(client.auth.refreshSession(),9000,'switch_refresh_timeout');
          if(refreshed?.error)throw refreshed.error;
          session=refreshed?.data?.session||null;
        }
        if(!session){
          const restored=await resumeApprovedOwnerDevice({force:true});
          if(restored.ok)return {ok:true,source:'trusted_owner_device'};
          return {ok:false,reason:restored.reason==='device_not_approved'?'device_not_approved':'session_missing'};
        }
        // getUser reaches Supabase Auth. A locally cached JWT alone is not a
        // successful cloud login, and must not be shown as Cloud synced.
        const checked=await withTimeout(client.auth.getUser(),9000,'switch_user_verify_timeout');
        if(checked?.error||!checked?.data?.user||checked.data.user.id!==session.user?.id){
          const resumed=await resumeApprovedOwnerDevice({force:true});
          return resumed.ok?{ok:true,source:'trusted_owner_device'}:{ok:false,reason:'session_missing'};
        }
        currentSession=session;
        if(!cfg.tripSlug){
          trustedDeviceApproved=true;
          setState('ready');
        }else{
          setState('registering_device');
          await registerTrustedDevice({silent:false});
        }
        return {ok:true};
      }catch(error){
        const message=String(error?.message||error||'');
        console.warn('Existing cloud session could not be resumed before switching Trips',message);
        const restored=await resumeApprovedOwnerDevice({force:true});
        if(restored.ok)return {ok:true,source:'trusted_owner_device'};
        const isMissing=/auth.session.missing|refresh.token.not.found|invalid.refresh.token|session.missing/i.test(message);
        const isNetwork=/timeout|failed to fetch|network|offline|load failed/i.test(message);
        return {ok:false,reason:isMissing?'session_missing':isNetwork?'network_unavailable':'session_temporarily_unavailable'};
      }
    })().finally(()=>{tripSwitchRestore=null});
    return tripSwitchRestore;
  }

  async function requestAccountLogin(){
    if(manualSignOut||locallySignedOut())return false;
    if(currentSession)return true;
    setState('loading');
    const resumed=await resumeApprovedOwnerDevice({force:true});
    if(resumed.ok)return true;
    // Device was new, revoked, or could not be validated. Show the normal
    // one-time login and the same-app Magic Link paste fallback.
    trustedDeviceApproved=false;
    setState('reauth_required');
    return false;
  }

  window.TravelAuth={
    init,signInWithDeviceCode,signOut,resumeSessionCheck,tryRestoreCloudSession,requestAccountLogin,getClient:()=>client,
    onChange(fn){listeners.add(fn);return()=>listeners.delete(fn)},snapshot
  };

  ['pointerdown','keydown','touchstart','scroll'].forEach(type=>{
    window.addEventListener(type,()=>{if(state==='ready'||state==='offline_ready')markActive()},{passive:true});
  });
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='hidden'){
      if(state==='ready'||state==='offline_ready') markActive();
      return;
    }
    if(state==='ready'||state==='offline_ready') markActive();
    if(currentSession)resumeSessionCheck({keepReady:state==='ready'}).catch(()=>{});
  });
  window.addEventListener('pageshow',()=>{ if(state!=='loading'&&currentSession) resumeSessionCheck({keepReady:state==='ready'}).catch(()=>{}); });
  window.addEventListener('focus',()=>{ if(state==='ready') resumeSessionCheck({keepReady:true}).catch(()=>{}); });

  const boot=()=>{
    bindTripLinkForm();
    bindLoginForm();
    bindOwnerRecovery();
    bindMagicLinkPaste();
    init().catch(err=>console.error('Auth boot failed',err));
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
