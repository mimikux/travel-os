(() => {
  const basePath='/travel-os/';
  const params=new URLSearchParams(location.search);
  const querySlug=(params.get('trip')||'').trim();
  const rel=location.pathname.startsWith(basePath)?location.pathname.slice(basePath.length):'';
  const pathSlug=rel.split('/').filter(Boolean)[0]||'';
  const tripSlug=(querySlug||pathSlug||'').toLowerCase()||null;
  const tripLabel=tripSlug?tripSlug.split('-').map((part,i)=>{
    if(/^\d{4}$/.test(part)) return part;
    return part.charAt(0).toUpperCase()+part.slice(1);
  }).join(' '):'Travel OS';

  if(querySlug && history.replaceState){
    history.replaceState(null,'',basePath+encodeURIComponent(querySlug));
  }

  window.TRAVEL_CONFIG = Object.freeze({
    supabaseUrl: 'https://nmrgfpbccvhqenuvcjkj.supabase.co',
    supabasePublishableKey: 'sb_publishable_aaoW2khh4iGwbxXRPuuCeQ_GrdkskNp',
    tripSlug,
    tripLabel,
    appBasePath: basePath,
    ownerEmail: 'anching.ho@gmail.com',
    release: '1.1.0'
  });
})();