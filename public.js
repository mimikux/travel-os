let PUBLIC_TRIP=null;
let selectedDay=0;
let map=null;
let routeLayer=null;
let markers=[];

const qs=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const typeLabel={spot:'景點',drive:'移動',stay:'住宿',food:'餐食',tour:'TOUR',flight:'航班',car:'租車',shop:'補給',plan:'備案',other:'其他'};
const driveText=mins=>{mins=Number(mins)||0;const h=Math.floor(mins/60),m=mins%60;return h?`${h}h ${String(m).padStart(2,'0')}m`:`${m}m`};

function reservationMap(){
  return new Map((PUBLIC_TRIP?.reservations||[]).map(r=>[String(r.id),r]));
}

function renderDays(){
  const host=qs('#dayStrip');
  host.innerHTML=(PUBLIC_TRIP.days||[]).map((d,i)=>`<button class="day-btn ${i===selectedDay?'active':''}" data-day="${i}"><strong>${esc(d.label)}</strong></button>`).join('');
  host.querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{selectedDay=Number(b.dataset.day);renderAll()});
}

function renderHero(){
  const d=PUBLIC_TRIP.days[selectedDay];
  qs('#heroDay').textContent=d.label;
  qs('#heroTitle').textContent=d.name;
  qs('#heroKm').textContent=(Number(d.km)||0).toFixed(1)+' km';
  qs('#heroDrive').textContent=driveText(d.driveMinutes);
  qs('#heroSunrise').textContent=d.sunrise||'—';
  qs('#heroSunset').textContent=d.sunset||'—';
  qs('#hero').style.backgroundImage=d.heroImageUrl?`url("${String(d.heroImageUrl).replace(/"/g,'%22')}")`:'';
}

function renderTimeline(){
  const d=PUBLIC_TRIP.days[selectedDay],resById=reservationMap();
  const events=d.events||[];
  qs('#timeline').innerHTML=events.length?events.map(e=>{
    const r=e.reservationId?resById.get(String(e.reservationId)):null;
    const plan=r?`<div class="reservation-public">
      ${r.price?`<div class="price">參考價格 · ${esc(r.price)}</div>`:''}
      ${(r.rows||[]).length?`<div class="safe-rows">${r.rows.map(x=>`<div class="safe-row"><span>${esc(x[0])}</span><strong>${esc(x[1])}</strong></div>`).join('')}</div>`:''}
      ${(r.amenities||[]).length?`<div class="amenities">${r.amenities.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}
    </div>`:'';
    return `<article class="timeline-card ${e.uncertain?'uncertain':''}">
      <div class="timeline-top"><div><div class="type">${esc(typeLabel[e.type]||e.type)}${e.uncertain?' · 不確定':''}</div><h3>${esc(e.title)}</h3></div><div class="time">${esc(e.time||'')}</div></div>
      ${e.subtitle?`<div class="sub">${esc(e.subtitle)}</div>`:''}
      ${e.note?`<div class="note">${esc(e.note)}</div>`:''}
      ${e.intro?`<div class="intro">${esc(e.intro)}</div>`:''}
      ${plan}
    </article>`;
  }).join(''):'<article class="timeline-card"><h3>這一天尚無公開行程</h3></article>';
}

function routeCoord(e){
  const rawLat=(e?.routeLat!==null&&e?.routeLat!==undefined&&String(e.routeLat).trim()!=='')?e.routeLat:e?.lat;
  const rawLng=(e?.routeLng!==null&&e?.routeLng!==undefined&&String(e.routeLng).trim()!=='')?e.routeLng:e?.lng;
  if(rawLat===null||rawLat===undefined||rawLng===null||rawLng===undefined)return null;
  if(String(rawLat).trim()===''||String(rawLng).trim()==='')return null;
  const lat=Number(rawLat),lng=Number(rawLng);
  if(!Number.isFinite(lat)||!Number.isFinite(lng))return null;
  if(Math.abs(lat)>90||Math.abs(lng)>180)return null;
  if(Math.abs(lat)<1e-9&&Math.abs(lng)<1e-9)return null;
  return {lat,lng};
}

function publicStops(){
  const day=PUBLIC_TRIP.days[selectedDay];
  if(!day)return [];
  const stops=(day.events||[])
    .filter(e=>!e.uncertain&&routeCoord(e))
    .map(e=>({...e,...routeCoord(e)}));

  // Keep route continuity without exposing the exact accommodation position:
  // previous night's masked stay becomes today's route origin.
  if(selectedDay>0){
    const prev=PUBLIC_TRIP.days[selectedDay-1];
    const overnight=[...(prev?.events||[])].reverse().find(e=>e.type==='stay'&&!e.uncertain&&routeCoord(e));
    if(overnight){
      const p={...overnight,...routeCoord(overnight),_carryover:true};
      const first=stops[0];
      if(!first||Math.abs(first.lat-p.lat)>1e-6||Math.abs(first.lng-p.lng)>1e-6) stops.unshift(p);
    }
  }

  const out=[];
  for(const e of stops){
    const last=out[out.length-1];
    if(!last||Math.abs(last.lat-e.lat)>1e-6||Math.abs(last.lng-e.lng)>1e-6) out.push(e);
  }
  return out;
}

async function renderMap(){
  const stops=publicStops();
  if(!map){
    map=L.map('publicMap',{zoomControl:true});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:18,attribution:'© OpenStreetMap'}).addTo(map);
  }
  markers.forEach(m=>m.remove());markers=[];
  if(routeLayer){routeLayer.remove();routeLayer=null}
  if(!stops.length){map.setView([64.9,-18.5],5);return}

  stops.forEach((s,i)=>{
    const icon=L.divIcon({className:'',html:`<div class="public-marker"><span>${i+1}</span></div>`,iconSize:[30,30],iconAnchor:[15,28]});
    markers.push(L.marker([s.lat,s.lng],{icon}).addTo(map).bindPopup(esc(s.locationMasked?'住宿區域（位置已模糊）':s.title)));
  });

  const bounds=L.latLngBounds(stops.map(s=>[s.lat,s.lng]));
  map.fitBounds(bounds.pad(.18));

  if(stops.length>=2){
    try{
      const coords=stops.map(s=>`${s.lng},${s.lat}`).join(';');
      const r=await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`);
      const data=await r.json();
      const geometry=data?.routes?.[0]?.geometry;
      if(geometry) routeLayer=L.geoJSON(geometry,{style:{color:'#315e55',weight:5,opacity:.75}}).addTo(map);
    }catch(_){}
  }
}

function renderAll(){
  renderDays();renderHero();renderTimeline();
  setTimeout(()=>{map?.invalidateSize();renderMap()},0);
}

async function load(){
  const token=new URLSearchParams(location.search).get('share')||'';
  if(!token){showError('缺少分享代碼。');return}
  try{
    const client=supabase.createClient(window.TRAVEL_CONFIG.supabaseUrl,window.TRAVEL_CONFIG.supabasePublishableKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await client.functions.invoke('travel-public-data',{body:{shareToken:token}});
    if(error)throw error;
    if(data?.error)throw new Error(data.error);
    PUBLIC_TRIP=data;
    qs('#tripTitle').textContent=data.trip?.title||'旅程分享';
    document.title=(data.trip?.title||'Travel OS')+' · Public';
    qs('#loadingCard').hidden=true;
    qs('#publicApp').hidden=false;
    renderAll();
  }catch(err){showError(err.message||'分享連結無法使用。')}
}

function showError(msg){
  qs('#loadingCard').hidden=true;
  qs('#errorCard').hidden=false;
  qs('#errorText').textContent=msg==='share_not_found'?'這個分享連結可能已停止分享或已被重設。':msg;
}
load();