let selectedDay=3, currentFilter='all', map, routeLine, routeCar, routeTimer=null;
let mapSelectedDays=new Set([selectedDay]), mapPrimaryDay=selectedDay, mapRouteLayers=[];
let mapMultiSelectMode=false;
let demoMode=(()=>{try{return localStorage.getItem('icelandDemoMode')==='1'}catch(_){return false}})();
let routeGeometry=[], routeCumulative=[], routeTotalKm=0, routeStopFractions=[];
let routeRenderToken=0;
const roadRouteCache=new Map();
let todayRouteToken=0;
let lastObservedIcelandDate=null;
let currentTripRole='viewer';
let cloudLoaded=false;
let editMode=false;
let authorizedTrips=[];

const titles={today:'今天',map:'旅程地圖',booking:'預訂'};
const typeLabel={flight:'航班',car:'租車',spot:'景點',shop:'補給',stay:'住宿',drive:'移動',food:'餐食',tour:'TOUR',plan:'備案'};

const DAY_UI={
  D0:{photo:"url('https://commons.wikimedia.org/wiki/Special:FilePath/Blue%20Lagoon%2C%20Iceland%20%2820256742624%29.jpg?width=1600')", sunrise:'10:02', sunset:'15:57'},
  D1:{photo:"url('https://commons.wikimedia.org/wiki/Special:FilePath/Gullfoss%20Waterfall%20in%20Winter.jpg?width=1600')", sunrise:'10:00', sunset:'15:52'},
  D2:{photo:"url('https://commons.wikimedia.org/wiki/Special:FilePath/Reynisfjara%2C%20Iceland%2C%2020240720%200844%202840.jpg?width=1600')", sunrise:'09:59', sunset:'15:49'},
  D3:{photo:"url('https://commons.wikimedia.org/wiki/Special:FilePath/Islanda%20-%20lago%20J%C3%B6kuls%C3%A1rl%C3%B3n.jpg?width=1600')", sunrise:'10:01', sunset:'15:46'},
  D4:{photo:"url('https://commons.wikimedia.org/wiki/Special:FilePath/Skaftafell%2C%20Iceland.jpg?width=1600')", sunrise:'10:03', sunset:'15:44'},
  D5:{photo:"url('https://commons.wikimedia.org/wiki/Special:FilePath/IcelandicHorsesInWinter.jpg?width=1600')", sunrise:'10:05', sunset:'15:42'},
  D6:{photo:"url('https://commons.wikimedia.org/wiki/Special:FilePath/Kirkjufell%20in%20Iceland.jpg?width=1600')", sunrise:'10:07', sunset:'15:40'},
  D7:{photo:"url('https://commons.wikimedia.org/wiki/Special:FilePath/Keflav%C3%ADk%20International%20Airport%20seen%20from%20runway.jpg?width=1600')", sunrise:'10:09', sunset:'15:39'}
};

const WEATHER_LOCATIONS={
  D0:{name:'Blue Lagoon / KEF',lat:63.8804,lng:-22.4495},
  D1:{name:'Gullfoss / 黃金圈',lat:64.3271,lng:-20.1199},
  D2:{name:'Reynisfjara / 南岸',lat:63.404,lng:-19.044},
  D3:{name:'Jökulsárlón / 冰河湖',lat:64.0484,lng:-16.179},
  D4:{name:'Skaftafell',lat:64.017,lng:-16.966},
  D5:{name:'Kerið / 西返路段',lat:64.0413,lng:-20.8851},
  D6:{name:'Kirkjufell / 斯奈山',lat:64.941,lng:-23.306},
  D7:{name:'KEF Airport',lat:63.985,lng:-22.606}
};

const weatherCache=new Map();

const DEMO_REFERENCE_DATE='2026-11-23';
const DEMO_WEATHER_BASE=[3,1,-2,-4,-1,2,0,4];
const DEMO_WEATHER_CODE=[3,3,71,71,1,3,3,3];
function demoWeatherForDay(dayIndex){
  const d=TRIP.days[dayIndex];
  const firstCoord=(d.events||[]).find(validCoord);
  const loc=WEATHER_LOCATIONS[d.label]||(firstCoord?{name:d.name||d.label,lat:firstCoord.lat,lng:firstCoord.lng}:null);
  const ui=dayUi(d);
  const base=DEMO_WEATHER_BASE[dayIndex]??0;
  const code=DEMO_WEATHER_CODE[dayIndex]??3;
  const times=['08:00','10:00','12:00','14:00','16:00','18:00','20:00'];
  const offsets=[-2,-1,0,1,0,-2,-3];
  const rainBase=[12,18,24,20,16,12,10];
  const windBase=[4.2,4.8,5.5,6.1,5.7,4.9,4.3];
  const hours=times.map((time,i)=>({
    time,
    temp:base+offsets[i],
    feels:base+offsets[i]-3,
    rain:Math.max(0,rainBase[i]+(dayIndex%3)*5),
    code:i===3&&code===3?1:code,
    wind:windBase[i]+(dayIndex%2)*0.7
  }));
  const noon=hours.find(h=>h.time==='12:00')||hours[0];
  return {
    available:true,
    demo:true,
    location:loc,
    date:d.date,
    hours,
    noon,
    sunrise:`${d.date}T${ui.sunrise}`,
    sunset:`${d.date}T${ui.sunset}`,
    max:Math.max(...hours.map(h=>h.temp)),
    min:Math.min(...hours.map(h=>h.temp)),
    rainMax:Math.max(...hours.map(h=>h.rain)),
    maxWind:Math.max(...hours.map(h=>h.wind))
  };
}

function forecastAvailableFrom(dateString){
  const d=new Date(`${dateString}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate()-15);
  return d.toISOString().slice(0,10);
}

function zhDate(dateString){
  const [y,m,d]=dateString.split('-');
  return `${y}/${m}/${d}`;
}

function hhmm(iso){
  if(!iso) return '--:--';
  const m=String(iso).match(/T(\d{2}:\d{2})/);
  return m?m[1]:'--:--';
}

function wmoType(code){
  if(code===0) return 'sun';
  if([71,73,75,77,85,86].includes(code)) return 'snow';
  if([51,53,55,56,57,61,63,65,66,67,80,81,82,95,96,99].includes(code)) return 'rain';
  return 'cloud';
}

function wmoLabel(code){
  if(code===0) return '晴朗';
  if(code===1) return '大致晴朗';
  if(code===2) return '局部多雲';
  if(code===3) return '陰天';
  if([45,48].includes(code)) return '霧';
  if([51,53,55,56,57].includes(code)) return '毛毛雨';
  if([61,63,65,66,67].includes(code)) return '降雨';
  if([71,73,75,77].includes(code)) return '降雪';
  if([80,81,82].includes(code)) return '陣雨';
  if([85,86].includes(code)) return '陣雪';
  if([95,96,99].includes(code)) return '雷雨';
  return '天氣';
}

async function fetchWeatherForDay(dayIndex){
  const d=TRIP.days[dayIndex];
  const loc=weatherLocationForDay(dayIndex);
  if(!loc) throw new Error('Missing weather location');
  const cacheKey=`${d.date}:${loc.lat},${loc.lng}`;
  if(weatherCache.has(cacheKey)) return weatherCache.get(cacheKey);
  const url=new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude',loc.lat);
  url.searchParams.set('longitude',loc.lng);
  url.searchParams.set('hourly','temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m');
  url.searchParams.set('daily','sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  url.searchParams.set('timezone',TRIP.timezone||'UTC');
  url.searchParams.set('wind_speed_unit','ms');
  url.searchParams.set('forecast_days','16');
  const pending=fetch(url.toString(),{mode:'cors'}).then(async res=>{
    if(!res.ok) throw new Error(`weather ${res.status}`);
    const json=await res.json();
    const dayIndexInApi=(json.daily?.time||[]).indexOf(d.date);
    if(dayIndexInApi<0){
      return {available:false,location:loc,availableFrom:forecastAvailableFrom(d.date),date:d.date};
    }
    const hours=[];
    const times=json.hourly?.time||[];
    for(let i=0;i<times.length;i++){
      if(!String(times[i]).startsWith(d.date)) continue;
      hours.push({
        time:String(times[i]).slice(11,16),
        temp:json.hourly.temperature_2m?.[i],
        feels:json.hourly.apparent_temperature?.[i],
        rain:json.hourly.precipitation_probability?.[i]??0,
        code:json.hourly.weather_code?.[i]??3,
        wind:json.hourly.wind_speed_10m?.[i]??0
      });
    }
    const daylight=hours.filter(h=>h.time>='06:00'&&h.time<='22:00');
    const displayHours=daylight.length?daylight:hours;
    const noon=hours.reduce((best,h)=>Math.abs(+h.time.slice(0,2)-12)<Math.abs(+best.time.slice(0,2)-12)?h:best,hours[0]);
    const maxWind=Math.max(...hours.map(h=>Number(h.wind)||0));
    return {
      available:true,
      location:loc,
      date:d.date,
      hours:displayHours,
      noon,
      sunrise:json.daily.sunrise?.[dayIndexInApi],
      sunset:json.daily.sunset?.[dayIndexInApi],
      max:json.daily.temperature_2m_max?.[dayIndexInApi],
      min:json.daily.temperature_2m_min?.[dayIndexInApi],
      rainMax:json.daily.precipitation_probability_max?.[dayIndexInApi]??0,
      maxWind
    };
  }).catch(err=>{weatherCache.delete(cacheKey);throw err});
  weatherCache.set(cacheKey,pending);
  return pending;
}

function icelandTodayISO(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:TRIP.timezone||'Atlantic/Reykjavik',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const get=t=>parts.find(p=>p.type===t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function isoDayNumber(dateString){
  const [y,m,d]=String(dateString).split('-').map(Number);
  return Math.floor(Date.UTC(y,m-1,d)/86400000);
}
function referenceTodayISO(){return demoMode?DEMO_REFERENCE_DATE:icelandTodayISO()}
function dayContext(dateString){
  const today=referenceTodayISO();
  const first=TRIP.days[0]?.date, last=TRIP.days.at(-1)?.date;
  const diff=isoDayNumber(dateString)-isoDayNumber(today);
  const tripStarted=today>=first;
  const tripEnded=today>last;

  let label,timelineLabel;
  if(demoMode){
    if(diff===-2) label='前天';
    else if(diff===-1) label='昨天';
    else if(diff===0) label='今天';
    else if(diff===1) label='明天';
    else if(diff===2) label='後天';
    else if(diff<0) label=`${Math.abs(diff)}天前`;
    else label=`${diff}天後`;
    timelineLabel=label;
  }else{
    // Live mode is a simple trip countdown/count-up. Keep the compact hero
    // label numeric (e.g. 46天) because the date is already shown above.
    if(diff===0){
      label='今天';
      timelineLabel='今天';
    }else{
      label=`${Math.abs(diff)}天`;
      timelineLabel=diff<0?`${Math.abs(diff)}天前`:`${diff}天後`;
    }
  }

  return {label,timelineLabel,diff,isPast:diff<0,isToday:diff===0,isFuture:diff>0,tripStarted,tripEnded,today};
}
function syncToReferenceTripDay(forceDemo=false){
  const today=(demoMode||forceDemo)?DEMO_REFERENCE_DATE:icelandTodayISO();
  const idx=TRIP.days.findIndex(d=>d.date===today);
  if(idx>=0){
    selectedDay=idx;
    mapPrimaryDay=idx;
    mapSelectedDays=new Set([idx]);
    return true;
  }
  return false;
}

function qs(s){return document.querySelector(s)}
function qsa(s){return [...document.querySelectorAll(s)]}
function currentDay(){
  return TRIP.days?.[selectedDay]||{
    id:null,label:'D0',date:TRIP.startDate||new Date().toISOString().slice(0,10),
    name:'尚未建立行程',short:'',km:0,drive:'0m',driveMinutes:0,events:[]
  };
}
function validCoord(e){return Number.isFinite(e.lat)&&Number.isFinite(e.lng)}

function iconSVG(name,cls=''){
  const icons={
    road:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M9 3h6l3 18h-4l-2-12-2 12H6z"></path><path d="M12 6v2.5"></path><path d="M12 11v2.5"></path><path d="M12 16v2"></path></svg>`,
    clock:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><path d="M12 8v5l3 2"></path></svg>`,
    sunrise:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M4 18h16"></path><path d="M7 18a5 5 0 0 1 10 0"></path><path d="M12 6v3"></path><path d="M8 9.5 6.5 8"></path><path d="M16 9.5 17.5 8"></path><path d="M12 15l-2.2-2.2"></path><path d="M12 15l2.2-2.2"></path><path d="M5 21h14"></path></svg>`,
    sunset:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M4 18h16"></path><path d="M7 15a5 5 0 0 0 10 0"></path><path d="M12 6v3"></path><path d="M8 9.5 6.5 8"></path><path d="M16 9.5 17.5 8"></path><path d="M7 21h10"></path><path d="M5 20h2"></path><path d="M17 20h2"></path></svg>`,
    today:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><circle cx="12" cy="12" r="3"></circle></svg>`,
    map:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M4 6.5 9 4l6 2.5 5-2v13L15 20l-6-2.5-5 2z"></path><path d="M9 4v13.5"></path><path d="M15 6.5V20"></path></svg>`,
    booking:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M5 7h14a2 2 0 0 1 2 2v2a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2v0a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 2-2 2 2 0 0 0-2-2V9a2 2 0 0 1 2-2z"></path><path d="M8 10h8"></path><path d="M8 14h5"></path></svg>`,
    expense:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M4 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4z"></path><path d="M16 12h.01"></path><path d="M7 10h5"></path><path d="M7 14h3"></path></svg>`,
    more:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M5 7h14"></path><path d="M8 12h11"></path><path d="M11 17h8"></path><circle cx="6" cy="7" r="1"></circle><circle cx="6" cy="12" r="1"></circle><circle cx="6" cy="17" r="1"></circle></svg>`,
    house:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M4 11.5 12 5l8 6.5"></path><path d="M6 10.5V20h12v-9.5"></path></svg>`,
    car:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M5 15h14l-1.5-5h-11z"></path><path d="M7 15v2"></path><path d="M17 15v2"></path><circle cx="8" cy="17" r="1.6"></circle><circle cx="16" cy="17" r="1.6"></circle></svg>`,
    flight:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5C13 2.7 12.3 2 11.5 2S10 2.7 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5L21 16Z"></path></svg>`,
    plane:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M21 16v-2l-8-5V3.5C13 2.7 12.3 2 11.5 2S10 2.7 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5L21 16Z"></path></svg>`,
    tour:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M5 7h14a2 2 0 0 1 2 2v2a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2v0a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 2-2 2 2 0 0 0-2-2V9a2 2 0 0 1 2-2z"></path><path d="M8 10h8"></path><path d="M8 14h5"></path></svg>`,
    weatherUnknown:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M6.5 17h9.2a3.8 3.8 0 0 0 .5-7.6A5.3 5.3 0 0 0 6 10.4 3.3 3.3 0 0 0 6.5 17z"></path><path d="M18.2 5.5c0-1.2.8-2 2-2 1.1 0 1.9.7 1.9 1.7 0 .8-.4 1.2-1.2 1.7-.6.4-.8.7-.8 1.2"></path><path d="M20.1 10.5h.01"></path></svg>`,
    snow:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M12 3v18"></path><path d="M6 6l12 12"></path><path d="M18 6 6 18"></path><path d="M3 12h18"></path></svg>`,
    cloud:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M7 18h9a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.5 1A3.5 3.5 0 0 0 7 18z"></path></svg>`,
    sun:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="M4.9 4.9 6.3 6.3"></path><path d="M17.7 17.7 19.1 19.1"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="M4.9 19.1 6.3 17.7"></path><path d="M17.7 6.3 19.1 4.9"></path></svg>`,
    rain:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M7 15h9a4 4 0 0 0 .5-8 5.5 5.5 0 0 0-10.5 1A3.5 3.5 0 0 0 7 15z"></path><path d="M9 17l-1 3"></path><path d="M13 17l-1 3"></path><path d="M17 17l-1 3"></path></svg>`,
    drop:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M12 4c2.5 3.4 4.5 6 4.5 8.2A4.5 4.5 0 1 1 7.5 12.2C7.5 10 9.5 7.4 12 4z"></path></svg>`,
    wind:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M4 9h10a2.5 2.5 0 1 0-2.5-2.5"></path><path d="M4 14h14a2.5 2.5 0 1 1-2.5 2.5"></path></svg>`
  };
  return icons[name]||'';
}

function dayUi(d){
  const fallback=DAY_UI[d.label]||DAY_UI.D0;
  return {
    ...fallback,
    photo:d?.heroImageUrl?`url('${d.heroImageUrl}')`:fallback.photo,
    sunrise:d?.sunrise||fallback.sunrise,
    sunset:d?.sunset||fallback.sunset
  };
}
function driveText(day){
  if(day?.drive) return day.drive;
  const mins=Number(day?.driveMinutes)||0;
  const h=Math.floor(mins/60),m=mins%60;
  return h?`${h}h ${String(m).padStart(2,'0')}m`:`${m}m`;
}
function currentTripTitle(){return TRIP?.title||'Travel OS'}
function syncTripLabels(){
  const title=currentTripTitle();
  qsa('[data-trip-title]').forEach(el=>el.textContent=title);
  const authTitle=qs('#authTripTitle'); if(authTitle) authTitle.textContent=window.TRAVEL_CONFIG?.tripSlug?title:'Travel OS';
  const dateSummary=qs('#tripDateSummary');
  if(dateSummary) dateSummary.textContent=[TRIP?.startDate||TRIP?.days?.[0]?.date,TRIP?.endDate||TRIP?.days?.at(-1)?.date].filter(Boolean).join(' → ')||'—';
  const roleSummary=qs('#tripRoleSummary'); if(roleSummary) roleSummary.textContent=String(currentTripRole||TRIP?.role||'viewer').toUpperCase();
  const syncSummary=qs('#tripSyncSummary'); if(syncSummary) syncSummary.textContent=cloudLoaded?'Cloud synced':'Offline cache';
  document.title=window.TRAVEL_CONFIG?.tripSlug?`${title} · Travel OS`:'Travel OS';
}

function renderBottomNavIcons(){
  qsa('.nav-icon[data-icon]').forEach(el=>{el.innerHTML=iconSVG(el.dataset.icon)})
}

function renderBookingIcons(){
  const typeToIcon={stay:'house',car:'car',flight:'flight',tour:'booking'};
  qsa('.booking-icon[data-booking-type]').forEach(el=>{el.innerHTML=iconSVG(typeToIcon[el.dataset.bookingType]||'booking')})
}

function renderStaticIcons(){}

function showView(name){
  qs('.app-shell')?.classList.toggle('today-mode',name==='today');
  qsa('.view').forEach(v=>v.classList.remove('active'));
  qs('#'+name+'View').classList.add('active');
  qsa('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.target===name));
  qs('#pageTitle').textContent=titles[name];
  if(name==='map') setTimeout(()=>{initMap();map.invalidateSize();renderMapDay()},60);
  if(name==='today') requestAnimationFrame(updateHeroCollapse);
}

function renderDayStrip(){
  const dateLabel=d=>String(d.date||'').slice(5).replace('-','/');
  const html=TRIP.days.map((d,i)=>{
    const ctx=dayContext(d.date);
    return `<button class="day-btn ${i===selectedDay?'active':''} ${ctx.isPast?'completed':''}" data-day="${i}"><strong>${d.label}</strong><small>${dateLabel(d)}</small></button>`;
  }).join('');
  qs('#dayStrip').innerHTML=html;
  qs('#dayStrip').querySelectorAll('[data-day]').forEach(b=>b.onclick=()=>{
    selectedDay=+b.dataset.day;
    mapSelectedDays=new Set([selectedDay]);
    mapPrimaryDay=selectedDay;
    renderAll();
  });

  const allSelected=mapSelectedDays.size===TRIP.days.length;
  const dayButtons=TRIP.days.map((d,i)=>`<button class="map-day-btn ${mapSelectedDays.has(i)?'active':''}" data-map-day="${i}"><strong>${d.label}</strong><small>${dateLabel(d)}</small></button>`).join('');
  const allButton=mapMultiSelectMode?`<button class="map-day-btn map-all-chip ${allSelected?'active':''}" data-map-all="1"><strong>全部</strong><small>${TRIP.days.length} 天</small></button>`:'';
  qs('#mapDayStrip').innerHTML=allButton+dayButtons;
  qs('#mapDayStrip').querySelectorAll('[data-map-day]').forEach(b=>b.onclick=()=>handleMapDayClick(+b.dataset.mapDay));
  const allBtn=qs('#mapDayStrip [data-map-all]');
  if(allBtn) allBtn.onclick=toggleMapAllDays;
  const multiBtn=qs('#mapMultiToggle');
  if(multiBtn){
    multiBtn.textContent='複選';
    multiBtn.classList.toggle('active',mapMultiSelectMode);
  }
}

function sortedMapDays(){
  return [...mapSelectedDays].sort((a,b)=>a-b);
}

function handleMapDayClick(dayIndex){
  if(!mapMultiSelectMode){
    selectedDay=dayIndex;
    mapPrimaryDay=dayIndex;
    mapSelectedDays=new Set([dayIndex]);
    renderDayStrip();
    renderToday();
    if(map) renderMapDay();
    return;
  }
  mapPrimaryDay=dayIndex;
  if(mapSelectedDays.has(dayIndex)){
    if(mapSelectedDays.size===1) return;
    mapSelectedDays.delete(dayIndex);
  }else{
    mapSelectedDays.add(dayIndex);
  }
  renderDayStrip();
  if(map) renderMapDay();
}

function toggleMapMultiMode(){
  if(mapMultiSelectMode){
    const first=sortedMapDays()[0] ?? mapPrimaryDay ?? selectedDay;
    mapMultiSelectMode=false;
    selectedDay=first;
    mapPrimaryDay=first;
    mapSelectedDays=new Set([first]);
  }else{
    mapMultiSelectMode=true;
    if(mapSelectedDays.size===0) mapSelectedDays=new Set([mapPrimaryDay]);
  }
  renderDayStrip();
  const indices=sortedMapDays();
  const totals=selectionFallbackTotals(indices);
  updateMapRangeText(indices,totals.km,totals.sec);
  if(map) renderMapDay();
}
function toggleMapAllDays(){
  if(!mapMultiSelectMode) return;
  if(mapSelectedDays.size===TRIP.days.length){
    mapSelectedDays=new Set([mapPrimaryDay]);
  }else{
    mapSelectedDays=new Set(TRIP.days.map((_,i)=>i));
  }
  renderDayStrip();
  if(map) renderMapDay();
}

function escapeHtml(value){
  return String(value??'').replace(/[&<>"']/g,ch=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

function renderEventDetails(e,dayIndex,eventIndex){
  const detail=e.details;
  if(!detail) return '';
  const tips=(detail.tips||[]).map(t=>`<li>${escapeHtml(t)}</li>`).join('');
  return `<div class="event-detail-wrap">
    <button class="detail-toggle" type="button" aria-expanded="false" onclick="event.stopPropagation();toggleEventDetails(${dayIndex},${eventIndex},this)">
      <span>景點介紹與注意事項</span><span class="detail-chevron">⌄</span>
    </button>
    <div class="event-details" id="eventDetails-${dayIndex}-${eventIndex}" hidden>
      ${detail.intro?`<div class="detail-section"><div class="detail-label">景點介紹</div><p>${escapeHtml(detail.intro)}</p></div>`:''}
      ${tips?`<div class="detail-section"><div class="detail-label warn">注意事項</div><ul>${tips}</ul></div>`:''}
      <div class="detail-source">來源：原行程表備註 · 後續可在系統內編輯</div>
    </div>
  </div>`;
}

function toggleEventDetails(dayIndex,eventIndex,button){
  const panel=qs(`#eventDetails-${dayIndex}-${eventIndex}`);
  if(!panel) return;
  const opening=panel.hidden;
  panel.hidden=!opening;
  button.setAttribute('aria-expanded',String(opening));
  button.classList.toggle('open',opening);
  const label=button.querySelector('span:first-child');
  if(label) label.textContent=opening?'收起詳細資訊':'景點介紹與注意事項';
}

function handleTimelineCardClick(ev,dayIndex,eventIndex){
  if(ev.target.closest('button,a,input')) return;
  const button=ev.currentTarget.querySelector('.detail-toggle');
  if(button) toggleEventDetails(dayIndex,eventIndex,button);
}

function renderToday(){
  const d=currentDay();
  const dayIndex=selectedDay;
  const ui=dayUi(d);
  const context=dayContext(d.date);
  qs('#heroDay').textContent=`${d.label} · ${String(d.date||'').slice(5).replace('-','/')}`;
  qs('#heroTitle').textContent=d.name;
  const rel=qs('#heroRelativeLabel');
  if(rel) rel.textContent=context.label;
  const heading=qs('#timelineHeading');
  if(heading) heading.textContent=`${context.timelineLabel||context.label}行程`;
  qs('#todayView').classList.toggle('past-day',context.isPast);
  const hero=qs('#heroCard');
  hero.style.setProperty('--hero-photo',ui.photo);
  hero.style.backgroundImage=ui.photo;
  qs('#todayKm').textContent=`${d.km} km`;
  qs('#todayDrive').textContent=driveText(d);
  qs('#todaySunrise').textContent=ui.sunrise;
  qs('#todaySunset').textContent=ui.sunset;
  qs('#weatherTemp').textContent='--°';
  qs('#weatherLabel').textContent='讀取中';
  const weatherIcon=qs('#weatherIconWrap');
  if(weatherIcon) weatherIcon.innerHTML=iconSVG('weatherUnknown');
  qs('#timeline').innerHTML=d.events.map((e,eventIndex)=>`<div class="timeline-item"><div class="timeline-dot" aria-hidden="true"></div><article class="timeline-card ${e.details?'expandable':''}" onclick="handleTimelineCardClick(event,${selectedDay},${eventIndex})"><div class="timeline-top"><div><div class="type">${typeLabel[e.type]||e.type}</div><h3>${e.title}</h3></div><div class="time">${e.time||''}</div></div><div class="sub">${e.subtitle||''}</div>${e.note?`<div class="note">${e.note}</div>`:''}${renderEventDetails(e,selectedDay,eventIndex)}${validCoord(e)?`<div class="card-actions"><button class="mini-btn" onclick="event.stopPropagation();openMapsEvent(${selectedDay},${eventIndex})">導航</button>${e.type==='stay'?'<button class="mini-btn" onclick="event.stopPropagation();showView(\'booking\')">預訂資料</button>':''}</div>`:''}</article></div>`).join('');
  const stay=d.events.filter(e=>e.type==='stay').slice(-1)[0];
  qs('#tonightCard').innerHTML=stay?`<div class="stay-card"><div class="stay-top"><div><span class="section-kicker">TONIGHT</span><h3>${stay.title}</h3><p>${stay.subtitle||''}</p></div><div class="code-pill">已確認</div></div><p style="margin-top:10px">${stay.note||''}</p></div>`:`<div class="stay-card"><p>今晚沒有住宿資料。</p></div>`;
  decorateTimelineEditor();
  refreshTodayRouteStats(dayIndex);
  refreshHeroWeather(dayIndex);
}

async function refreshHeroWeather(dayIndex){
  try{
    const w=demoMode?demoWeatherForDay(dayIndex):await fetchWeatherForDay(dayIndex);
    if(selectedDay!==dayIndex) return;
    if(!w.available){
      qs('#weatherTemp').textContent='--°';
      qs('#weatherLabel').textContent='待預報';
      const icon=qs('#weatherIconWrap');
      if(icon) icon.innerHTML=iconSVG('weatherUnknown');
      return;
    }
    const noon=w.noon||w.hours?.[0];
    qs('#weatherTemp').textContent=`${Math.round(noon?.temp??w.max)}°`;
    qs('#weatherLabel').textContent=wmoLabel(noon?.code??3);
    const icon=qs('#weatherIconWrap');
    if(icon) icon.innerHTML=iconSVG(wmoType(noon?.code??3));
    qs('#todaySunrise').textContent=hhmm(w.sunrise);
    qs('#todaySunset').textContent=hhmm(w.sunset);
  }catch(err){
    if(selectedDay!==dayIndex) return;
    console.warn('Weather unavailable',err);
    qs('#weatherTemp').textContent='--°';
    qs('#weatherLabel').textContent='暫無資料';
    const icon=qs('#weatherIconWrap');
    if(icon) icon.innerHTML=iconSVG('weatherUnknown');
  }
}

function openMapsEvent(dayIndex,eventIndex){
  const e=TRIP.days[dayIndex]?.events[eventIndex];
  if(!e) return;
  const destination=e.navQuery||`${e.lat},${e.lng}`;
  const url=`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
  window.open(url,'_blank','noopener');
}

function initMap(){
  if(map) return;
  map=L.map('map',{zoomControl:false}).setView([64.1,-19.2],6);
  L.control.zoom({position:'bottomright'}).addTo(map);
  if(typeof L.maplibreGL==='function'){
    L.maplibreGL({style:'https://tiles.openfreemap.org/styles/liberty'}).addTo(map);
    map.attributionControl.addAttribution('OpenFreeMap &copy; OpenMapTiles &middot; Data from OpenStreetMap');
  }else{
    console.warn('MapLibre basemap bridge failed to load.');
    const notice=L.control({position:'topright'});
    notice.onAdd=()=>{const div=L.DomUtil.create('div','map-load-warning');div.textContent='底圖載入失敗，請確認網路後重新整理';return div;};
    notice.addTo(map);
  }
}

function markerIcon(label,car=false){
  const markerContent=car?iconSVG('car'):escapeHtml(label);
  return L.divIcon({className:'',html:`<div class="custom-marker ${car?'car':''}"><div></div><span>${markerContent}</span></div>`,iconSize:[34,42],iconAnchor:[17,38]});
}

function getRouteStops(d){
  const raw=d.events.filter(validCoord);
  const out=[];
  for(const e of raw){
    const last=out[out.length-1];
    if(!last||Math.abs(last.lat-e.lat)>1e-6||Math.abs(last.lng-e.lng)>1e-6) out.push(e);
  }
  return out;
}

async function fetchRoadRoute(stops){
  if(stops.length<2) return null;
  const coordString=stops.map(e=>`${e.lng},${e.lat}`).join(';');
  const url=`https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson&steps=false`;
  const res=await fetch(url,{mode:'cors'});
  if(!res.ok) throw new Error(`routing ${res.status}`);
  const json=await res.json();
  if(json.code!=='Ok'||!json.routes?.[0]) throw new Error(json.code||'No route');
  const route=json.routes[0];
  return {
    points:route.geometry.coordinates.map(([lng,lat])=>[lat,lng]),
    distanceKm:route.distance/1000,
    durationSec:route.duration,
    snapped:(json.waypoints||[]).map(w=>[w.location[1],w.location[0]])
  };
}

function routeCacheKey(dayIndex,stops){
  return `${dayIndex}:`+stops.map(e=>`${e.lat.toFixed(5)},${e.lng.toFixed(5)}`).join('|');
}

async function getRoadRouteForDay(dayIndex){
  const d=TRIP.days[dayIndex], stops=getRouteStops(d);
  if(stops.length<2) return null;
  const key=routeCacheKey(dayIndex,stops);
  if(roadRouteCache.has(key)) return roadRouteCache.get(key);
  const pending=fetchRoadRoute(stops).catch(err=>{roadRouteCache.delete(key);throw err});
  roadRouteCache.set(key,pending);
  return pending;
}

function formatDriveTime(durationSec){
  const mins=Math.round(durationSec/60), h=Math.floor(mins/60), m=mins%60;
  return h?`${h}h ${String(m).padStart(2,'0')}m`:`${m}m`;
}

async function refreshTodayRouteStats(dayIndex){
  if(!TRIP.days?.[dayIndex]) return;
  const token=++todayRouteToken;
  try{
    const road=await getRoadRouteForDay(dayIndex);
    if(token!==todayRouteToken||selectedDay!==dayIndex||!road) return;
    qs('#todayKm').textContent=`${road.distanceKm.toFixed(1)} km`;
    qs('#todayDrive').textContent=formatDriveTime(road.durationSec);
  }catch(err){
    console.warn('Today route stats unavailable; keeping itinerary values.',err);
  }
}

function haversineKm(a,b){
  const R=6371, toRad=x=>x*Math.PI/180;
  const dLat=toRad(b[0]-a[0]), dLng=toRad(b[1]-a[1]);
  const h=Math.sin(dLat/2)**2+Math.cos(toRad(a[0]))*Math.cos(toRad(b[0]))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

function setRouteGeometry(points,totalKm=null,stopPoints=[]){
  routeGeometry=points||[];
  routeCumulative=[];
  let total=0;
  for(let i=0;i<routeGeometry.length;i++){
    if(i) total+=haversineKm(routeGeometry[i-1],routeGeometry[i]);
    routeCumulative.push(total);
  }
  routeTotalKm=Number.isFinite(totalKm)?totalKm:total;
  routeStopFractions=[];
  const denom=routeCumulative[routeCumulative.length-1]||1;
  for(const stop of stopPoints){
    let best=0,bestDist=Infinity;
    for(let i=0;i<routeGeometry.length;i++){
      const dist=(routeGeometry[i][0]-stop[0])**2+(routeGeometry[i][1]-stop[1])**2;
      if(dist<bestDist){bestDist=dist;best=i}
    }
    routeStopFractions.push((routeCumulative[best]||0)/denom);
  }
}

function positionAlongRoute(t){
  if(!routeGeometry.length) return null;
  if(routeGeometry.length===1) return routeGeometry[0];
  const total=routeCumulative[routeCumulative.length-1]||0;
  if(!total) return routeGeometry[0];
  const target=Math.max(0,Math.min(1,t))*total;
  let lo=0,hi=routeCumulative.length-1;
  while(lo<hi){const mid=Math.floor((lo+hi)/2);if(routeCumulative[mid]<target)lo=mid+1;else hi=mid}
  const i=Math.max(1,lo), before=routeCumulative[i-1], after=routeCumulative[i];
  const f=after===before?0:(target-before)/(after-before);
  return [routeGeometry[i-1][0]+(routeGeometry[i][0]-routeGeometry[i-1][0])*f,routeGeometry[i-1][1]+(routeGeometry[i][1]-routeGeometry[i-1][1])*f];
}

function currentStopIndex(t,stops){
  if(!stops.length) return 0;
  if(routeStopFractions.length!==stops.length) return Math.min(stops.length-1,Math.round(t*(stops.length-1)));
  let idx=0;
  for(let i=0;i<routeStopFractions.length;i++) if(t+0.001>=routeStopFractions[i]) idx=i;
  return idx;
}

const MAP_ROUTE_COLORS=['#b59144','#3f7165','#a55b49','#64789a','#866899','#708d50','#bd7b45','#507486'];
function routeColor(dayIndex){return MAP_ROUTE_COLORS[dayIndex%MAP_ROUTE_COLORS.length]}
function parseDriveSeconds(value){
  const text=String(value||'');
  const h=Number((text.match(/(\d+)h/)||[])[1]||0);
  const m=Number((text.match(/(\d+)m/)||[])[1]||0);
  return h*3600+m*60;
}
function removeMapLayerSafe(layer){
  if(layer&&map&&map.hasLayer(layer)) map.removeLayer(layer);
}
function clearMapTripLayers(){
  clearRouteTimer();
  mapRouteLayers.forEach(removeMapLayerSafe);
  mapRouteLayers=[];
  removeMapLayerSafe(routeLine); routeLine=null;
  removeMapLayerSafe(routeCar); routeCar=null;
  if(map) map.eachLayer(l=>{if(l.options&&l.options.tripMarker)map.removeLayer(l)});
}
function selectionFallbackTotals(indices){
  return indices.reduce((acc,i)=>{
    const d=TRIP.days[i];
    acc.km+=Number(d.km)||0;
    acc.sec+=Number(d.driveMinutes)?Number(d.driveMinutes)*60:parseDriveSeconds(d.drive);
    return acc;
  },{km:0,sec:0});
}
function updateMapRangeText(indices,km,sec){
  const all=indices.length===TRIP.days.length;
  const hint=qs('#mapRangeHint');
  if(hint){
    if(all) hint.textContent='全部旅程';
    else if(indices.length>1) hint.textContent=indices.map(i=>TRIP.days[i].label).join(' · ');
    else if(mapMultiSelectMode) hint.textContent='複選模式：再點日期加入';
    else hint.textContent='點日期直接切換';
  }
  const summary=qs('#mapRangeSummary');
  if(summary) summary.textContent=`${indices.length} 天 · ${km.toFixed(1)} km · ${formatDriveTime(sec)}`;
}

async function renderMapDay(){
  if(!map) return;
  if(!TRIP.days?.length){
    qs('#mapDayLabel').textContent='—';
    qs('#mapDayName').textContent='尚未建立行程';
    qs('#routeStops').textContent='請先由 Owner / Editor 新增行程日。';
    return;
  }
  const token=++routeRenderToken;
  const indices=sortedMapDays().length?sortedMapDays():[selectedDay];
  const isMulti=indices.length>1;
  const singleIndex=indices[0];
  const singleDay=TRIP.days[singleIndex];
  const fallbackTotals=selectionFallbackTotals(indices);

  qs('#mapDayLabel').textContent=isMulti?`${indices.length}天`:singleDay.label;
  qs('#mapDayName').textContent=isMulti?(indices.length===TRIP.days.length?'全程路線':'多日路線'):singleDay.name;
  clearMapTripLayers();

  qs('#playRoute').disabled=isMulti;
  qs('#playRoute').textContent=isMulti?'多日總覽':'▶ 跟著走';
  qs('#routePanel').classList.toggle('multi-mode',isMulti);
  qs('#routeSlider').disabled=isMulti;
  qs('#routeSlider').value=0;
  qs('#routeDistance').textContent='0';
  qs('#routeDistanceSuffix').innerHTML=isMulti?' km':` / <span id="routeTotal">${Math.round(singleDay.km)}</span> km`;
  updateMapRangeText(indices,fallbackTotals.km,fallbackTotals.sec);
  routeGeometry=[]; routeCumulative=[]; routeStopFractions=[]; routeTotalKm=0;

  const bounds=L.latLngBounds([]);
  const fallbackLayers=new Map();

  indices.forEach(dayIndex=>{
    const d=TRIP.days[dayIndex];
    const allEvents=d.events.filter(validCoord);
    const stops=getRouteStops(d);
    allEvents.forEach((e,i)=>{
      const eventIndex=d.events.indexOf(e);
      const label=isMulti?`${dayIndex}·${i+1}`:`${i+1}`;
      const m=L.marker([e.lat,e.lng],{icon:markerIcon(label),tripMarker:true}).addTo(map);
      m.bindPopup(`<b>${d.label} · ${e.time||''} ${e.title}</b><br><span style="font-size:11px">${e.subtitle||''}</span><br><button class="popup-nav" onclick="openMapsEvent(${dayIndex},${eventIndex})">Google 導航</button>`);
      bounds.extend([e.lat,e.lng]);
    });
    const fallbackPoints=stops.map(e=>[e.lat,e.lng]);
    if(fallbackPoints.length){
      const layer=L.polyline(fallbackPoints,{color:routeColor(dayIndex),weight:isMulti?4:4,opacity:.58,dashArray:'8,7'}).addTo(map);
      fallbackLayers.set(dayIndex,layer);
      mapRouteLayers.push(layer);
      fallbackPoints.forEach(pt=>bounds.extend(pt));
      if(!isMulti){
        setRouteGeometry(fallbackPoints,d.km,fallbackPoints);
        routeCar=L.marker(fallbackPoints[0],{icon:markerIcon('',true),zIndexOffset:1000}).addTo(map);
      }
    }
  });

  if(bounds.isValid()) map.fitBounds(bounds,{padding:[28,28]});

  if(isMulti){
    qs('#routeCurrent').textContent=`已選 ${indices.length} 天`;
    qs('#routeMeta').textContent=indices.map(i=>TRIP.days[i].label).join(' · ');
    qs('#routeDistance').textContent=fallbackTotals.km.toFixed(1);
    qs('#routeStops').textContent=`合計估算 · ${fallbackTotals.km.toFixed(1)} km · ${formatDriveTime(fallbackTotals.sec)} · 正在更新道路路線…`;
  }else{
    qs('#routeStops').textContent='道路路線計算中…';
    updateRouteAt(0);
  }

  const results=[];
  for(const dayIndex of indices){
    if(token!==routeRenderToken) return;
    const d=TRIP.days[dayIndex];
    const stops=getRouteStops(d);
    try{
      const road=await getRoadRouteForDay(dayIndex);
      if(token!==routeRenderToken) return;
      results.push({dayIndex,road});
      const fallback=fallbackLayers.get(dayIndex);
      if(fallback){removeMapLayerSafe(fallback);mapRouteLayers=mapRouteLayers.filter(x=>x!==fallback)}
      const line=L.polyline(road.points,{color:routeColor(dayIndex),weight:isMulti?5:5,opacity:.95,lineCap:'round',lineJoin:'round'}).addTo(map);
      mapRouteLayers.push(line);
      road.points.forEach(pt=>bounds.extend(pt));
      if(!isMulti){
        routeLine=line;
        setRouteGeometry(road.points,road.distanceKm,road.snapped.length?road.snapped:stops.map(e=>[e.lat,e.lng]));
        qs('#routeTotal').textContent=Math.round(routeTotalKm);
        qs('#routeStops').textContent=`道路路線 · 約 ${routeTotalKm.toFixed(1)} km · ${formatDriveTime(road.durationSec)} · `+stops.map(e=>e.title.split('\n')[0]).join(' · ');
        updateRouteAt(+qs('#routeSlider').value);
      }
    }catch(err){
      console.warn(`Road routing unavailable for ${d.label}; keeping fallback.`,err);
      results.push({dayIndex,road:null});
    }
  }

  if(token!==routeRenderToken) return;
  if(bounds.isValid()) map.fitBounds(bounds,{padding:[28,28]});

  if(isMulti){
    let totalKm=0,totalSec=0;
    for(const {dayIndex,road} of results){
      if(road){totalKm+=road.distanceKm;totalSec+=road.durationSec}
      else{totalKm+=Number(TRIP.days[dayIndex].km)||0;totalSec+=parseDriveSeconds(TRIP.days[dayIndex].drive)}
    }
    qs('#routeDistance').textContent=totalKm.toFixed(1);
    qs('#routeStops').textContent=`${indices.length} 天合計 · 約 ${totalKm.toFixed(1)} km · ${formatDriveTime(totalSec)} · `+indices.map(i=>TRIP.days[i].label).join(' + ');
    updateMapRangeText(indices,totalKm,totalSec);
  }else if(!results[0]?.road){
    const d=singleDay,stops=getRouteStops(d);
    qs('#routeStops').textContent='道路路線暫時無法取得 · 已顯示離線備援線 · '+stops.map(e=>e.title.split('\n')[0]).join(' · ');
  }
}

function updateRouteAt(v){
  const indices=sortedMapDays();
  if(indices.length!==1||!map||!routeGeometry.length||!routeCar) return;
  const d=TRIP.days[indices[0]], stops=getRouteStops(d), t=v/100, pos=positionAlongRoute(t);
  if(pos) routeCar.setLatLng(pos);
  const idx=currentStopIndex(t,stops), stop=stops[idx]||stops[0];
  qs('#routeCurrent').textContent=stop?stop.title.split('\n')[0]:d.name;
  qs('#routeMeta').textContent=`${d.label} · ${stop?.time||''}`;
  qs('#routeDistance').textContent=(routeTotalKm*t<10?(routeTotalKm*t).toFixed(1):Math.round(routeTotalKm*t));
  qs('#routeSlider').value=v;
}

function clearRouteTimer(){
  if(routeTimer){clearInterval(routeTimer);routeTimer=null}
  qs('#routePlayCircle').textContent='▶';
  qs('#playRoute').textContent='▶ 跟著走';
}

function togglePlay(){
  if(sortedMapDays().length!==1) return;
  if(routeTimer){clearRouteTimer();return}
  let v=+qs('#routeSlider').value;
  if(v>=100)v=0;
  qs('#routePlayCircle').textContent='Ⅱ';
  qs('#playRoute').textContent='Ⅱ 暫停';
  routeTimer=setInterval(()=>{v+=0.5;if(v>100){updateRouteAt(100);clearRouteTimer();return}updateRouteAt(v)},55);
}

function bookingDetailHtml(b,idx){
  const d=b.details||{};
  const rows=(d.rows||[]).map(([label,value])=>`<div class="booking-detail-row"><span>${label}</span><strong>${value}</strong></div>`).join('');
  const amenities=(d.amenities||[]).length?`<div class="booking-detail-section"><div class="booking-detail-label">設備／包含</div><div class="amenity-chips">${d.amenities.map(x=>`<span>${x}</span>`).join('')}</div></div>`:'';
  const tips=(d.tips||[]).length?`<div class="booking-detail-section"><div class="booking-detail-label warn">注意事項</div><ul class="booking-tip-list">${d.tips.map(x=>`<li>${x}</li>`).join('')}</ul></div>`:'';
  const source=d.source?`<div class="booking-detail-source">資料來源：${d.source}</div>`:'';
  return `<div class="booking-detail-panel" id="booking-detail-${idx}" hidden><div class="booking-detail-grid">${rows}</div>${amenities}${tips}${source}</div>`;
}

function renderBookings(){
  const filters=[['all','全部'],['stay','住宿'],['flight','航班'],['car','租車'],['tour','Tour']];
  qs('#bookingFilters').innerHTML=filters.map(([k,n])=>`<button class="filter-btn ${currentFilter===k?'active':''}" data-filter="${k}">${n}</button>`).join('');
  qsa('[data-filter]').forEach(b=>b.onclick=()=>{currentFilter=b.dataset.filter;renderBookings()});
  const list=TRIP.bookings.map((b,idx)=>({b,idx})).filter(({b})=>currentFilter==='all'||b.type===currentFilter);
  qs('#bookingList').innerHTML=list.map(({b,idx})=>`<article class="booking-card expandable-booking"><div class="booking-top"><div class="booking-icon" data-booking-type="${b.type}"></div><div><div class="booking-provider">${b.provider}</div><h3>${b.title}</h3><div class="booking-dates">${b.dates}</div></div><div class="code-pill">${b.status==='confirmed'?'CONFIRMED':'PLAN'}</div></div><div class="booking-meta">${b.meta}</div><div class="booking-code"><div><small>CONFIRMATION${b.secret?' / PIN':''}</small><strong id="code-${idx}">${maskCode(b.code,b.secret)}</strong></div><button class="reveal-btn" onclick="event.stopPropagation();toggleCode(${idx},'${b.code}','${b.secret||''}')">顯示</button></div>${b.alert?`<div class="alert-box">⚠️ ${b.alert}</div>`:''}<div class="notice">${b.notice}</div>${b.details?`<button class="booking-detail-toggle" id="booking-toggle-${idx}" onclick="event.stopPropagation();toggleBookingDetails(${idx})"><span>查看完整預訂細節</span><span class="detail-chevron">⌄</span></button>${bookingDetailHtml(b,idx)}`:''}</article>`).join('');
  renderBookingIcons();
  decorateBookingEditor(list);
  qsa('.expandable-booking').forEach((card,visualIndex)=>{
    const item=list[visualIndex];
    if(!item?.b?.details)return;
    card.addEventListener('click',e=>{
      if(e.target.closest('button'))return;
      toggleBookingDetails(item.idx);
    });
  });
}

function toggleBookingDetails(idx){
  const panel=qs('#booking-detail-'+idx),btn=qs('#booking-toggle-'+idx);
  if(!panel||!btn)return;
  const willOpen=panel.hidden;
  panel.hidden=!willOpen;
  btn.classList.toggle('open',willOpen);
  btn.querySelector('span:first-child').textContent=willOpen?'收起預訂細節':'查看完整預訂細節';
}

function maskCode(code,secret){if(!code)return '—';return secret?`${code} · PIN ••••`:`${code.length>4?'••••'+code.slice(-4):code}`}
function toggleCode(i,code,secret){const el=qs('#code-'+i);const masked=maskCode(code,secret);el.textContent=el.textContent===masked?(secret?`${code} · PIN ${secret}`:code):masked}

function weatherLocationForDay(dayIndex){
  const d=TRIP.days?.[dayIndex];
  if(!d) return null;
  const fallback=(d.events||[]).find(validCoord);
  return WEATHER_LOCATIONS[d.label]||(fallback?{name:d.name||d.label,lat:fallback.lat,lng:fallback.lng}:null);
}

function weatherSourceLinks(dayIndex){
  const d=TRIP.days?.[dayIndex];
  const loc=weatherLocationForDay(dayIndex);
  if(!d||!loc) return {openMeteo:'#',google:'#',locationName:d?.name||'weather'};
  const api=new URL('https://api.open-meteo.com/v1/forecast');
  api.searchParams.set('latitude',loc.lat);
  api.searchParams.set('longitude',loc.lng);
  api.searchParams.set('hourly','temperature_2m,apparent_temperature,precipitation_probability,weather_code,wind_speed_10m');
  api.searchParams.set('daily','sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_probability_max');
  api.searchParams.set('timezone',TRIP.timezone||'UTC');
  api.searchParams.set('wind_speed_unit','ms');
  api.searchParams.set('forecast_days','16');
  const google='https://www.google.com/search?q='+encodeURIComponent((loc.name||d.name||'')+' weather');
  return {openMeteo:api.toString(),google,locationName:loc.name||d.name||'weather'};
}

function renderWeatherSources(dayIndex){
  const host=qs('#weatherSources');
  if(!host) return;
  const links=weatherSourceLinks(dayIndex);
  const demoNote=demoMode?'<p class="weather-source-note">目前為 DEMO 示意資料，不代表 Open-Meteo 或 Google 的實際預報。</p>':'';
  host.innerHTML=`${demoNote}<div class="weather-source-actions">
    <a class="weather-source-btn" href="${links.openMeteo}" target="_blank" rel="noopener">Open-Meteo 原始預報 ↗</a>
    <a class="weather-source-btn" href="${links.google}" target="_blank" rel="noopener">Google 天氣 ↗</a>
  </div>`;
}

async function renderWeatherSheet(){
  const dayIndex=selectedDay;
  const d=TRIP.days[dayIndex];
  const loc=weatherLocationForDay(dayIndex);
  qs('#weatherSheetTitle').textContent=`${d.label} · ${d.name}`;
  renderWeatherSources(dayIndex);
  qs('#weatherSheetSubtitle').textContent=`${loc?.name||'今日路線'} · ${demoMode?'DEMO 示意預報':'Open-Meteo 真實預報'}`;
  qs('#weatherSummary').innerHTML=`<div class="weather-loading">正在讀取天氣資料…</div>`;
  qs('#weatherHourly').innerHTML='';
  try{
    const w=demoMode?demoWeatherForDay(dayIndex):await fetchWeatherForDay(dayIndex);
    if(selectedDay!==dayIndex) return;
    if(!w.available){
      qs('#weatherSheetSubtitle').textContent=`${loc.name} · 尚未進入可預報範圍`;
      qs('#weatherSummary').innerHTML=`
        <div class="weather-unavailable">
          <strong>目前還沒有這一天的真實預報</strong>
          <p>Open-Meteo 最長提供 16 天預報。${d.short} 的逐小時預報預計從 <b>${zhDate(w.availableFrom)}</b> 起開始出現；到時重新打開 App 就會自動抓最新資料。</p>
        </div>`;
      qs('#weatherHourly').innerHTML='';
      return;
    }
    qs('#weatherSheetSubtitle').textContent=`${loc.name} · ${wmoLabel(w.noon?.code??3)} · ${w.demo?'DEMO 示意資料':'真實資料'}`;
    qs('#weatherSummary').innerHTML=`
      <div class="weather-summary-card"><small>最高 / 最低</small><strong>${Math.round(w.max)}° / ${Math.round(w.min)}°</strong></div>
      <div class="weather-summary-card"><small>最高降雨機率</small><strong>${Math.round(w.rainMax)}%</strong></div>
      <div class="weather-summary-card"><small>最大風速</small><strong>${w.maxWind.toFixed(1)} m/s</strong></div>
    `;
    qs('#weatherHourly').innerHTML=w.hours.map(h=>`<div class="weather-row"><div class="time">${h.time}</div><div class="temp"><span class="mini-weather-icon">${iconSVG(wmoType(h.code))}</span>${Math.round(h.temp)}° <small>體感 ${Math.round(h.feels)}°</small></div><div class="rain"><span class="mini-weather-icon">${iconSVG('drop')}</span>${Math.round(h.rain)}%</div><div class="wind"><span class="mini-weather-icon">${iconSVG('wind')}</span>${Number(h.wind).toFixed(1)} m/s</div></div>`).join('');
  }catch(err){
    console.warn('Weather sheet unavailable',err);
    qs('#weatherSheetSubtitle').textContent=`${loc?.name||'今日路線'} · 天氣服務暫時無法連線`;
    qs('#weatherSummary').innerHTML=`<div class="weather-unavailable"><strong>暫時無法取得天氣資料</strong><p>請確認網路後再試一次。</p></div>`;
    qs('#weatherHourly').innerHTML='';
  }
}

function openWeatherSheet(){
  qs('#weatherBackdrop').classList.add('show');
  qs('#weatherSheet').classList.add('show');
  qs('#weatherSheet').setAttribute('aria-hidden','false');
  renderWeatherSheet();
}

function closeWeatherSheet(){
  qs('#weatherBackdrop').classList.remove('show');
  qs('#weatherSheet').classList.remove('show');
  qs('#weatherSheet').setAttribute('aria-hidden','true');
}

// v0.13 — Today Hero becomes the page header. At the top it is the full photo
// card; while scrolling it smoothly collapses to a compact cream header that
// keeps only ICELAND · 2026 / 今天 / menu.
function updateHeroCollapse(){
  const hero=qs('#heroCard');
  const today=qs('#todayView');
  if(!hero||!today||!today.classList.contains('active')) return;
  const y=Math.max(0,window.scrollY||document.documentElement.scrollTop||0);
  const collapseDistance=230;
  const progress=Math.min(1,y/collapseDistance);
  hero.style.setProperty('--hero-progress',String(progress));
  hero.classList.toggle('hero-compact',progress>0.82);
}

let heroScrollRAF=0;
window.addEventListener('scroll',()=>{
  if(heroScrollRAF) return;
  heroScrollRAF=requestAnimationFrame(()=>{
    heroScrollRAF=0;
    updateHeroCollapse();
  });
},{passive:true});
window.addEventListener('resize',updateHeroCollapse,{passive:true});

function updateDemoModeUI(){
  const btn=qs('#demoModeToggle');
  const state=qs('#demoModeState');
  const badge=qs('#heroDemoBadge');
  if(btn){
    btn.classList.toggle('active',demoMode);
    btn.setAttribute('aria-pressed',String(demoMode));
  }
  const isIceland=window.TRAVEL_CONFIG?.tripSlug==='iceland-2026';
  if(btn) btn.hidden=!isIceland;
  if(!isIceland&&demoMode){demoMode=false;try{localStorage.setItem('icelandDemoMode','0')}catch(_){}}
  if(state) state.textContent=demoMode?'開啟 · 11/23':'關閉';
  if(badge) badge.hidden=!demoMode||!isIceland;
}

function toggleDemoMode(){
  demoMode=!demoMode;
  try{localStorage.setItem('icelandDemoMode',demoMode?'1':'0')}catch(_){}
  if(demoMode){
    syncToReferenceTripDay(true);
  }else{
    syncToReferenceTripDay(false);
  }
  updateDemoModeUI();
  renderAll();
  requestAnimationFrame(updateHeroCollapse);
}

function renderAll(){
  renderDayStrip();
  renderStaticIcons();
  renderToday();
  renderBookings();
  renderBottomNavIcons();
  if(map)renderMapDay();
}

qsa('.nav-item[data-target]').forEach(b=>b.onclick=()=>showView(b.dataset.target));
qsa('[data-nav]').forEach(b=>b.onclick=()=>showView(b.dataset.nav));
qs('#routeSlider').oninput=e=>{clearRouteTimer();updateRouteAt(+e.target.value)};
qs('#routePlayCircle').onclick=togglePlay;
qs('#playRoute').onclick=togglePlay;
qs('#mapMultiToggle').onclick=toggleMapMultiMode;
const openTripSheet=()=>{qs('#tripSheet').classList.add('show');qs('#sheetBackdrop').classList.add('show')};
qs('#tripMenuBtn').onclick=openTripSheet;
qs('#heroMenuBtn').onclick=openTripSheet;
qsa('.subview-menu-btn').forEach(btn=>btn.onclick=openTripSheet);
function closeSheet(){qs('#tripSheet').classList.remove('show');qs('#sheetBackdrop').classList.remove('show')}
qs('#closeSheet').onclick=closeSheet;
qs('#sheetBackdrop').onclick=closeSheet;
qs('#weatherBtn').onclick=openWeatherSheet;
qs('#closeWeather').onclick=closeWeatherSheet;
qs('#weatherBackdrop').onclick=closeWeatherSheet;
qs('#demoModeToggle').onclick=toggleDemoMode;
if(qs('#newTripBtn')) qs('#newTripBtn').onclick=createNewTrip;
if(qs('#chooserSignOut')) qs('#chooserSignOut').onclick=()=>window.TravelAuth?.signOut?.().then(()=>location.reload());
if(qs('#heroTripSwitch')) qs('#heroTripSwitch').onclick=async e=>{e.stopPropagation();openTripSheet();await renderTripSwitchList();};

function setAuthGateState(state){
  const msg=qs('#authMessage'), foot=qs('#authFoot'), btn=qs('#magicLinkBtn');
  if(btn) btn.disabled=state==='sending_link'||state==='loading'||state==='registering_device';
  if(state==='link_sent'){
    if(msg) msg.textContent='登入連結已寄出，請到 Gmail 點一下 Magic Link。';
    if(foot) foot.textContent='點開後會回到 Travel OS，並把這支裝置記為 Trusted Device。';
  }else if(state==='device_error'){
    if(msg) msg.textContent='帳號已登入，但這支裝置尚未完成授權。請保持連線後重試。';
  }else if(state==='signed_out'){
    if(msg) msg.textContent='私人旅程需要驗證此裝置。第一次登入後，這支裝置會被記住。';
  }
}

function normalizeReservation(row){
  if(row?.type&&row?.provider&&row?.title) return row;
  const d=row?.details&&typeof row.details==='object'?row.details:{};
  const nested=d.details&&typeof d.details==='object'?d.details:d;
  const rows=Array.isArray(nested.rows)?[...nested.rows]:[];
  if(row?.public_price_text&&!rows.some(x=>Array.isArray(x)&&String(x[0]).includes('費用'))) rows.push(['費用',row.public_price_text]);
  if(row?.cancellation_policy&&!rows.some(x=>Array.isArray(x)&&String(x[0]).includes('取消'))) rows.push(['取消條款',row.cancellation_policy]);
  return {
    id:row?.id,
    version:row?.version||1,
    type:d.type||row?.reservation_type||'other',
    provider:d.provider||row?.provider||'',
    title:d.title||row?.title||'預訂',
    dates:d.dates||row?.public_summary||'',
    meta:d.meta||row?.location_name||row?.public_summary||'',
    code:row?.confirmation_code||d.code||'',
    secret:row?.pin_code||d.secret||'',
    status:d.status||row?.status||'confirmed',
    alert:d.alert||'',
    notice:d.notice||row?.private_notes||'',
    details:{
      rows,
      amenities:Array.isArray(nested.amenities)?nested.amenities:[],
      tips:Array.isArray(nested.tips)?nested.tips:[],
      source:nested.source||d.source||row?.source_type||'Supabase 私人預訂資料'
    },
    _raw:row
  };
}

function cloudTripToUi(data){
  const days=(data.days||[]).map(day=>({
    ...day,
    drive:driveText(day),
    events:(day.events||[]).map(e=>({...e}))
  }));
  return {
    id:data.trip?.id,
    slug:data.trip?.slug,
    title:data.trip?.title||'Travel OS',
    timezone:data.trip?.timezone||'UTC',
    startDate:data.trip?.startDate,
    endDate:data.trip?.endDate,
    version:data.trip?.version||1,
    role:data.role||'viewer',
    days,
    bookings:(data.reservations||[]).map(normalizeReservation)
  };
}

async function hydratePrivateCloudData(){
  const client=window.TravelAuth?.getClient?.();
  const user=window.TravelAuth?.snapshot?.().user;
  if(!client||!user||!window.TRAVEL_CONFIG?.tripSlug||!navigator.onLine) return;
  try{
    const device=await window.TravelStore.getDevice();
    const {data,error}=await client.functions.invoke('travel-data',{body:{
      tripSlug:window.TRAVEL_CONFIG.tripSlug,
      devicePublicId:device.device_public_id,
      deviceSecret:device.device_secret
    }});
    if(error) throw error;
    if(data?.error) throw new Error(data.error);
    const normalized=cloudTripToUi(data);
    currentTripRole=normalized.role||'viewer';
    TRIP=normalized;
    cloudLoaded=true;
    selectedDay=Math.min(selectedDay,Math.max(0,TRIP.days.length-1));
    mapPrimaryDay=selectedDay;
    mapSelectedDays=new Set(TRIP.days.length?[selectedDay]:[]);
    await window.TravelStore?.replaceTrip?.({...data,bookings:normalized.bookings});
    syncTripLabels();
    updateDemoModeUI();
    renderAll();
    updateEditAvailability();
  }catch(err){
    console.warn('Cloud trip data unavailable; using trusted local cache.',err);
    try{
      const cached=await window.TravelStore?.getTrip?.();
      if(cached?.days?.length){
        TRIP=cached;
        currentTripRole=cached.role||'viewer';
        syncTripLabels();
        renderAll();
        updateEditAvailability();
      }
    }catch(_){}
  }
}

function tripHref(slug){
  return `${window.TRAVEL_CONFIG?.appBasePath||'/travel-os/'}?trip=${encodeURIComponent(slug)}`;
}

async function fetchAuthorizedTrips(){
  const client=window.TravelAuth?.getClient?.();
  if(!client) return [];
  const {data,error}=await client.functions.invoke('travel-trips',{body:{action:'list'}});
  if(error) throw error;
  authorizedTrips=Array.isArray(data?.trips)?data.trips:[];
  return authorizedTrips;
}

async function renderTripChooser(){
  const chooser=qs('#tripChooser'),shell=qs('.app-shell');
  if(!chooser)return;
  chooser.hidden=false;
  if(shell)shell.hidden=true;
  const list=qs('#tripList'),status=qs('#chooserStatus');
  status.textContent='讀取旅程中…';
  try{
    const trips=await fetchAuthorizedTrips();
    list.innerHTML=trips.length?trips.map(t=>`<button class="trip-choice" data-trip-slug="${escapeHtml(t.slug)}"><div><h2>${escapeHtml(t.title)}</h2><p>${escapeHtml(t.start_date||'')} ${t.end_date?'→ '+escapeHtml(t.end_date):''}</p></div><span class="trip-role">${escapeHtml(t.role||'viewer')}</span></button>`).join(''):`<div class="booking-empty">目前沒有可使用的旅程。</div>`;
    list.querySelectorAll('[data-trip-slug]').forEach(btn=>btn.onclick=()=>{location.href=tripHref(btn.dataset.tripSlug)});
    const canCreate=trips.some(t=>t.role==='owner');
    const newBtn=qs('#newTripBtn');if(newBtn)newBtn.hidden=!canCreate;
    status.textContent='';
  }catch(err){
    console.warn(err);status.textContent='無法讀取旅程清單。';
  }
}

async function createNewTrip(){
  const title=prompt('新旅程名稱，例如 Kumamoto 2027');
  if(!title)return;
  const suggested=title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'new-trip';
  const slug=prompt('網址名稱（英文/數字/連字號）',suggested);
  if(!slug)return;
  const startDate=prompt('開始日期 YYYY-MM-DD（可留空）','')||null;
  const endDate=prompt('結束日期 YYYY-MM-DD（可留空）','')||null;
  const device=await window.TravelStore.getDevice();
  const client=window.TravelAuth?.getClient?.();
  const {data,error}=await client.functions.invoke('travel-trips',{body:{
    action:'create',title,slug,startDate,endDate,timezone:'UTC',
    devicePublicId:device.device_public_id,deviceSecret:device.device_secret,deviceName:device.label
  }});
  if(error||data?.error){alert('建立旅程失敗：'+(data?.error||error?.message||'unknown'));return;}
  location.href=tripHref(data.trip.slug);
}

async function renderTripSwitchList(){
  let host=qs('#tripSwitchList');
  if(!host){
    host=document.createElement('div');host.id='tripSwitchList';host.className='trip-switch-list';
    qs('#tripSheet')?.append(host);
  }
  host.innerHTML='<p class="member-status">讀取旅程中…</p>';
  try{
    const trips=await fetchAuthorizedTrips();
    host.innerHTML='<div class="section-kicker">SWITCH TRIP</div>'+trips.map(t=>`<button class="sheet-action-card" data-switch-trip="${escapeHtml(t.slug)}"><span><small>${escapeHtml(String(t.role||'viewer').toUpperCase())}</small><strong>${escapeHtml(t.title)}</strong></span><span>${t.slug===window.TRAVEL_CONFIG.tripSlug?'✓':'→'}</span></button>`).join('');
    host.querySelectorAll('[data-switch-trip]').forEach(btn=>btn.onclick=()=>{if(btn.dataset.switchTrip!==window.TRAVEL_CONFIG.tripSlug)location.href=tripHref(btn.dataset.switchTrip)});
  }catch(err){host.innerHTML='<p class="member-status">無法讀取旅程清單。</p>'}
}


async function travelEditor(action,payload={}){
  const client=window.TravelAuth?.getClient?.();
  if(!client) throw new Error('auth_not_ready');
  const device=await window.TravelStore.getDevice();
  const {data,error}=await client.functions.invoke('travel-editor',{body:{
    tripSlug:window.TRAVEL_CONFIG.tripSlug,
    devicePublicId:device.device_public_id,
    deviceSecret:device.device_secret,
    action,...payload
  }});
  if(error) throw error;
  if(data?.error){
    const e=new Error(data.error);e.code=data.error;e.currentVersion=data.currentVersion;throw e;
  }
  return data;
}

function canEditTrip(){return currentTripRole==='owner'||currentTripRole==='editor'}

function updateEditAvailability(){
  let btn=qs('#editModeBtn');
  if(!btn&&qs('#membersBtn')){
    btn=document.createElement('button');
    btn.id='editModeBtn';btn.type='button';btn.className='sheet-action-card';
    btn.innerHTML='<span><small>ITINERARY</small><strong>編輯行程</strong></span><span>→</span>';
    qs('#membersBtn').before(btn);
    btn.onclick=()=>{closeSheet();toggleEditMode();};
  }
  if(btn) btn.hidden=!canEditTrip();
  syncTripLabels();
}

function toggleEditMode(force){
  if(!canEditTrip())return;
  editMode=typeof force==='boolean'?force:!editMode;
  renderAll();
}

function decorateTimelineEditor(){
  const today=qs('#todayView');
  if(!today)return;
  let banner=qs('#editModeBanner');
  if(editMode&&canEditTrip()){
    if(!banner){
      banner=document.createElement('div');banner.id='editModeBanner';banner.className='edit-mode-banner';
      qs('#dayStrip')?.before(banner);
    }
    banner.innerHTML='<span>編輯模式 · '+escapeHtml(String(currentTripRole).toUpperCase())+'</span><span><button class="edit-chip" id="editDayBtn">編輯本日</button> <button class="edit-chip" id="addItemBtn">＋ 新增</button> <button class="edit-chip" id="doneEditBtn">完成</button></span>';
    qs('#editDayBtn').onclick=editCurrentDay;
    qs('#addItemBtn').onclick=()=>openItemEditor(selectedDay,null);
    qs('#doneEditBtn').onclick=()=>toggleEditMode(false);
    qsa('#timeline .timeline-card').forEach((card,eventIndex)=>{
      const actions=document.createElement('div');actions.className='edit-inline-actions';
      const edit=document.createElement('button');edit.className='edit-chip';edit.textContent='✎ 編輯';edit.onclick=e=>{e.stopPropagation();openItemEditor(selectedDay,eventIndex)};
      const up=document.createElement('button');up.className='edit-chip';up.textContent='↑';up.disabled=eventIndex===0;up.onclick=e=>{e.stopPropagation();moveItem(selectedDay,eventIndex,-1)};
      const down=document.createElement('button');down.className='edit-chip';down.textContent='↓';down.disabled=eventIndex===currentDay().events.length-1;down.onclick=e=>{e.stopPropagation();moveItem(selectedDay,eventIndex,1)};
      actions.append(edit,up,down);card.append(actions);
    });
  }else if(banner){banner.remove();}
}

function ensureItemEditor(){
  let sheet=qs('#itemEditSheet');
  if(sheet)return sheet;
  const backdrop=document.createElement('div');backdrop.className='modal-backdrop';backdrop.id='itemEditBackdrop';
  sheet=document.createElement('aside');sheet.className='edit-sheet';sheet.id='itemEditSheet';sheet.setAttribute('aria-hidden','true');
  sheet.innerHTML=`
    <div class="sheet-handle"></div>
    <div class="sheet-title"><div><span class="section-kicker">ITINERARY EDITOR</span><h2 id="itemEditTitle">新增行程</h2></div><button class="round-btn" id="closeItemEdit">×</button></div>
    <form class="edit-form" id="itemEditForm">
      <input type="hidden" id="editItemId"><input type="hidden" id="editItemVersion">
      <div class="edit-form-grid">
        <label><span>日期</span><select id="editItemDay"></select></label>
        <label><span>時間</span><input id="editItemTime" type="time"></label>
      </div>
      <div class="edit-form-grid">
        <label><span>類型</span><select id="editItemType"><option value="spot">景點</option><option value="drive">移動</option><option value="stay">住宿</option><option value="food">餐食</option><option value="tour">Tour</option><option value="flight">航班</option><option value="car">租車</option><option value="shop">補給</option><option value="plan">備案</option><option value="other">其他</option></select></label>
        <label><span>名稱</span><input id="editItemName" required></label>
      </div>
      <label><span>副標題</span><input id="editItemSubtitle"></label>
      <label><span>備註</span><textarea id="editItemNote"></textarea></label>
      <label><span>景點介紹</span><textarea id="editItemIntro"></textarea></label>
      <label><span>注意事項（每行一項）</span><textarea id="editItemTips"></textarea></label>
      <div class="edit-form-grid">
        <label><span>Latitude</span><input id="editItemLat" type="number" step="any"></label>
        <label><span>Longitude</span><input id="editItemLng" type="number" step="any"></label>
      </div>
      <label><span>導航搜尋（可留空）</span><input id="editItemNav"></label>
      <div class="edit-form-actions"><button type="button" class="edit-delete" id="deleteItemBtn">刪除</button><button type="submit" class="edit-save">儲存</button></div>
      <p class="edit-status" id="itemEditStatus"></p>
    </form>`;
  document.body.append(backdrop,sheet);
  const close=()=>{sheet.classList.remove('show');backdrop.classList.remove('show');sheet.setAttribute('aria-hidden','true')};
  qs('#closeItemEdit').onclick=close;backdrop.onclick=close;
  qs('#itemEditForm').onsubmit=saveItemEditor;
  qs('#deleteItemBtn').onclick=deleteCurrentItem;
  return sheet;
}

function openItemEditor(dayIndex,eventIndex){
  if(!canEditTrip())return;
  const sheet=ensureItemEditor(),event=eventIndex===null?null:TRIP.days[dayIndex]?.events?.[eventIndex];
  qs('#itemEditTitle').textContent=event?'編輯行程':'新增行程';
  qs('#editItemDay').innerHTML=TRIP.days.map((d,i)=>`<option value="${i}">${escapeHtml(d.label)} · ${escapeHtml(d.date)} · ${escapeHtml(d.name)}</option>`).join('');
  qs('#editItemDay').value=String(dayIndex);
  qs('#editItemId').value=event?.id||'';
  qs('#editItemVersion').value=event?.version||'';
  qs('#editItemTime').value=event?.time||'';
  qs('#editItemType').value=event?.type||'spot';
  qs('#editItemName').value=event?.title||'';
  qs('#editItemSubtitle').value=event?.subtitle||'';
  qs('#editItemNote').value=event?.note||'';
  qs('#editItemIntro').value=event?.details?.intro||'';
  qs('#editItemTips').value=(event?.details?.tips||[]).join('\n');
  qs('#editItemLat').value=Number.isFinite(event?.lat)?event.lat:'';
  qs('#editItemLng').value=Number.isFinite(event?.lng)?event.lng:'';
  qs('#editItemNav').value=event?.navQuery||'';
  qs('#deleteItemBtn').hidden=!event;
  qs('#itemEditStatus').textContent='';
  qs('#itemEditBackdrop').classList.add('show');sheet.classList.add('show');sheet.setAttribute('aria-hidden','false');
}

async function saveItemEditor(e){
  e.preventDefault();
  const dayIndex=Number(qs('#editItemDay').value),day=TRIP.days[dayIndex];
  const item={
    id:qs('#editItemId').value||null,baseVersion:Number(qs('#editItemVersion').value)||0,dayId:day.id,
    time:qs('#editItemTime').value,type:qs('#editItemType').value,title:qs('#editItemName').value.trim(),
    subtitle:qs('#editItemSubtitle').value.trim(),note:qs('#editItemNote').value.trim(),intro:qs('#editItemIntro').value.trim(),
    tips:qs('#editItemTips').value.split('\n').map(x=>x.trim()).filter(Boolean),
    lat:qs('#editItemLat').value===''?null:Number(qs('#editItemLat').value),
    lng:qs('#editItemLng').value===''?null:Number(qs('#editItemLng').value),navQuery:qs('#editItemNav').value.trim()
  };
  qs('#itemEditStatus').textContent='儲存中…';
  try{
    await travelEditor('save_item',{item});
    qs('#itemEditSheet').classList.remove('show');qs('#itemEditBackdrop').classList.remove('show');
    selectedDay=dayIndex;await hydratePrivateCloudData();
  }catch(err){
    qs('#itemEditStatus').textContent=err.code==='version_conflict'?'資料已被其他人更新，正在重新載入…':'儲存失敗：'+err.message;
    if(err.code==='version_conflict')await hydratePrivateCloudData();
  }
}

async function deleteCurrentItem(){
  const id=qs('#editItemId').value;if(!id)return;
  if(!confirm('刪除這筆行程？'))return;
  qs('#itemEditStatus').textContent='刪除中…';
  try{
    await travelEditor('delete_item',{id,baseVersion:Number(qs('#editItemVersion').value)||0});
    qs('#itemEditSheet').classList.remove('show');qs('#itemEditBackdrop').classList.remove('show');
    await hydratePrivateCloudData();
  }catch(err){qs('#itemEditStatus').textContent='刪除失敗：'+err.message}
}

async function moveItem(dayIndex,eventIndex,delta){
  const day=TRIP.days[dayIndex],target=eventIndex+delta;
  if(!day?.id||target<0||target>=day.events.length)return;
  const ids=day.events.map(e=>e.id);
  if(ids.some(id=>!id))return;
  [ids[eventIndex],ids[target]]=[ids[target],ids[eventIndex]];
  try{await travelEditor('reorder_items',{dayId:day.id,orderedIds:ids});await hydratePrivateCloudData()}catch(err){alert('排序失敗：'+err.message)}
}

async function editCurrentDay(){
  const d=currentDay();if(!d?.id)return;
  const name=prompt('當日標題',d.name);if(name===null)return;
  const date=prompt('日期 YYYY-MM-DD',d.date);if(date===null)return;
  const short=prompt('摘要 / 路線',d.short||'');if(short===null)return;
  try{
    await travelEditor('save_day',{day:{id:d.id,baseVersion:d.version,date,label:d.label,name,short,heroImageUrl:d.heroImageUrl,km:d.km,driveMinutes:d.driveMinutes,sunrise:d.sunrise,sunset:d.sunset}});
    await hydratePrivateCloudData();
  }catch(err){alert(err.code==='version_conflict'?'本日資料已被其他人更新，請再試一次。':'更新失敗：'+err.message)}
}

function decorateBookingEditor(list){
  const existingAdd=qs('#addBookingBtn');
  if(!editMode||!canEditTrip()){if(existingAdd)existingAdd.remove();return;}
  const summary=qs('.booking-summary');
  if(summary&&!qs('#addBookingBtn')){
    const btn=document.createElement('button');btn.id='addBookingBtn';btn.className='edit-chip';btn.textContent='＋ 新增預訂';btn.onclick=()=>openBookingEditor(null);summary.append(btn);
  }
  qsa('.booking-card').forEach((card,visualIndex)=>{
    const item=list[visualIndex];if(!item)return;
    const actions=document.createElement('div');actions.className='edit-inline-actions';
    const edit=document.createElement('button');edit.className='edit-chip';edit.textContent='✎ 編輯預訂';edit.onclick=e=>{e.stopPropagation();openBookingEditor(item.idx)};
    actions.append(edit);card.append(actions);
  });
}

function ensureBookingEditor(){
  let sheet=qs('#bookingEditSheet');if(sheet)return sheet;
  const backdrop=document.createElement('div');backdrop.className='modal-backdrop';backdrop.id='bookingEditBackdrop';
  sheet=document.createElement('aside');sheet.className='edit-sheet';sheet.id='bookingEditSheet';
  sheet.innerHTML=`
    <div class="sheet-handle"></div><div class="sheet-title"><div><span class="section-kicker">BOOKING EDITOR</span><h2 id="bookingEditTitle">新增預訂</h2></div><button class="round-btn" id="closeBookingEdit">×</button></div>
    <form class="edit-form" id="bookingEditForm">
      <input type="hidden" id="editBookingId"><input type="hidden" id="editBookingVersion">
      <div class="edit-form-grid"><label><span>類型</span><select id="editBookingType"><option value="stay">住宿</option><option value="flight">航班</option><option value="car">租車</option><option value="tour">Tour</option><option value="other">其他</option></select></label><label><span>狀態</span><select id="editBookingStatus"><option value="confirmed">confirmed</option><option value="planned">planned</option><option value="cancelled">cancelled</option></select></label></div>
      <label><span>名稱</span><input id="editBookingName" required></label>
      <label><span>Provider</span><input id="editBookingProvider"></label>
      <label><span>日期摘要</span><input id="editBookingSummary" placeholder="11/22 → 11/25"></label>
      <label><span>地點 / Meta</span><input id="editBookingLocation"></label>
      <div class="edit-form-grid"><label><span>Confirmation</span><input id="editBookingCode"></label><label><span>PIN</span><input id="editBookingPin"></label></div>
      <label><span>私人備註</span><textarea id="editBookingNotes"></textarea></label>
      <label><span>取消條款</span><textarea id="editBookingCancel"></textarea></label>
      <div class="edit-form-actions"><button type="button" class="edit-delete" id="deleteBookingBtn">刪除</button><button type="submit" class="edit-save">儲存</button></div>
      <p class="edit-status" id="bookingEditStatus"></p>
    </form>`;
  document.body.append(backdrop,sheet);
  const close=()=>{sheet.classList.remove('show');backdrop.classList.remove('show')};
  qs('#closeBookingEdit').onclick=close;backdrop.onclick=close;qs('#bookingEditForm').onsubmit=saveBookingEditor;qs('#deleteBookingBtn').onclick=deleteCurrentBooking;
  return sheet;
}

function openBookingEditor(idx){
  if(!canEditTrip())return;
  const sheet=ensureBookingEditor(),b=idx===null?null:TRIP.bookings[idx],raw=b?._raw||{};
  qs('#bookingEditTitle').textContent=b?'編輯預訂':'新增預訂';
  qs('#editBookingId').value=b?.id||'';qs('#editBookingVersion').value=b?.version||'';
  qs('#editBookingType').value=b?.type||'stay';qs('#editBookingStatus').value=b?.status||'confirmed';
  qs('#editBookingName').value=b?.title||'';qs('#editBookingProvider').value=b?.provider||'';
  qs('#editBookingSummary').value=b?.dates||'';qs('#editBookingLocation').value=raw.location_name||b?.meta||'';
  qs('#editBookingCode').value=b?.code==='—'?'':(b?.code||'');qs('#editBookingPin').value=b?.secret||'';
  qs('#editBookingNotes').value=b?.notice||'';qs('#editBookingCancel').value=raw.cancellation_policy||'';
  qs('#deleteBookingBtn').hidden=!b;qs('#bookingEditStatus').textContent='';
  qs('#bookingEditBackdrop').classList.add('show');sheet.classList.add('show');
}

async function saveBookingEditor(e){
  e.preventDefault();
  const reservation={
    id:qs('#editBookingId').value||null,baseVersion:Number(qs('#editBookingVersion').value)||0,
    type:qs('#editBookingType').value,status:qs('#editBookingStatus').value,title:qs('#editBookingName').value.trim(),
    provider:qs('#editBookingProvider').value.trim(),summary:qs('#editBookingSummary').value.trim(),
    locationName:qs('#editBookingLocation').value.trim(),confirmationCode:qs('#editBookingCode').value.trim(),
    pinCode:qs('#editBookingPin').value.trim(),privateNotes:qs('#editBookingNotes').value.trim(),
    cancellationPolicy:qs('#editBookingCancel').value.trim(),sourceType:'manual'
  };
  qs('#bookingEditStatus').textContent='儲存中…';
  try{await travelEditor('save_reservation',{reservation});qs('#bookingEditSheet').classList.remove('show');qs('#bookingEditBackdrop').classList.remove('show');await hydratePrivateCloudData()}
  catch(err){qs('#bookingEditStatus').textContent=err.code==='version_conflict'?'資料已被其他人更新，請重新開啟。':'儲存失敗：'+err.message}
}

async function deleteCurrentBooking(){
  const id=qs('#editBookingId').value;if(!id||!confirm('刪除這筆預訂？'))return;
  try{await travelEditor('delete_reservation',{id,baseVersion:Number(qs('#editBookingVersion').value)||0});qs('#bookingEditSheet').classList.remove('show');qs('#bookingEditBackdrop').classList.remove('show');await hydratePrivateCloudData()}
  catch(err){qs('#bookingEditStatus').textContent='刪除失敗：'+err.message}
}

async function tripAdmin(action='list',payload={}){
  const client=window.TravelAuth?.getClient?.();
  if(!client) throw new Error('auth_not_ready');
  const response=await client.functions.invoke('trip-admin',{body:{tripSlug:window.TRAVEL_CONFIG.tripSlug,action,...payload}});
  if(response.error) throw response.error;
  if(response.data?.error) throw new Error(response.data.error);
  return response.data;
}
function closeMembersSheet(){
  qs('#membersSheet')?.classList.remove('show');
  qs('#membersBackdrop')?.classList.remove('show');
}
async function loadMembers(){
  const box=qs('#membersList'),status=qs('#memberStatus');
  status.textContent='讀取中…';
  try{
    const data=await tripAdmin('list');
    const owner=data.role==='owner';
    qs('#inviteMemberForm').hidden=!owner;
    qs('#membersRoleHint').textContent=currentTripTitle()+' · '+String(data.role||'viewer').toUpperCase();
    box.replaceChildren();

    for(const m of (data.members||[]).filter(x=>!x.revoked_at)){
      const card=document.createElement('article');card.className='member-card';
      const head=document.createElement('div');head.className='member-head';
      const who=document.createElement('div');
      const strong=document.createElement('strong');strong.textContent=m.email||m.user_id;
      const small=document.createElement('small');small.textContent=m.role==='owner'?'Trip Owner':'已啟用';
      who.append(strong,small);head.append(who);

      const actions=document.createElement('div');actions.className='member-actions';
      if(owner&&m.role!=='owner'){
        const role=document.createElement('select');
        role.innerHTML='<option value="editor">Editor</option><option value="viewer">Viewer</option>';
        role.value=m.role;
        role.onchange=async()=>{status.textContent='更新權限中…';await tripAdmin('role',{userId:m.user_id,role:role.value});await loadMembers()};
        const remove=document.createElement('button');remove.className='member-remove';remove.textContent='移除';
        remove.onclick=async()=>{if(confirm('移除此 Trip 成員？他的這個 Trip 裝置權限也會一併撤銷。')){await tripAdmin('remove_member',{userId:m.user_id});await loadMembers()}};
        actions.append(role,remove);
      }else{
        const badge=document.createElement('span');badge.className='member-role';badge.textContent=m.role;actions.append(badge);
      }
      head.append(actions);card.append(head);

      const list=document.createElement('div');list.className='device-list';
      const memberDevices=(data.devices||[]).filter(x=>x.user_id===m.user_id);
      if(!memberDevices.length){
        const empty=document.createElement('div');empty.className='device-empty';empty.textContent='尚無 Trusted Device';list.append(empty);
      }
      for(const d of memberDevices){
        const row=document.createElement('div');row.className='device-row';
        if(d.revoked_at) row.classList.add('revoked');
        const label=document.createElement('div');
        const ds=document.createElement('strong');ds.textContent=d.device_name||'Trusted Device';
        const meta=document.createElement('small');
        meta.textContent=d.revoked_at?'已撤銷':(d.last_seen_at?'最近使用 '+new Date(d.last_seen_at).toLocaleString('zh-TW'):'已核准');
        label.append(ds,meta);row.append(label);
        if(owner&&!d.revoked_at){
          const revoke=document.createElement('button');revoke.textContent='撤銷裝置';
          revoke.onclick=async()=>{if(confirm('只撤銷這一台 Trusted Device？其他裝置仍可使用。')){await tripAdmin('revoke_device',{deviceId:d.id});await loadMembers()}};
          row.append(revoke);
        }
        list.append(row);
      }
      card.append(list);box.append(card);
    }

    for(const i of (data.invites||[]).filter(x=>x.status==='pending')){
      const card=document.createElement('article');card.className='member-card invite-pending';
      const head=document.createElement('div');head.className='member-head';
      const who=document.createElement('div');
      const strong=document.createElement('strong');strong.textContent=i.email;
      const small=document.createElement('small');small.textContent='邀請中 · '+i.role;
      who.append(strong,small);head.append(who);
      if(owner){
        const cancel=document.createElement('button');cancel.className='member-remove';cancel.textContent='取消邀請';
        cancel.onclick=async()=>{await tripAdmin('revoke_invite',{inviteId:i.id});await loadMembers()};
        head.append(cancel);
      }
      card.append(head);box.append(card);
    }

    status.textContent='';
  }catch(err){console.warn(err);status.textContent='無法讀取成員資料。'}
}
qs('#membersBtn').onclick=async()=>{
  closeSheet();qs('#membersBackdrop').classList.add('show');qs('#membersSheet').classList.add('show');qs('#membersSheet').setAttribute('aria-hidden','false');await loadMembers();
};
qs('#closeMembers').onclick=closeMembersSheet;
qs('#membersBackdrop').onclick=closeMembersSheet;
qs('#inviteMemberForm').onsubmit=async e=>{
  e.preventDefault();
  const email=qs('#inviteEmail').value.trim(),role=qs('#inviteRole').value;
  qs('#memberStatus').textContent='正在建立邀請…';
  try{
    const result=await tripAdmin('invite',{email,role});
    qs('#inviteEmail').value='';
    qs('#memberStatus').textContent=result.mode==='invite_sent'?'邀請信已寄出。':'已授權此成員；對方可使用相同 Email 登入。';
    await loadMembers();
  }catch(err){console.warn(err);qs('#memberStatus').textContent='邀請失敗。'}
};

async function initCloudShell(){
  try{
    const fallbackSeed=window.TRAVEL_CONFIG?.tripSlug==='iceland-2026'?TRIP:null;
    const local=await window.TravelStore?.init?.(fallbackSeed);
    if(window.TRAVEL_CONFIG?.tripSlug&&local?.trip?.days?.length){
      TRIP=local.trip;
      currentTripRole=local.trip.role||'viewer';
      selectedDay=Math.min(selectedDay,Math.max(0,TRIP.days.length-1));
      syncTripLabels();
      renderAll();
    }
  }catch(err){console.warn('Local store init failed',err)}

  if(window.TravelAuth){
    window.TravelAuth.onChange(s=>{
      setAuthGateState(s.state);
      if(s.state==='ready'){
        if(window.TRAVEL_CONFIG?.tripSlug) hydratePrivateCloudData();
        else renderTripChooser();
      }
    });
    const authState=await window.TravelAuth.init();
    setAuthGateState(authState.state);
    if(authState.state==='ready'){
      if(window.TRAVEL_CONFIG?.tripSlug) await hydratePrivateCloudData();
      else await renderTripChooser();
    }
  }
}

qs('.app-shell')?.classList.add('today-mode');
const authTitle=qs('#authTripTitle');
if(authTitle) authTitle.textContent=window.TRAVEL_CONFIG?.tripLabel||'Travel OS';
if(window.TRAVEL_CONFIG?.tripSlug==='iceland-2026'){
  syncToReferenceTripDay();
  updateDemoModeUI();
  renderAll();
  updateHeroCollapse();
}else if(window.TRAVEL_CONFIG?.tripSlug){
  qs('.app-shell').style.visibility='hidden';
}
initCloudShell().finally(()=>{if(qs('.app-shell'))qs('.app-shell').style.visibility=''});
lastObservedIcelandDate=icelandTodayISO();
setInterval(()=>{
  if(demoMode) return;
  const now=icelandTodayISO();
  if(now===lastObservedIcelandDate) return;
  lastObservedIcelandDate=now;
  syncToReferenceTripDay();
  renderAll();
},60000);
if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('service-worker.js').catch(()=>{});
