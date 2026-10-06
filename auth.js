(() => {
  const cfg=window.TRAVEL_CONFIG;
  let client=null;
  let currentSession=null;
  let state='loading';
  let manualSignOut=false;
  const LAST_ACTIVE_KEY='travel-os-last-active';
  const listeners=new Set();
  let magicLinkPromise=null;

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
      const ready=next==='ready'||next==='offline_ready';
      gate.hidden=ready;
      gate.style.display=ready?'none':'';
      gate.setAttribute('aria-hidden',String(ready));
    }
    if(next==='ready') markActive();
    if(form){
      const showForm=['signed_out','reauth_required','link_sent','unauthorized_email','device_error','sdk_error'].includes(next);
      form.hidden=!showForm;
    }
    if(msg){
      if(next==='loading') msg.textContent='正在確認這台裝置的登入狀態…';
      else if(next==='registering_device') msg.textContent='已找到登入狀態，正在驗證 Trusted Device…';
      else if(next==='signed_out') msg.textContent='這台裝置尚未驗證，請用已授權 Email 取得登入連結。';
      else if(next==='reauth_required') msg.textContent='本機行程仍保留，但雲端登入已失效。請重新取得一次 Magic Link 以恢復同步。';
      else if(next==='link_sent') msg.textContent='登入連結已寄出，請到信箱點一下 Magic Link。';
      else if(next==='unauthorized_email') msg.textContent='此信箱不在授權清單，請找 Trip Owner 加入再登入。';
      else if(next==='device_error') msg.textContent='帳號已登入，但這台裝置驗證失敗。請保持連線後重新整理。';
      else if(next==='sdk_error') msg.textContent='登入模組載入失敗，請重新整理。';
    }
    if(msg) msg.classList.toggle('auth-error',next==='unauthorized_email');
    if(foot){
      foot.textContent=next==='loading'||next==='registering_device'?'已有權限的裝置會自動進入，不需要重新寄信。':next==='reauth_required'?'這只會更新此裝置的登入憑證，不會覆蓋或修改伺服器行程資料。':'不需要密碼。Magic Link 使用一次後失效。';
    }
    emit();
  }

  let initPromise=null;
  async function init(){
    if(initPromise) return initPromise;
    initPromise=(async()=>{
    if(!window.supabase?.createClient){ setState('sdk_error'); return snapshot(); }
    try{
      const device=await window.TravelStore.getDevice();
      const cloudState=await window.TravelStore.getCloudState?.();
      if(device?.device_public_id && (cloudState==="trusted_device" || cloudState?.state==="trusted_device")){
        setState('offline_ready');
      }
    }catch(_){ }
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
        setState('ready');
      }else if(navigator.onLine){
        setState('registering_device');
        try{await registerTrustedDevice()}catch(_){ }
      }else{
        setState('ready');
      }
    }else if(state==='offline_ready'){
      setState('reauth_required');
    }else if(state!=='ready') setState('signed_out');
    client.auth.onAuthStateChange((event,session)=>{
      currentSession=session||null;
      if(currentSession){
        manualSignOut=false;
        if(!cfg.tripSlug){
          setState('ready');
        }else{
          const silent=state==='ready';
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

  async function sendMagicLink(email){
    if(!client) throw new Error('Auth not initialized');
    if(magicLinkPromise) return magicLinkPromise;
    magicLinkPromise=(async()=>{
      setState('sending_link');
      const redirectTo=location.origin+location.pathname;
      const normalized=String(email||'').trim().toLowerCase();
      const {data:gate,error:gateError}=await client.functions.invoke('request-travel-login',{
        body:{email:normalized,tripSlug:cfg.tripSlug||'',redirectTo}
      });
      if(gateError){setState('signed_out');throw gateError;}
      if(gate?.existing){
        const {error}=await client.auth.signInWithOtp({
          email:normalized,
          options:{emailRedirectTo:redirectTo,shouldCreateUser:false}
        });
        if(error){setState('signed_out');throw error;}
        setState('link_sent');
        return {ok:true,mode:'existing'};
      }
      if(gate?.invited){
        setState('link_sent');
        return {ok:true,mode:'invite'};
      }
      setState('unauthorized_email');
      return {ok:false,mode:'unauthorized'};
    })().finally(()=>{magicLinkPromise=null;});
    return magicLinkPromise;
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
      setState('ready');
      window.dispatchEvent(new CustomEvent('travel-auth-ready',{detail:data}));
      return data;
    }catch(err){
      console.error('Trusted device bootstrap failed',err);
      if(!silent) setState('device_error');
      throw err;
    }
  }

  async function signOut(){
    manualSignOut=true;
    if(client) await client.auth.signOut({scope:'local'});
    currentSession=null;
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
      setState('ready');
      if(cfg.tripSlug) registerTrustedDevice({silent:true}).catch(()=>{});
    }else if(manualSignOut){
      setState('signed_out');
    }else{
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
      const msg=document.getElementById('authMessage');
      try{
        if(!client) await init();
        await sendMagicLink(email);
      }catch(err){
        console.error('Magic Link failed',err);
        const status=Number(err?.status||err?.context?.status||0);
        const code=String(err?.code||err?.context?.code||'');
        if(msg){
          msg.textContent=(status===429||code.includes('rate_limit'))
            ?'登入信寄送太頻繁，請稍後再試。若剛剛已收到登入信，可直接使用最新一封。'
            :'登入連結寄送失敗，請稍後再試。';
        }
      }
    });
  }

  window.TravelAuth={
    init,sendMagicLink,signOut,resumeSessionCheck,getClient:()=>client,
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
    resumeSessionCheck({keepReady:state==='ready'}).catch(()=>{});
  });
  window.addEventListener('pageshow',()=>{ if(state!=='loading') resumeSessionCheck({keepReady:state==='ready'}).catch(()=>{}); });
  window.addEventListener('focus',()=>{ if(state==='ready') resumeSessionCheck({keepReady:true}).catch(()=>{}); });

  const boot=()=>{
    bindLoginForm();
    init().catch(err=>console.error('Auth boot failed',err));
  };
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
