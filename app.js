let selectedDay=0,activeView="today",map=null,mapLayer=null,routeLine=null,mapMarkers=[],demoMode=localStorage.getItem("travelDemo")==="1";
let mapMultiSelectMode=false,mapSelectedDays=new Set([0]),routeLayers=[],routeRenderToken=0;
const routeCache=new Map();
const $=id=>document.getElementById(id);
const fmtDate=s=>s.slice(5).replace("-","/");
const dayIndexByToday=()=>{const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Atlantic/Reykjavik",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());return TRIP.days.findIndex(d=>d.date===p)};
const referenceDate=()=>demoMode?"2026-11-23":new Intl.DateTimeFormat("en-CA",{timeZone:"Atlantic/Reykjavik",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
function relLabel(date){const a=new Date(referenceDate()+"T00:00:00Z"),b=new Date(date+"T00:00:00Z"),n=Math.round((b-a)/864e5);if(referenceDate()<TRIP.days[0].date)return"行程";if(n===0)return"今日";if(n===1)return"明日";if(n===2)return"後日";if(n===-1)return"昨日";return fmtDate(date)}
function icon(name){const p={today:'<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',map:'<path d="m3 6 5-2 8 3 5-2v13l-5 2-8-3-5 2z"/><path d="M8 4v13M16 7v13"/>',booking:'<path d="M5 4h14v16H5z"/><path d="M8 8h8M8 12h8M8 16h5"/>',expense:'<circle cx="12" cy="12" r="8"/><path d="M9 10c0-1 1-2 3-2s3 1 3 2-1 2-3 2-3 1-3 2 1 2 3 2 3-1 3-2M12 6v12"/>',more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'}[name]||'';return '<svg viewBox="0 0 24 24">'+p+'</svg>'}

function bookingTypeIcon(type){
  const paths={
    stay:'<path d="M4 20V9l8-6 8 6v11"/><path d="M8 20v-6h8v6"/>',
    car:'<path d="M5 16h14l-1.5-6h-11z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M7 10l2-4h6l2 4"/>',
    flight:'<path d="M3 14l8-3V5l2-2 1 7 6-2 1 2-7 4-1 7-2 1v-6l-5 2z"/>',
    tour:'<path d="M4 6h16v5a2 2 0 0 0 0 4v5H4v-5a2 2 0 0 0 0-4z"/><path d="M12 8v2M12 14v2M12 18v0"/>'
  };
  return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(paths[type]||paths.tour)+'</svg>';
}
function typeLabel(type){
  return ({drive:"移動",spot:"景點",tour:"TOUR",stay:"住宿",flight:"航班",car:"租車",food:"餐飲",shop:"補給"})[type]||String(type||"行程").toUpperCase();
}
function weatherIcon(code){if(code===0)return'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>';if([71,73,75,77,85,86].includes(code))return'<svg viewBox="0 0 24 24"><path d="M6 15a4 4 0 0 1 1-7.8A6 6 0 0 1 18 9a3 3 0 0 1 0 6H6z"/><path d="m8 18 1 2m3-2 1 2m3-2 1 2"/></svg>';if(code>=51)return'<svg viewBox="0 0 24 24"><path d="M6 15a4 4 0 0 1 1-7.8A6 6 0 0 1 18 9a3 3 0 0 1 0 6H6z"/><path d="m9 18-1 2m5-2-1 2m5-2-1 2"/></svg>';return'<svg viewBox="0 0 24 24"><path d="M6 16a4 4 0 0 1 1-7.8A6 6 0 0 1 18 10a3 3 0 0 1 0 6H6z"/></svg>'}
const heroImages=[
"https://commons.wikimedia.org/wiki/Special:FilePath/Blue%20Lagoon%2C%20Iceland%20%2820256742624%29.jpg?width=1600",
"https://commons.wikimedia.org/wiki/Special:FilePath/Gullfoss%20Waterfall%20in%20Winter.jpg?width=1600",
"https://commons.wikimedia.org/wiki/Special:FilePath/Reynisfjara%2C%20Iceland%2C%2020240720%200844%202840.jpg?width=1600",
"https://commons.wikimedia.org/wiki/Special:FilePath/Islanda%20-%20lago%20J%C3%B6kuls%C3%A1rl%C3%B3n.jpg?width=1600",
"https://commons.wikimedia.org/wiki/Special:FilePath/Skaftafell%2C%20Iceland.jpg?width=1600",
"https://commons.wikimedia.org/wiki/Special:FilePath/IcelandicHorsesInWinter.jpg?width=1600",
"https://commons.wikimedia.org/wiki/Special:FilePath/Kirkjufell%20in%20Iceland.jpg?width=1600",
"https://commons.wikimedia.org/wiki/Special:FilePath/Keflav%C3%ADk%20International%20Airport%20seen%20from%20runway.jpg?width=1600"
];
function initIcons(){document.querySelectorAll("[data-icon]").forEach(x=>x.innerHTML=icon(x.dataset.icon))}
function renderDayStrip(){const el=$("dayStrip");el.innerHTML=TRIP.days.map((d,i)=>'<button class="day-btn '+(i===selectedDay?'active':'')+'" data-day="'+i+'"><strong>'+d.label+'</strong><small>'+fmtDate(d.date)+'</small></button>').join("");el.querySelectorAll("button").forEach(b=>b.onclick=()=>{selectedDay=+b.dataset.day;if(!mapMultiSelectMode)mapSelectedDays=new Set([selectedDay]);renderAll()})}
function renderHero(){const d=TRIP.days[selectedDay];$("heroDay").textContent=d.label+" · "+fmtDate(d.date);$("heroRelativeLabel").textContent=relLabel(d.date);$("heroTitle").textContent=d.name;$("todayKm").textContent=d.km+" km";$("todayDrive").textContent=d.drive;$("todaySunrise").textContent="--:--";$("todaySunset").textContent="--:--";$("heroCard").style.backgroundImage='url("'+heroImages[selectedDay%heroImages.length]+'")';$("heroDemoBadge").hidden=!demoMode;$("timelineHeading").textContent=relLabel(d.date)+"行程";refreshWeather(d)}
function renderTimeline(){
  const d=TRIP.days[selectedDay],el=$("timeline");
  el.innerHTML=d.events.map((e,i)=>{
    const nav=e.lat?'<a class="nav-link" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination='+e.lat+','+e.lng+'">導航</a>':'';
    const hasDetails=!!(e.details&&(e.details.intro||(e.details.tips&&e.details.tips.length)));
    const details=hasDetails?'<div class="timeline-details" id="event-details-'+i+'" hidden>'+
      (e.details.intro?'<p class="timeline-intro">'+e.details.intro+'</p>':'')+
      ((e.details.tips||[]).length?'<ul>'+e.details.tips.map(t=>'<li>'+t+'</li>').join("")+'</ul>':'')+
      '</div>':'';
    const toggle=hasDetails?'<button class="timeline-detail-toggle" type="button" data-detail="'+i+'" aria-expanded="false"><span>景點介紹與注意事項</span><span class="chev">⌄</span></button>':'';
    return '<div class="timeline-item"><div class="timeline-dot"></div><article class="timeline-card">'+
      '<div class="timeline-top"><div><div class="type">'+typeLabel(e.type)+'</div><h3>'+e.title+'</h3></div><div class="time">'+e.time+'</div></div>'+
      '<div class="sub">'+(e.subtitle||'')+'</div><div class="note">'+(e.note||'')+'</div>'+
      toggle+details+(nav?'<div class="timeline-actions">'+nav+'</div>':'')+
      '</article></div>';
  }).join("");
  el.querySelectorAll("[data-detail]").forEach(btn=>btn.onclick=()=>{
    const box=$("event-details-"+btn.dataset.detail),open=btn.getAttribute("aria-expanded")==="true";
    btn.setAttribute("aria-expanded",String(!open));box.hidden=open;btn.classList.toggle("open",!open);
  });
}
function renderStay(){const e=[...TRIP.days[selectedDay].events].reverse().find(x=>x.type==="stay");$("tonightCard").innerHTML=e?'<div class="stay-card"><span class="section-kicker">CHECK-IN</span><h3>'+e.title+'</h3><p>'+e.subtitle+'</p><p>'+e.note+'</p></div>':'<div class="stay-card"><p>今天沒有住宿資料。</p></div>'}
function bookingRender(){
  const filters=[["all","全部"],["stay","住宿"],["flight","航班"],["car","租車"],["tour","Tour"]];
  if(typeof window.bookingFilter==="undefined") window.bookingFilter="all";
  $("bookingFilters").innerHTML=filters.map(([k,n])=>'<button data-booking-filter="'+k+'" class="'+(window.bookingFilter===k?'active':'')+'">'+n+'</button>').join("");
  $("bookingFilters").querySelectorAll("[data-booking-filter]").forEach(b=>b.onclick=()=>{window.bookingFilter=b.dataset.bookingFilter;bookingRender()});
  const list=(TRIP.bookings||[]).filter(b=>window.bookingFilter==="all"||b.type===window.bookingFilter);
  $("bookingList").innerHTML=list.length?list.map((b,i)=>{
    const rows=(b.details?.rows||[]).map(r=>'<div class="booking-detail-row"><span>'+r[0]+'</span><strong>'+r[1]+'</strong></div>').join("");
    const code=b.code&&b.code!=="—"?'<div class="booking-code"><small>CONFIRMATION'+(b.secret?' / PIN':'')+'</small><strong>'+b.code+(b.secret?' · PIN '+b.secret:'')+'</strong></div>':'';
    return '<article class="booking-card"><div class="booking-card-head"><div class="booking-type-icon '+(b.type||"other")+'">'+bookingTypeIcon(b.type)+'</div><div class="booking-card-title"><span class="section-kicker">'+(b.provider||b.type||"BOOKING")+'</span><h3>'+b.title+'</h3><p>'+((b.dates||b.meta)||"")+'</p></div></div>'+code+(b.notice?'<div class="notice">'+b.notice+'</div>':'')+(rows?'<div class="booking-detail-grid">'+rows+'</div>':'')+'</article>';
  }).join(""):'<div class="booking-empty"><strong>目前沒有這類預訂</strong></div>';
}
async function refreshWeather(d){$("weatherTemp").textContent="--°";$("weatherLabel").textContent="讀取中";$("weatherIconWrap").innerHTML=weatherIcon(3);const p=d.events.find(e=>e.lat);if(!p)return;try{if(demoMode){$("weatherTemp").textContent=["2°","0°","-2°","-3°","-1°","1°","0°","2°"][selectedDay];$("weatherLabel").textContent=["陰天","多雲","雪","陰天","雪","多雲","雨","多雲"][selectedDay];$("weatherIconWrap").innerHTML=weatherIcon(selectedDay===2||selectedDay===4?71:3);$("todaySunrise").textContent=["10:02","10:00","09:59","10:01","10:03","10:05","10:07","10:09"][selectedDay];$("todaySunset").textContent=["15:57","15:52","15:49","15:46","15:43","15:40","15:38","15:35"][selectedDay];return}const u="https://api.open-meteo.com/v1/forecast?latitude="+p.lat+"&longitude="+p.lng+"&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=Atlantic%2FReykjavik&forecast_days=16";const j=await fetch(u).then(r=>r.json()),i=j.daily?.time?.indexOf(d.date);if(i<0){$("weatherLabel").textContent="待預報";return}$("weatherTemp").textContent=Math.round(j.daily.temperature_2m_max[i])+"°";$("weatherLabel").textContent="預報";$("weatherIconWrap").innerHTML=weatherIcon(j.daily.weather_code[i]);$("todaySunrise").textContent=j.daily.sunrise[i].slice(-5);$("todaySunset").textContent=j.daily.sunset[i].slice(-5)}catch(e){$("weatherLabel").textContent="暫無資料"}}
function switchView(v){activeView=v;document.querySelectorAll(".view").forEach(x=>x.classList.remove("active"));$(v+"View").classList.add("active");document.querySelectorAll(".nav-item[data-target]").forEach(x=>x.classList.toggle("active",x.dataset.target===v));if(v==="map")setTimeout(renderMap,50);if(v==="booking")bookingRender()}
function ensureMap(){
  if(map||!window.L)return !!map;
  const node=$("map"); if(!node)return false;
  map=L.map("map",{zoomControl:true,preferCanvas:true}).setView([64.2,-18.8],7);
  if(typeof L.maplibreGL==="function"){
    L.maplibreGL({style:"https://tiles.openfreemap.org/styles/liberty"}).addTo(map);
  }else{
    L.tileLayer("https://tile.openstreetmap.de/{z}/{x}/{y}.png",{maxZoom:18,attribution:"© OpenStreetMap contributors"}).addTo(map);
  }
  setTimeout(()=>map.invalidateSize(),60);
  return true;
}
function renderMapStrip(){
  const el=$("mapDayStrip");
  const allSelected=mapSelectedDays.size===TRIP.days.length;
  const allBtn=mapMultiSelectMode?'<button class="map-day-btn '+(allSelected?'active':'')+'" data-all="1"><strong>全部</strong><small>'+TRIP.days.length+' 天</small></button>':'';
  el.innerHTML=allBtn+TRIP.days.map((d,i)=>'<button class="map-day-btn '+(mapSelectedDays.has(i)?'active':'')+'" data-day="'+i+'"><strong>'+d.label+'</strong><small>'+fmtDate(d.date)+'</small></button>').join("");
  el.querySelectorAll("[data-day]").forEach(b=>b.onclick=()=>{
    const i=+b.dataset.day;
    if(!mapMultiSelectMode){
      selectedDay=i;mapSelectedDays=new Set([i]);
    }else if(mapSelectedDays.has(i)){
      if(mapSelectedDays.size>1) mapSelectedDays.delete(i);
    }else mapSelectedDays.add(i);
    renderAll();renderMap();
  });
  const all=el.querySelector("[data-all]");
  if(all) all.onclick=()=>{
    mapSelectedDays=allSelected?new Set([selectedDay]):new Set(TRIP.days.map((_,i)=>i));
    renderAll();renderMap();
  };
  $("mapMultiToggle").classList.toggle("active",mapMultiSelectMode);
}
function toggleMapMulti(){
  mapMultiSelectMode=!mapMultiSelectMode;
  if(!mapMultiSelectMode){
    const first=[...mapSelectedDays].sort((a,b)=>a-b)[0]??selectedDay;
    selectedDay=first;mapSelectedDays=new Set([first]);
  }
  renderMapStrip();renderMap();
}
function routeStops(day){const out=[];for(const e of day.events.filter(e=>e.lat&&e.lng)){const last=out.at(-1);if(!last||Math.abs(last.lat-e.lat)>1e-6||Math.abs(last.lng-e.lng)>1e-6)out.push(e)}return out}
async function roadRoute(dayIndex){
  const d=TRIP.days[dayIndex],stops=routeStops(d);
  if(stops.length<2)return null;
  const key=dayIndex+":"+stops.map(e=>e.lat.toFixed(5)+","+e.lng.toFixed(5)).join("|");
  if(routeCache.has(key))return routeCache.get(key);
  const p=(async()=>{
    const coords=stops.map(e=>e.lng+","+e.lat).join(";");
    const u="https://router.project-osrm.org/route/v1/driving/"+coords+"?overview=full&geometries=geojson&steps=false";
    const r=await fetch(u,{mode:"cors"});if(!r.ok)throw new Error("routing "+r.status);
    const j=await r.json();if(j.code!=="Ok"||!j.routes?.[0])throw new Error(j.code||"No route");
    return {points:j.routes[0].geometry.coordinates.map(([lng,lat])=>[lat,lng]),km:j.routes[0].distance/1000,sec:j.routes[0].duration};
  })().catch(e=>{routeCache.delete(key);throw e});
  routeCache.set(key,p);return p;
}
function driveText(sec){const m=Math.round(sec/60),h=Math.floor(m/60),mm=m%60;return h?h+"h "+String(mm).padStart(2,"0")+"m":m+"m"}
async function renderMap(){
  if(!ensureMap())return;
  setTimeout(()=>map.invalidateSize(),0);
  const token=++routeRenderToken,indices=[...mapSelectedDays].sort((a,b)=>a-b);
  const single=indices.length===1,d=TRIP.days[indices[0]];
  $("mapDayLabel").textContent=single?d.label:indices.length+"天";
  $("mapDayName").textContent=single?d.name:"多日路線";
  renderMapStrip();
  mapMarkers.forEach(m=>m.remove());mapMarkers=[];
  routeLayers.forEach(l=>{if(map.hasLayer(l))map.removeLayer(l)});routeLayers=[];
  if(routeLine&&map.hasLayer(routeLine))routeLine.remove();routeLine=null;
  const bounds=L.latLngBounds([]);
  const fallbackByDay=new Map();
  let fallbackKm=0;
  for(const idx of indices){
    const day=TRIP.days[idx],stops=routeStops(day);fallbackKm+=Number(day.km)||0;
    day.events.filter(e=>e.lat&&e.lng).forEach((e,i)=>{const m=L.marker([e.lat,e.lng]).addTo(map).bindPopup("<b>"+day.label+" · "+(i+1)+". "+e.title+"</b><br>"+e.time);mapMarkers.push(m);bounds.extend([e.lat,e.lng])});
    const pts=stops.map(e=>[e.lat,e.lng]);
    if(pts.length>1){const l=L.polyline(pts,{color:"#8b8f8c",weight:3,opacity:.35,dashArray:"6,7"}).addTo(map);routeLayers.push(l);fallbackByDay.set(idx,l)}
  }
  $("mapRangeSummary").textContent=indices.length+" 天 · "+fallbackKm.toFixed(1)+" km";
  $("mapRangeHint").textContent=mapMultiSelectMode?(indices.length>1?indices.map(i=>TRIP.days[i].label).join(" · "):"複選模式：再點日期加入"):"點日期直接切換";
  if(bounds.isValid())map.fitBounds(bounds,{padding:[30,30]});
  let totalKm=0,totalSec=0;
  for(const idx of indices){
    try{
      const rr=await roadRoute(idx);if(token!==routeRenderToken)return;if(!rr)continue;
      const fallback=fallbackByDay.get(idx);if(fallback&&map.hasLayer(fallback)){map.removeLayer(fallback);routeLayers=routeLayers.filter(x=>x!==fallback)}
      const line=L.polyline(rr.points,{color:"#173c35",weight:5,opacity:.95,lineCap:"round",lineJoin:"round"}).addTo(map);routeLayers.push(line);if(single)routeLine=line;
      rr.points.forEach(p=>bounds.extend(p));totalKm+=rr.km;totalSec+=rr.sec;
    }catch(err){console.warn("Road route unavailable",err);totalKm+=Number(TRIP.days[idx].km)||0}
  }
  if(token!==routeRenderToken)return;
  if(bounds.isValid())map.fitBounds(bounds,{padding:[30,30]});
  $("mapRangeSummary").textContent=indices.length+" 天 · "+totalKm.toFixed(1)+" km"+(totalSec?" · "+driveText(totalSec):"");
  $("routeCurrent").textContent=single?(d.events[0]?.title||d.name):"已選 "+indices.length+" 天";
  $("routeMeta").textContent=indices.map(i=>TRIP.days[i].label).join(" · ");
  $("routeDistance").textContent="0";
  $("routeTotal").textContent=single?Math.round(totalKm):Math.round(totalKm);
  $("routeStops").innerHTML=indices.flatMap(i=>TRIP.days[i].events).map(e=>"<span>"+e.time+" "+e.title+"</span>").join("");
}
function renderAll(){renderHero();renderDayStrip();renderTimeline();renderStay();renderMapStrip();if(activeView==="booking")bookingRender()}
function openTrip(){ $("tripSheet").classList.add("show");$("sheetBackdrop").classList.add("show")}
function closeTrip(){ $("tripSheet").classList.remove("show");$("sheetBackdrop").classList.remove("show")}
function setupUI(){initIcons();document.querySelectorAll("[data-target]").forEach(b=>b.onclick=()=>switchView(b.dataset.target));document.querySelectorAll("[data-nav]").forEach(b=>b.onclick=()=>switchView(b.dataset.nav));$("tripMenuBtn").onclick=openTrip;$("heroMenuBtn").onclick=openTrip;$("closeSheet").onclick=closeTrip;$("sheetBackdrop").onclick=closeTrip;$("demoModeToggle").onclick=()=>{demoMode=!demoMode;localStorage.setItem("travelDemo",demoMode?"1":"0");$("demoModeToggle").classList.toggle("active",demoMode);$("demoModeState").textContent=demoMode?"開啟":"關閉";if(demoMode)selectedDay=3;renderAll()};$("demoModeToggle").classList.toggle("active",demoMode);$("demoModeState").textContent=demoMode?"開啟":"關閉";$("routeSlider").oninput=e=>$("routeDistance").textContent=Math.round((+$("routeTotal").textContent||TRIP.days[selectedDay].km)*(+e.target.value/100));
  $("mapMultiToggle").onclick=toggleMapMulti;
  let heroRAF=0;
  const updateHeroProgress=()=>{
    const h=$("heroCard"); if(!h)return;
    const y=Math.max(0,window.scrollY||0);
    const p=Math.max(0,Math.min(1,(y-18)/132));
    h.style.setProperty("--hero-collapse",p.toFixed(4));
    h.classList.toggle("hero-collapsed",p>.96);
  };
  addEventListener("scroll",()=>{if(heroRAF)return;heroRAF=requestAnimationFrame(()=>{heroRAF=0;updateHeroProgress()})},{passive:true});
  updateHeroProgress();
  const idx=dayIndexByToday();selectedDay=demoMode?3:(idx>=0?idx:0);renderAll()}

function cloudReservationToBooking(row){
  const base=(row.details&&typeof row.details==="object")?row.details:{};
  return {
    ...base,
    type:base.type||row.reservation_type||"other",
    provider:base.provider||row.provider||"",
    title:base.title||row.title||"預訂",
    dates:base.dates||row.public_summary||"",
    meta:base.meta||row.public_summary||"",
    code:row.confirmation_code||base.code||"—",
    secret:row.pin_code||base.secret||null,
    notice:base.notice||row.private_notes||"",
    status:base.status||row.status||"confirmed",
    details:base.details||{
      rows:[
        ...(row.public_price_text?[["費用",row.public_price_text]]:[]),
        ...(row.cancellation_policy?[["取消條款",row.cancellation_policy]]:[])
      ]
    }
  };
}
async function syncCloudPrivateData(){
  try{
    const client=TravelAuth.getClient();
    if(!client) return;
    const device=await TravelStore.getDevice();
    const {data,error}=await client.functions.invoke("travel-data",{body:{
      tripSlug:window.TRAVEL_CONFIG.tripSlug,
      devicePublicId:device.device_public_id,
      deviceSecret:device.device_secret
    }});
    if(error) throw error;
    if(!data?.ok) throw new Error(data?.error||"cloud_sync_failed");
    TRIP.bookings=(data.reservations||[]).map(cloudReservationToBooking);
    if(TravelStore.replaceBookings) await TravelStore.replaceBookings(TRIP.bookings);
    bookingRender();
  }catch(err){
    console.warn("Private booking sync unavailable",err);
  }
}

function authPaint(s){const msg=$("authMessage"),foot=$("authFoot"),btn=$("magicLinkBtn");if(!msg)return;btn.disabled=["sending_link","registering_device","loading"].includes(s.state);if(s.state==="loading")msg.textContent="正在檢查登入狀態…";if(s.state==="sending_link")msg.textContent="正在寄送一次性登入連結…";if(s.state==="link_sent"){msg.textContent="登入連結已寄出，請到 Gmail 點一下 Magic Link。";foot.textContent="點開後會回到這個 Travel OS，並把這支裝置註冊成 Trusted Device。"}if(s.state==="signed_out")msg.textContent="私人旅程需要驗證此裝置。第一次登入後，這支手機會被記住。";if(s.state==="registering_device")msg.textContent="登入成功，正在核准這支裝置…";if(s.state==="device_error"){msg.textContent="登入成功，但裝置核准失敗。";foot.textContent="請重新整理；若仍失敗我會檢查 Supabase。"}}
async function boot(){
  setupUI();
  if("serviceWorker"in navigator)navigator.serviceWorker.register("./service-worker.js").catch(()=>{});
  try{
    const seedBookings=[...(TRIP.bookings||[])];
    const local=await TravelStore.init(TRIP);
    if(local?.trip){
      TRIP=local.trip;
      if((!TRIP.bookings||!TRIP.bookings.length)&&seedBookings.length) TRIP.bookings=seedBookings;
      renderAll()
    }
    await TravelSync.init();
  }catch(e){console.warn("Local DB",e)}
  window.addEventListener("travel-auth-ready",()=>syncCloudPrivateData());
  TravelAuth.onChange(authPaint);
  authPaint(TravelAuth.snapshot());
  $("magicLinkForm").onsubmit=async e=>{e.preventDefault();try{await TravelAuth.sendMagicLink($("authEmail").value.trim())}catch(err){$("authMessage").textContent="寄送失敗："+(err.message||err)}};
  try{
    await TravelAuth.init();
    if(TravelAuth.snapshot().state==="ready") await syncCloudPrivateData();
  }catch(e){console.error(e)}
}
document.addEventListener("DOMContentLoaded",boot);