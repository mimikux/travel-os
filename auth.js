(() => {
  const cfg=window.TRAVEL_CONFIG;
  let client=null;
  let currentSession=null;
  let state='loading';
  let manualSignOut=false;
  let trustedDeviceApproved=false;
  const LAST_ACTIVE_KEY='travel-os-last-active';
  const listeners=new Set();

  function readLastActive(){
    try{return Number(localStorage.getItem(LAST_ACTIVE_KEY)||0)}catch(_){return 0}
  }
  function markActive(){
    try{localStorage.setItem(LAST_ACTIVE_KEY,String(Date.now()))}catch(_){}
  }
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
      form.hidden=!showForm||!cfg.tripSlug;
    }
    if(msg){
      if(next==='loading') msg.textContent='正在確認這台裝置的登入狀態…';
      else if(next==='registering_device') msg.textContent='已找到登入狀態，正在驗證 Trusted Device…';
      else if(next==='signed_out') msg.textContent=cfg.tripSlug?'請輸入 Owner 核發的裝置登入碼。':'請使用 Owner 提供的旅程專屬連結進入，再輸入登入碼。';
      else if(next==='reauth_required') msg.textContent='雲端登入已失效，請向 Owner 索取新的裝置登入碼。';
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
  }

  let initPromise=null;
  async function init(){
    if(initPromise) return initPromise;
    initPromise=(async()=>{
    let localOfflineAccess=false;
    try{
      const device=await window.TravelStore.getDevice();
      if(cfg.tripSlug){
        const cloudState=await window.TravelStore.getCloudState?.();
        const cachedTrip=await window.TravelStore.getTrip?.();
        localOfflineAccess=Boolean(
          device?.device_public_id &&
          (cloudState==="trusted_device" || cloudState?.state==="trusted_device") &&
          cachedTrip?.days?.length
        );
      }else{
        const cachedTrips=await window.TravelStore.listTrips?.();
        localOfflineAccess=Boolean(cachedTrips?.length);
      }
      if(localOfflineAccess&&!navigator.onLine)setState('offline_ready');
    }catch(_){ }
    if(!window.supabase?.createClient){
      if(localOfflineAccess){setState('offline_ready');return snapshot();}
      setState('sdk_error'); return snapshot();
    }
    client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    let sessionResult;
    try{
      sessionResult=await withTimeout(client.auth.getSession(),8000,'auth_session_timeout');
    }catch(err){
      console.warn('Initial auth session check timed out',err);
      if(state==='offline_ready'){
        setTimeout(()=>resumeSessionCheck({keepReady:true}).catch(()=>{}),2500);
        return snapshot();
      }
      setState('signed_out');
      return snapshot();
    }
    let {data}=sessionResult;
    currentSession=data.session||null;
    if(!currentSession){
      try{
        const refreshed=await withTimeout(client.auth.refreshSession(),8000,'auth_refresh_timeout');
        currentSession=refreshed?.data?.session||null;
      }catch(err){
        console.warn('Persisted auth refresh unavailable',err);
      }
    }
    if(currentSession){
      if(!cfg.tripSlug){
        trustedDeviceApproved=true;
        setState('ready');
      }else if(navigator.onLine){
        setState('registering_device');
        try{await registerTrustedDevice()}catch(_){ }
      }else{
        trustedDeviceApproved=localOfflineAccess;
        setState(localOfflineAccess?'offline_ready':'reauth_required');
      }
    }else if(state==='offline_ready'&&!navigator.onLine){
      setState('offline_ready');
    }else if(state==='offline_ready'){
      setState('reauth_required');
    }else if(state!=='ready') setState('signed_out');
    client.auth.onAuthStateChange((event,session)=>{
      currentSession=session||null;
      if(currentSession){
        manualSignOut=false;
        if(!cfg.tripSlug){
          trustedDeviceApproved=true;
          setState('ready');
        }else{
          const silent=state==='ready'&&trustedDeviceApproved;
          if(!silent) setState('registering_device');
          // Supabase documents that awaiting another Supabase API call inside
          // onAuthStateChange can deadlock. Defer the bootstrap outside the callback.
          setTimeout(()=>{
            registerTrustedDevice({silent}).catch(()=>{});
          },0);
        }
      }else if(manualSignOut){
        setState('signed_out');
      }else if(event==='SIGNED_OUT'){
        // Token rotation/background resume can briefly emit SIGNED_OUT on some mobile
        // PWA/browser paths. Keep trusted content visible and reconcile silently.
        setTimeout(()=>{resumeSessionCheck({keepReady:true}).catch(()=>{})},0);
      }
    });
    return snapshot();
    })().catch(err=>{
      console.error('Auth init failed',err);
      setState('signed_out');
      return snapshot();
    });
    return initPromise;
  }


  // Pairing codes are Owner issued. No verification email is sent.
  async function signInWithDeviceCode(email,code){
    if(!client)throw new Error('auth_not_initialized');
    if(!cfg.tripSlug)throw new Error('open_trip_link');
    const normalized=String(email||'').trim().toLowerCase();
    const normalizedCode=String(code||'').toUpperCase().replace(/[\s-]/g,'');
    if(!/^[A-HJ-NP-Z2-9]{8}$/.test(normalizedCode))throw new Error('invalid_code_format');
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
      trustedDeviceApproved=false;
      // The existing SIGNED_IN observer handles Trusted Device enrollment.
      setState('registering_device');
      return {ok:true};
    }catch(err){
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
      trustedDeviceApproved=true;
      setState('ready');
      window.dispatchEvent(new CustomEvent('travel-auth-ready',{detail:data}));
      return data;
    }catch(err){
      console.error('Trusted device bootstrap failed',err);
      trustedDeviceApproved=false;
      if(!silent) setState('device_error');
      throw err;
    }
  }

  async function signOut(){
    manualSignOut=true;
    if(client) await client.auth.signOut({scope:'local'});
    currentSession=null;
    trustedDeviceApproved=false;
    setState('signed_out');
  }

  async function resumeSessionCheck({keepReady=false}={}){
    if(!client) return snapshot();
    const wasReady=state==='ready';
    let session=null;
    try{
      const {data,error}=await client.auth.getSession();
      if(error) throw error;
      session=data.session||null;
      if(!session){
        const refreshed=await client.auth.refreshSession();
        session=refreshed?.data?.session||null;
      }
    }catch(err){
      console.warn('Background auth refresh failed',err);
      if((keepReady||wasReady) && !manualSignOut) return snapshot();
      throw err;
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

  function bindLoginForm(){
    const form=document.getElementById('magicLinkForm');
    if(!form||form.dataset.authBound==='1') return;
    form.dataset.authBound='1';
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
          key==='open_trip_link'?'請用 Owner 分享的旅程網址進入登入頁。':
          key==='device_revoked_or_mismatch'?'這台裝置已撤銷或識別不符，請聯絡 Owner。':
          '裝置登入失敗：'+(key||'網路或伺服器暫時異常');
      }finally{
        if(button)button.disabled=false;
      }
    });
  }

  window.TravelAuth={
    init,signInWithDeviceCode,signOut,resumeSessionCheck,getClient:()=>client,
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
    bindLoginForm();
    init().catch(err=>console.error('Auth boot failed',err));
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
