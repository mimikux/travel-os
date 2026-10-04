(() => {
  const cfg=window.TRAVEL_CONFIG;
  let client=null;
  let currentSession=null;
  let state='loading';
  const listeners=new Set();

  function emit(){ for(const fn of listeners){ try{fn(snapshot())}catch(_){ } } }
  function snapshot(){ return {state,session:currentSession,user:currentSession?.user||null}; }
  function setState(next){ state=next; emit(); document.documentElement.dataset.authState=next; }

  async function init(){
    if(!window.supabase?.createClient){ setState('sdk_error'); return snapshot(); }
    client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabasePublishableKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    const {data}=await client.auth.getSession();
    currentSession=data.session||null;
    if(currentSession){
      setState('registering_device');
      await registerTrustedDevice();
    }else setState('signed_out');
    client.auth.onAuthStateChange(async (_event,session)=>{
      currentSession=session||null;
      if(currentSession){ setState('registering_device'); await registerTrustedDevice(); }
      else setState('signed_out');
    });
    return snapshot();
  }

  async function sendMagicLink(email){
    if(!client) throw new Error('Auth not initialized');
    setState('sending_link');
    const redirectTo=location.origin+location.pathname;
    const {error}=await client.auth.signInWithOtp({
      email,
      options:{emailRedirectTo:redirectTo,shouldCreateUser:true}
    });
    if(error){setState('signed_out');throw error;}
    setState('link_sent');
  }

  async function registerTrustedDevice(){
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
      setState('device_error');
      throw err;
    }
  }

  async function signOut(){
    if(client) await client.auth.signOut();
    currentSession=null;
    setState('signed_out');
  }

  window.TravelAuth={
    init,sendMagicLink,signOut,getClient:()=>client,
    onChange(fn){listeners.add(fn);return()=>listeners.delete(fn)},snapshot
  };
})();
