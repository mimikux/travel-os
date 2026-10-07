let selectedDay=0, currentFilter='all', map, routeLine, routeCar, routeTimer=null;
let initialTripDaySelectionPending=true;
let mapSelectedDays=new Set([selectedDay]), mapPrimaryDay=selectedDay, mapRouteLayers=[];
let mapMultiSelectMode=false;
let demoMode=(()=>{try{return localStorage.getItem('icelandDemoMode')==='1'}catch(_){return false}})();
let routeGeometry=[], routeCumulative=[], routeTotalKm=0, routeTotalDurationSec=0, routeStopFractions=[], routeSegmentDistancesKm=[], routeSegmentDurationsSec=[];
let routeScaleState=null;
let routeMetricMode=(()=>{try{return localStorage.getItem('travelRouteMetric')==='time'?'time':'distance'}catch(_){return 'distance'}})();
let routeRenderToken=0;
const roadRouteCache=new Map();
let todayRouteToken=0;
let lastObservedIcelandDate=null;
let currentTripRole='viewer';
let cloudLoaded=false;
let cloudSyncState='cache';
let cloudLastError='';
let editMode=false;
let authorizedTrips=[];

const APP_NAME="Matt's Travel OS";
const APP_VERSION='1.3.0';

const titles={today:'行程',map:'旅程地圖',booking:'預訂',more:'更多'};
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
    // Live mode uses an explicit relative label so past trips are equally
    // intuitive to revisit: "46天後" before the day, "46天前" after it.
    if(diff===0){
      label='今天';
      timelineLabel='今天';
    }else{
      label=diff<0?`${Math.abs(diff)}天前`:`${diff}天後`;
      timelineLabel=label;
    }
  }

  return {label,timelineLabel,diff,isPast:diff<0,isToday:diff===0,isFuture:diff>0,tripStarted,tripEnded,today};
}
function syncToReferenceTripDay(forceDemo=false,fallbackToFirst=false){
  const today=(demoMode||forceDemo)?DEMO_REFERENCE_DATE:icelandTodayISO();
  const idx=TRIP.days.findIndex(d=>d.date===today);
  if(idx>=0){
    selectedDay=idx;
    mapPrimaryDay=idx;
    mapSelectedDays=new Set([idx]);
    return true;
  }
  if(fallbackToFirst&&TRIP.days.length){
    selectedDay=0;
    mapPrimaryDay=0;
    mapSelectedDays=new Set([0]);
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
    dayNote:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M6 4h9l3 3v13H6z"></path><path d="M15 4v4h4"></path><path d="M9 12h6"></path><path d="M9 16h5"></path></svg>`,
    clock:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><path d="M12 8v5l3 2"></path></svg>`,
    sunrise:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M4 18h16"></path><path d="M7 18a5 5 0 0 1 10 0"></path><path d="M12 6v3"></path><path d="M8 9.5 6.5 8"></path><path d="M16 9.5 17.5 8"></path><path d="M12 15l-2.2-2.2"></path><path d="M12 15l2.2-2.2"></path><path d="M5 21h14"></path></svg>`,
    sunset:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M4 18h16"></path><path d="M7 15a5 5 0 0 0 10 0"></path><path d="M12 6v3"></path><path d="M8 9.5 6.5 8"></path><path d="M16 9.5 17.5 8"></path><path d="M7 21h10"></path><path d="M5 20h2"></path><path d="M17 20h2"></path></svg>`,
    today:`<svg viewBox="0 0 24 24" class="${cls}" aria-hidden="true"><path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11z"></path><circle cx="12" cy="10" r="2.2"></circle></svg>`,
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

const heroPhotoCache=new Map();
let heroPhotoRenderToken=0;
function heroPrimaryEvent(d){
  const events=Array.isArray(d?.events)?d.events:[];
  const usable=events.filter(e=>e&&!e.uncertain);
  // A destination/activity beats transport, food and accommodation.
  return usable.find(e=>e.type==='spot'||e.type==='tour')
    ||usable.find(e=>e.type==='stay')
    ||null;
}
function heroFallbackQuery(d){
  const primary=heroPrimaryEvent(d);
  if(primary) return {itemId:primary.id||'',placeId:primary.placeId||'',query:[primary.title,primary.address].filter(Boolean).join(', '),source:primary.type};
  const dayName=String(d?.name||'').trim();
  if(dayName&&!['未命名行程','尚未建立行程','第一天'].includes(dayName)) return {itemId:'',placeId:'',query:dayName,source:'day'};
  return {itemId:'',placeId:'',query:currentTripTitle(),source:'trip'};
}
function staticHeroFallback(d){
  // Preserve the established Iceland artwork only as a last-resort visual.
  // Other trips get a neutral background instead of inheriting Iceland imagery.
  if(TRIP?.slug==='iceland-2026') return (DAY_UI[d?.label]||DAY_UI.D0).photo;
  return 'linear-gradient(135deg,#23423e 0%,#4f7169 48%,#b08a55 100%)';
}
function dayUi(d){
  const fallback=DAY_UI[d?.label]||DAY_UI.D0;
  const cached=heroPhotoCache.get(String(d?.id||d?.date||d?.label||''));
  const autoPhoto=cached?.photoUrl?`url("${String(cached.photoUrl).replace(/"/g,'%22')}")`:null;
  return {
    ...fallback,
    photo:d?.heroImageUrl?`url('${d.heroImageUrl}')`:(autoPhoto||staticHeroFallback(d)),
    sunrise:d?.sunrise||fallback.sunrise||'--:--',
    sunset:d?.sunset||fallback.sunset||'--:--'
  };
}
async function refreshHeroPhoto(dayIndex){
  const d=TRIP?.days?.[dayIndex];
  if(!d||d.heroImageUrl)return;
  const key=String(d.id||d.date||d.label||dayIndex);
  const hero=qs('#heroCard');
  const apply=result=>{
    if(selectedDay!==dayIndex||!result?.photoUrl)return;
    const photo=`url("${String(result.photoUrl).replace(/"/g,'%22')}")`;
    hero.style.setProperty('--hero-photo',photo);
    hero.style.backgroundImage=photo;
    hero.dataset.heroSource=result.source||'google_places';
    hero.dataset.heroSubject=result.subject||'';
  };
  if(heroPhotoCache.has(key)){apply(heroPhotoCache.get(key));return;}
  const token=++heroPhotoRenderToken;
  const primary=heroFallbackQuery(d);
  try{
    const result=await travelEditor('hero_photo',{
      itemId:primary.itemId||undefined,
      placeId:primary.placeId||undefined,
      query:primary.query,
      fallbackQuery:currentTripTitle()
    });
    if(token!==heroPhotoRenderToken||selectedDay!==dayIndex)return;
    if(result?.photoUrl){
      const cached={...result,subject:primary.query,selectionSource:primary.source};
      heroPhotoCache.set(key,cached);
      apply(cached);
    }else{
      heroPhotoCache.set(key,{status:result?.status||'not_found'});
    }
  }catch(err){
    console.warn('Hero photo lookup failed',err?.code||err?.message||err);
  }
}
function driveText(day){
  if(day?.drive) return day.drive;
  const mins=Number(day?.driveMinutes)||0;
  const h=Math.floor(mins/60),m=mins%60;
  return h?`${h}h ${String(m).padStart(2,'0')}m`:`${m}m`;
}
const TRIP_THEMES={
  ice:{name:'Ice',desc:'冰藍 × 深海軍藍'},
  earth:{name:'Earth',desc:'淡土黃 × 深褐色'},
  forest:{name:'Forest',desc:'鼠尾草綠 × 深森林綠'},
  sakura:{name:'Sakura',desc:'淡粉米 × 酒紅'},
  lavender:{name:'Lavender',desc:'淡灰紫 × 深紫灰'},
  slate:{name:'Slate',desc:'冷灰 × 深藍灰'}
};
function suggestTripTheme(title=''){
  const s=String(title).toLowerCase();
  if(/iceland|冰島|snow|雪|nordic|北歐/.test(s))return 'ice';
  if(/forest|森林|山林|hike|健行/.test(s))return 'forest';
  if(/sakura|櫻|spring|春/.test(s))return 'sakura';
  if(/city|urban|東京|大阪|首爾|london|paris/.test(s))return 'slate';
  if(/lavender|薰衣草|purple/.test(s))return 'lavender';
  return 'earth';
}
function currentTripTheme(){
  const saved=TRIP?.settings?.theme;
  return TRIP_THEMES[saved]?saved:suggestTripTheme(TRIP?.title||'');
}
function applyTripTheme(theme){
  const key=TRIP_THEMES[theme]?theme:'earth';
  document.documentElement.dataset.tripTheme=key;
  const meta=document.querySelector('meta[name="theme-color"]');
  const color={ice:'#173b5d',earth:'#5b4630',forest:'#204b3a',sakura:'#70404a',lavender:'#51445f',slate:'#33485a'}[key];
  if(meta&&color)meta.setAttribute('content',color);
}
function currentTripTitle(){return TRIP?.title||'Travel OS'}
function isPlaceholderDayName(name){
  const value=String(name||'').trim();
  return !value||['未命名行程','尚未建立行程','第一天','行程'].includes(value);
}
function compactDayTitle(title){
  return String(title||'').trim()
    .replace(/\s*[·|｜]\s*/g,' · ')
    .replace(/\s+/g,' ')
    .replace(/^(?:移動|前往|住宿)\s*[·:：-]?\s*/,'')
    .trim();
}
function derivedDayTitle(day,dayIndex){
  if(!day)return '行程待安排';
  if(!isPlaceholderDayName(day.name))return day.name;
  const events=(day.events||[]).filter(e=>e&&!e.uncertain);
  const sightseeing=events.filter(e=>['spot','tour'].includes(e.type));
  const secondary=events.filter(e=>['food','shop'].includes(e.type));
  const stays=events.filter(e=>e.type==='stay');
  const flights=events.filter(e=>e.type==='flight');
  const pool=sightseeing.length?sightseeing:(secondary.length?secondary:(stays.length?stays:flights));
  const names=[];
  for(const e of pool){
    const name=compactDayTitle(e.title);
    if(name&&!names.includes(name))names.push(name);
    if(names.length>=2)break;
  }
  if(names.length>=2)return names.join(' · ');
  if(names.length===1)return names[0];
  // A multi-night stay may not have a duplicate itinerary item on night 2.
  // Use the active accommodation only when there is no real itinerary title.
  const overnight=typeof stayForNight==='function'?stayForNight(dayIndex):null;
  if(overnight?.title)return compactDayTitle(overnight.title);
  return '行程待安排';
}
function syncTripLabels(){
  const title=currentTripTitle();
  applyTripTheme(currentTripTheme());
  qsa('[data-trip-title]').forEach(el=>el.textContent=title);
  const authTitle=qs('#authTripTitle'); if(authTitle) authTitle.textContent=`${APP_NAME} V${APP_VERSION}`;
  const moreVersion=qs('#moreAppVersion'); if(moreVersion) moreVersion.textContent=`V${APP_VERSION}`;
  const dateSummary=qs('#tripDateSummary');
  if(dateSummary) dateSummary.textContent=[TRIP?.startDate||TRIP?.days?.[0]?.date,TRIP?.endDate||TRIP?.days?.at(-1)?.date].filter(Boolean).join(' → ')||'—';
  const dateEdit=qs('#editTripDatesBtn'); if(dateEdit){dateEdit.hidden=currentTripRole!=='owner';const em=dateEdit.querySelector('em');if(em)em.textContent='編輯旅程';}
  const roleSummary=qs('#tripRoleSummary'); if(roleSummary) roleSummary.textContent=String(currentTripRole||TRIP?.role||'viewer').toUpperCase();
  const syncSummary=qs('#tripSyncSummary');
  if(syncSummary){
    const labels={synced:'Cloud synced',syncing:'正在同步…',auth:'需要重新登入',error:'同步失敗',cache:'Offline cache'};
    syncSummary.textContent=labels[cloudSyncState]||'Offline cache';
    syncSummary.title=cloudLastError||'';
  }
  document.title=window.TRAVEL_CONFIG?.tripSlug?`${title} · Travel OS`:'Travel OS';
  updateMailBadges();
  syncMoreStatus();
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
  qs('#'+name+'View')?.classList.add('active');
  qsa('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.target===name));
  if(qs('#pageTitle')) qs('#pageTitle').textContent=titles[name]||'Travel OS';
  if(name==='map') setTimeout(()=>{initMap();map.invalidateSize();renderMapDay()},60);
  if(name==='today') requestAnimationFrame(updateHeroCollapse);
  if(name==='more') renderMoreView();
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

function eventBookings(event){
  const ids=Array.isArray(event?.reservationIds)&&event.reservationIds.length
    ?event.reservationIds
    :(event?.reservationId?[event.reservationId]:[]);
  const set=new Set(ids.map(String));
  return (TRIP.bookings||[]).map((b,idx)=>({b,idx})).filter(x=>set.has(String(x.b.id)));
}
function bookingPeopleCount(b){
  const p=b?.imported||{};
  return Number(p.guestCount||p.passengerCount||0)||0;
}
function bookingRoomCount(b){
  const p=b?.imported||{};
  return Number(p.roomCount||0)||0;
}
function flightSegmentForDay(b,dateString){
  const p=b?.imported||{};
  const segments=Array.isArray(p.segments)?p.segments:[];
  let seg=segments.find(s=>String(s?.date||'').slice(0,10)===String(dateString||'').slice(0,10));
  if(!seg&&segments.length===1)seg=segments[0];
  if(!seg&&segments.length){
    const start=String(b?._raw?.starts_at||'').slice(0,10);
    const end=String(b?._raw?.ends_at||'').slice(0,10);
    if(start===dateString)seg=segments[0];
    else if(end===dateString)seg=segments[segments.length-1];
  }
  return seg||null;
}
function detailRowValue(b,labelPattern){
  const rows=Array.isArray(b?.details?.rows)?b.details.rows:[];
  const row=rows.find(x=>Array.isArray(x)&&labelPattern.test(String(x[0]||'')));
  return row?String(row[1]||'').trim():'';
}
function dateDiffDays(start,end){
  const a=Date.parse(String(start||'').slice(0,10)+'T00:00:00Z');
  const b=Date.parse(String(end||'').slice(0,10)+'T00:00:00Z');
  return Number.isFinite(a)&&Number.isFinite(b)&&b>a?Math.round((b-a)/86400000):0;
}
function shortDateRange(start,end){
  const fmt=v=>String(v||'').slice(5,10).replace('-','/');
  const a=fmt(start),b=fmt(end);
  return a&&b?a+'–'+b:(a||b);
}
function briefText(value,max=150){
  const s=String(value||'').replace(/\s+/g,' ').trim();
  return s.length>max?s.slice(0,max-1)+'…':s;
}
function flightAirlineName(b){
  const p=b?.imported||{};
  if(p.airlineName)return String(p.airlineName);
  const row=detailRowValue(b,/航空公司|airline/i);
  if(row)return row;
  const provider=String(b?.provider||'');
  if(provider.includes('/'))return provider.split('/').slice(1).join('/').trim();
  if(provider&&!/trip\.com/i.test(provider))return provider;
  return '';
}
function flightBaggageSummaryForBooking(b){
  const p=b?.imported||{};
  if(p.baggageSummary)return String(p.baggageSummary);
  const detail=detailRowValue(b,/^行李$|行李限額|baggage/i);
  if(detail)return detail;
  const parts=[];
  if(p.carryOnKg)parts.push('隨身 '+p.carryOnKg+'kg');
  if(p.checkedBaggageIncluded===false)parts.push('無託運');
  else if(p.checkedBaggageKg)parts.push('託運 '+p.checkedBaggageKg+'kg');
  if(parts.length)return parts.join(' · ');
  const weights=[];
  (Array.isArray(p.passengerDetails)?p.passengerDetails:[]).forEach(line=>{
    const m=String(line).match(/(\d+)\s*公斤/);
    if(m)weights.push(Number(m[1]));
  });
  const unique=[...new Set(weights.filter(Number.isFinite))];
  if(unique.length===1)return '託運 '+unique[0]+'kg';
  if(unique.length>1)return '行李詳預訂資訊';
  return '';
}
function flightPresentation(event,dateString){
  const linked=eventBookings(event);
  const booking=linked[0]?.b||null;
  const imported=booking?.imported||{};
  const seg=booking?flightSegmentForDay(booking,dateString):null;
  const titleText=String(event?.title||'');
  const subtitleText=String(event?.subtitle||'');
  const importedRoute=(imported?.departureAirport&&imported?.arrivalAirport)
    ?[imported.departureAirport,imported.arrivalAirport]
    :null;
  const routeMatch=(seg?.departureAirport&&seg?.arrivalAirport)
    ?[seg.departureAirport,seg.arrivalAirport]
    :(importedRoute||(titleText.match(/\b([A-Z]{3})\s*(?:→|->|↔|–|-)\s*([A-Z]{3})\b/i)||[]).slice(1,3));
  const dep=routeMatch?.[0]||'';
  const arr=routeMatch?.[1]||'';
  const timeMatch=subtitleText.match(/(\d{1,2}:\d{2})\s*(?:→|–|-)\s*(\d{1,2}:\d{2})/);
  const depTime=seg?.departureTime||imported?.departureTime||event?.time||timeMatch?.[1]||'';
  const arrTime=seg?.arrivalTime||imported?.arrivalTime||timeMatch?.[2]||'';
  const flightNo=seg?.flightNo||imported?.flightNo||
    (titleText.match(/\b([A-Z0-9]{2}\s?\d{2,4})\b/i)||subtitleText.match(/\b([A-Z0-9]{2}\s?\d{2,4})\b/i)||[])[1]||'';
  const airlineNames=[...new Set(linked.map(({b})=>flightAirlineName(b)).filter(Boolean))];
  const baggage=[...new Set(linked.map(({b})=>flightBaggageSummaryForBooking(b)).filter(Boolean))];
  const baggageText=baggage.length>1?'行李詳預訂資訊':(baggage[0]||'');
  const note=[airlineNames.length===1?airlineNames[0]:(airlineNames.length>1?'航空公司詳預訂資訊':''),baggageText].filter(Boolean).join(' · ');
  return {
    title:[flightNo?flightNo.replace(/\s+/g,''):'',depTime&&arrTime?depTime+'–'+arrTime:''].filter(Boolean).join(' · ')||titleText,
    subtitle:dep&&arr?dep+' → '+arr:subtitleText,
    note,
    // Keep the scheduled departure visible in the timeline's right-hand time
    // column; the full departure-arrival range remains in the flight title.
    time:event?.time||depTime||'',
    linked,
    flightNo:flightNo?flightNo.replace(/\s+/g,''):'',
    segment:seg
  };
}
function stayMealSummary(b){
  const p=b?.imported||{};
  const explicit=String(p.mealPlan||'').trim();
  if(explicit)return explicit;
  const text=String(p.amenities||'')+' '+detailRowValue(b,/方案|餐食|meal/i);
  if(/不包括餐|不含餐|no meals?/i.test(text))return '不含餐';
  const breakfast=/早餐|breakfast/i.test(text);
  const dinner=/晚餐|dinner/i.test(text);
  if(breakfast&&dinner)return '含早餐、晚餐';
  if(breakfast)return '含早餐';
  if(dinner)return '含晚餐';
  return '';
}
function stayPresentation(event){
  const linked=eventBookings(event);
  if(!linked.length)return {title:event.title||'',subtitle:event.subtitle||'',note:event.note||'',time:event.time||''};
  const bookings=linked.map(x=>x.b);
  const nightCounts=bookings.map(b=>Number(b.imported?.nightCount)||dateDiffDays(b.imported?.startDate||b._raw?.starts_at,b.imported?.endDate||b._raw?.ends_at)).filter(Boolean);
  const nights=nightCounts.length?Math.max(...nightCounts):0;
  let rooms=bookings.reduce((n,b)=>n+(bookingRoomCount(b)||0),0);
  if(!rooms&&bookings.length)rooms=bookings.length;
  const people=bookings.reduce((n,b)=>{
    const p=bookingPeopleCount(b);
    if(p)return n+p;
    const m=String(b.imported?.guests||'').match(/(\d+)/);
    return n+(m?Number(m[1]):0);
  },0);
  const plans=[...new Set(bookings.map(stayMealSummary).filter(Boolean))];
  const note=plans.length>1?'方案詳預訂資訊':(plans[0]||event.note||'');
  return {
    title:event.title||bookings[0]?.title||'住宿',
    subtitle:[nights?nights+' 晚':'',rooms?rooms+' 房':'',people?people+' 人':''].filter(Boolean).join(' · ')||event.subtitle||'',
    note,
    // First-night check-in stays visible; subsequent nightly stay rows with no
    // itinerary time remain untimed by design.
    time:event?.time||''
  };
}
function carPresentation(event){
  const linked=eventBookings(event),b=linked[0]?.b||null,p=b?.imported||{};
  if(!b)return {title:event.title||'',subtitle:event.subtitle||'',note:event.note||'',time:event.time||''};
  const start=p.startDate||String(b._raw?.starts_at||'').slice(0,10);
  const end=p.endDate||String(b._raw?.ends_at||'').slice(0,10);
  const days=Number(p.rentalDays)||dateDiffDays(start,end);
  const transmission=/automatic|自排/i.test(String(p.transmission||''))?'自排':(/manual|手排/i.test(String(p.transmission||''))?'手排':String(p.transmission||''));
  const note=[p.plan||'',transmission,p.extras||'',p.insurances||''].filter(Boolean).map(x=>briefText(x,90)).join(' · ');
  return {
    title:p.rentalCompany||b.provider||event.title||'租車',
    subtitle:[p.vehicleModel||p.title||b.title||'',days?days+' 天':'',shortDateRange(start,end)?'('+shortDateRange(start,end)+')':''].filter(Boolean).join(' · '),
    note:note||event.note||'',
    // Preserve the itinerary pickup/drop-off time even when reservation data
    // is linked to the card.
    time:event?.time||''
  };
}
function tourPresentation(event){
  const linked=eventBookings(event),b=linked[0]?.b||null,p=b?.imported||{};
  if(!b)return {title:event.title||'',subtitle:event.subtitle||'',note:event.note||'',time:event.time||''};
  const meetingPoint=p.meetingPoint||p.address||b._raw?.address||'';
  const meetingTime=p.meetingTime||p.time||event.time||'';
  const note=[meetingPoint?('集合 '+meetingPoint):'',meetingTime?('集合時間 '+meetingTime):'',p.activityNote||p.providerNote||event.note||''].filter(Boolean).map(x=>briefText(x,120)).join(' · ');
  return {
    title:p.title||b.title||event.title||'Tour',
    subtitle:p.activityProvider||p.operator||event.subtitle||b.provider||'',
    note,
    // Timeline time is the scheduled itinerary time. Keep the booking's
    // meeting time in the note so both values can be shown when they differ.
    time:event.time||''
  };
}
function eventPresentation(event,dateString){
  if(event?.type==='flight')return flightPresentation(event,dateString);
  if(event?.type==='stay')return stayPresentation(event);
  if(event?.type==='car')return carPresentation(event);
  if(event?.type==='tour')return tourPresentation(event);
  return {title:event?.title||'',subtitle:event?.subtitle||'',note:event?.note||'',time:event?.time||''};
}
function flightStatusUrl(event,dateString){
  const p=flightPresentation(event,dateString);
  const compact=String(p.flightNo||'').replace(/\s+/g,'').toUpperCase();
  const m=compact.match(/^([A-Z0-9]{2})(\d{1,4})$/);
  const date=String(p.segment?.date||dateString||'').slice(0,10);
  const dm=date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m||!dm)return '';
  const carrier=({IT:'TTW'})[m[1]]||m[1];
  return 'https://www.flightstats.com/v2/flight-tracker/'+encodeURIComponent(carrier)+'/'+encodeURIComponent(m[2])+
    '?year='+Number(dm[1])+'&month='+Number(dm[2])+'&date='+Number(dm[3]);
}
function openFlightStatus(dayIndex,eventIndex){
  const day=TRIP.days?.[dayIndex],event=day?.events?.[eventIndex];
  if(!day||!event)return;
  const url=flightStatusUrl(event,day.date);
  if(url)window.open(url,'_blank','noopener');
}
function toggleInlineBookingCode(button,idx){
  const b=(TRIP.bookings||[])[idx],strong=button?.closest('.booking-code')?.querySelector('strong');
  if(!b?.code||!strong)return;
  const masked=maskCode(b.code,b.secret);
  strong.textContent=strong.textContent===masked?(b.secret?b.code+' · PIN '+b.secret:b.code):masked;
}
function renderTimelineBookingCard(b,idx,n){
  const d=b.details||{};
  const rows=(d.rows||[]).map(([label,value])=>`<div class="booking-detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  const amenities=(d.amenities||[]).length?`<div class="booking-detail-section"><div class="booking-detail-label">設備／包含</div><div class="amenity-chips">${d.amenities.map(x=>`<span>${escapeHtml(x)}</span>`).join('')}</div></div>`:'';
  const tips=(d.tips||[]).length?`<div class="booking-detail-section"><div class="booking-detail-label warn">注意事項</div><ul class="booking-tip-list">${d.tips.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>`:'';
  const source=d.source?`<div class="booking-detail-source">資料來源：${escapeHtml(d.source)}</div>`:'';
  const code=b.code?`<div class="booking-code"><div><small>CONFIRMATION${b.secret?' / PIN':''}</small><strong>${escapeHtml(maskCode(b.code,b.secret))}</strong></div><button class="reveal-btn" type="button" onclick="event.stopPropagation();toggleInlineBookingCode(this,${idx})">顯示</button></div>`:'';
  return `<article class="timeline-booking-card">
    <div class="booking-top">
      <div class="booking-icon">${iconSVG(b.type==='stay'?'house':(b.type||'booking'))}</div>
      <div><div class="booking-provider">BOOKING ${n+1} · ${escapeHtml(b.provider||'')}</div><h3>${escapeHtml(b.title||'預訂')}</h3><div class="booking-dates">${escapeHtml(b.dates||'')}</div></div>
      <div class="code-pill">${escapeHtml(String(b.status||'confirmed').toUpperCase())}</div>
    </div>
    ${b.meta?`<div class="booking-meta">${escapeHtml(b.meta)}</div>`:''}
    ${code}
    ${b.alert?`<div class="alert-box">⚠️ ${escapeHtml(b.alert)}</div>`:''}
    ${b.notice?`<div class="notice">${escapeHtml(b.notice)}</div>`:''}
    <div class="booking-detail-panel timeline-booking-detail"><div class="booking-detail-grid">${rows}</div>${amenities}${tips}${source}</div>
  </article>`;
}
function renderLinkedBookings(event,dayIndex,eventIndex,dateString=''){
  const linked=eventBookings(event);
  if(!linked.length)return '';
  const id='eventBookings-'+dayIndex+'-'+eventIndex;
  const cards=linked.map(({b,idx},n)=>renderTimelineBookingCard(b,idx,n)).join('');
  return `<div class="event-booking-group unified-booking-group">
    <button class="booking-detail-toggle unified-booking-toggle" type="button"
      onclick="event.stopPropagation();const p=document.getElementById('${id}');const open=p.hidden;p.hidden=!open;this.classList.toggle('open',open);this.querySelector('span:first-child').textContent=open?'收起預訂資訊':'預訂資訊 · ${linked.length} 筆'">
      <span>預訂資訊 · ${linked.length} 筆</span><span class="detail-chevron">⌄</span>
    </button>
    <div class="event-booking-list unified-booking-list" id="${id}" hidden>${cards}</div>
  </div>`;
}

function renderEventDetails(e,dayIndex,eventIndex){
  const detail=e.details||{intro:'',tips:[]};
  const tipList=Array.isArray(detail.tips)?[...detail.tips]:[];
  if(Array.isArray(e.openingHours)&&e.openingHours.length){
    const hoursText='營業時間：'+e.openingHours.map(x=>`${x.day} ${x.hours}`).join('；');
    if(!tipList.some(x=>String(x).startsWith('營業時間：')))tipList.push(hoursText);
  }
  if(!detail.intro&&!tipList.length)return '';
  const tips=tipList.map(t=>`<li>${escapeHtml(t)}</li>`).join('');
  return `<div class="event-detail-wrap">
    <button class="detail-toggle" type="button" aria-expanded="false" onclick="event.stopPropagation();toggleEventDetails(${dayIndex},${eventIndex},this)">
      <span>景點介紹與注意事項</span><span class="detail-chevron">⌄</span>
    </button>
    <div class="event-details" id="eventDetails-${dayIndex}-${eventIndex}" hidden>
      ${detail.intro?`<div class="detail-section"><div class="detail-label">景點介紹</div><p>${escapeHtml(detail.intro)}</p></div>`:''}
      ${tips?`<div class="detail-section"><div class="detail-label warn">注意事項</div><ul>${tips}</ul></div>`:''}
      <div class="detail-source">來源：原行程表備註 / Google Places · 後續可在系統內編輯</div>
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

function eventClosedWarning(event,dateString){
  if(!event||!dateString||!Array.isArray(event.closedWeekdays)||!event.closedWeekdays.length)return '';
  const weekday=new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:'UTC'}).format(new Date(dateString+'T00:00:00Z'));
  return event.closedWeekdays.includes(weekday)?`⚠️ ${dateString}（${weekday.slice(0,3).toUpperCase()}）為公休日，請調整行程。`:'';
}
function timeToMinutes(value,meridiem=''){
  const m=String(value||'').trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if(!m)return null;
  let h=Number(m[1]),min=Number(m[2]);
  const ap=String(m[3]||meridiem||'').toUpperCase();
  if(ap==='AM'&&h===12)h=0;
  if(ap==='PM'&&h!==12)h+=12;
  return h*60+min;
}
function parseBusinessWindow(text){
  const raw=String(text||'').replace(/\u202f/g,' ').trim();
  if(!raw||/closed/i.test(raw))return {closed:true};
  if(/open 24 hours/i.test(raw))return {open24:true,open:0,close:1440};
  const parts=raw.split(/\s*[–—-]\s*/);
  if(parts.length<2)return null;
  const endPart=parts.at(-1).trim();
  const endMer=(endPart.match(/\b(AM|PM)\b/i)||[])[1]||'';
  let startPart=parts[0].trim();
  let startMer=(startPart.match(/\b(AM|PM)\b/i)||[])[1]||'';
  if(!startMer&&endMer){
    const sh=Number((startPart.match(/^(\d{1,2})/)||[])[1]);
    const eh=Number((endPart.match(/^(\d{1,2})/)||[])[1]);
    if(endMer.toUpperCase()==='PM'){
      if(sh===12) startMer='PM';
      else startMer=(Number.isFinite(sh)&&Number.isFinite(eh)&&sh<eh)?'PM':'AM';
    }else startMer='AM';
  }
  const open=timeToMinutes(startPart,startMer),close=timeToMinutes(endPart,endMer);
  if(open===null||close===null)return null;
  return {open,close:close<=open?close+1440:close};
}
function hoursForVisitDay(event,dateString){
  const weekday=new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:'UTC'}).format(new Date(dateString+'T00:00:00Z'));
  return (event?.openingHours||[]).find(x=>String(x?.day||'').toLowerCase()===weekday.toLowerCase())||null;
}
function eventHoursConflictWarning(event,dateString){
  if(!event||!dateString||!event.time)return '';
  const row=hoursForVisitDay(event,dateString);
  if(!row)return '';
  const w=parseBusinessWindow(row.hours);
  if(!w)return '';
  if(w.closed)return '';
  if(w.open24)return '';
  const visit=timeToMinutes(String(event.time).slice(0,5));
  if(visit===null)return '';
  const fmt=m=>String(Math.floor((m%1440)/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
  if(visit<w.open)return `⚠️ 營業時間衝突 · 預計 ${String(event.time).slice(0,5)} 抵達，但 ${fmt(w.open)} 才開門。`;
  if(visit>=w.close)return `⚠️ 營業時間衝突 · 預計 ${String(event.time).slice(0,5)} 抵達，但 ${fmt(w.close)} 已關門。`;
  return '';
}
function demoHoursConflict(event,dateString){
  if(!demoMode||window.TRAVEL_CONFIG?.tripSlug!=='iceland-2026'||dateString!=='2026-11-23')return '';
  if(/diamond beach|鑽石沙灘/i.test(String(event?.title||''))) return '⚠️ 營業時間有變動 · DEMO：原本 24 小時，最新改為 17:00 關閉；示範通知與球標。';
  return '';
}
function hoursChangeWarning(event){
  if(!event?.hoursChangePending)return '';
  const changed=event.hoursChangedAt?new Date(event.hoursChangedAt).toLocaleString():'最近';
  return `🔄 Google 營業時間有變動 · ${changed} 更新，請確認行程是否仍適用。`;
}
function tripPlaceAlerts(){
  const alerts=[];
  (TRIP?.days||[]).forEach((day,dayIndex)=>(day.events||[]).forEach((event,eventIndex)=>{
    const seen=new Set();
    for(const [kind,message] of [
      ['closed',eventClosedWarning(event,day.date)],
      ['conflict',eventHoursConflictWarning(event,day.date)],
      ['changed',hoursChangeWarning(event)],
      ['demo',demoHoursConflict(event,day.date)]
    ]){
      if(message&&!seen.has(message)){
        seen.add(message);
        alerts.push({kind,dayIndex,eventIndex,itemId:event.id,title:event.title,message});
      }
    }
  }));
  return alerts;
}

function renderTimelineEvent(e,eventIndex,d,dayIndex){
  const p=eventPresentation(e,d.date);
  const title=p.title||e.title||'';
  const subtitle=p.subtitle||e.subtitle||'';
  const note=p.note||'';
  const time=p.time??(e.time||'');
  let actionButton='';
  if(e.type==='flight'){
    const statusUrl=flightStatusUrl(e,d.date);
    if(statusUrl)actionButton='<button class="mini-btn flight-status-btn" type="button" onclick="event.stopPropagation();openFlightStatus('+dayIndex+','+eventIndex+')">航班動態 ↗</button>';
  }else if(hasNavigationTarget(e)){
    actionButton='<button class="mini-btn" onclick="event.stopPropagation();openMapsEvent('+dayIndex+','+eventIndex+')">導航</button>';
  }
  return `<div class="timeline-item" data-event-index="${eventIndex}">
    <div class="timeline-dot" aria-hidden="true"></div>
    <article class="timeline-card ${e.details?'expandable':''} ${e.uncertain?'uncertain-item':''} ${e.type==='flight'?'flight-event-card':''}" onclick="handleTimelineCardClick(event,${dayIndex},${eventIndex})">
      <div class="timeline-top"><div><div class="type">${typeLabel[e.type]||e.type}</div><h3>${escapeHtml(title)}</h3></div><div class="time">${escapeHtml(time)}</div></div>
      ${subtitle?`<div class="sub">${escapeHtml(subtitle)}</div>`:''}
      ${note?`<div class="note">${escapeHtml(note)}</div>`:''}
      ${eventClosedWarning(e,d.date)?`<div class="place-hours-warning">${eventClosedWarning(e,d.date)}</div>`:''}
      ${eventHoursConflictWarning(e,d.date)?`<div class="place-hours-warning hours-conflict-warning">${eventHoursConflictWarning(e,d.date)}</div>`:''}
      ${hoursChangeWarning(e)?`<div class="place-hours-warning hours-change-warning">${hoursChangeWarning(e)}</div>`:''}
      ${demoHoursConflict(e,d.date)?`<div class="place-hours-warning hours-conflict-warning">${demoHoursConflict(e,d.date)}</div>`:''}
      ${renderLinkedBookings(e,dayIndex,eventIndex,d.date)}
      ${renderEventDetails(e,dayIndex,eventIndex)}
      ${actionButton?`<div class="card-actions">${actionButton}</div>`:''}
    </article>
  </div>`;
}

function handleTimelineCardClick(ev,dayIndex,eventIndex){
  if(ev.target.closest('button,a,input')) return;
  const button=ev.currentTarget.querySelector('.detail-toggle');
  if(button) toggleEventDetails(dayIndex,eventIndex,button);
}

function hasNavigationTarget(e){
  if(!e) return false;
  return Boolean(
    String(e.navQuery||'').trim() ||
    String(e.address||'').trim() ||
    String(e.googleMapsResolvedUrl||'').trim() ||
    String(e.googleMapsUrl||'').trim() ||
    validCoord(e)
  );
}

function normalizedStayName(value){
  return String(value||'').normalize('NFKD').toLowerCase()
    .replace(/冰島|iceland|住宿|cottage(s)?|cabin|guesthouse|hotel|airbnb|booking\.com/g,'')
    .replace(/[·•,，.。/\\()（）\-_]/g,'').replace(/\s+/g,'').trim();
}

function findStayBooking(stay){
  if(!stay) return null;
  if(stay.reservationId){
    const idx=(TRIP.bookings||[]).findIndex(b=>b?.type==='stay'&&String(b.id||'')===String(stay.reservationId));
    if(idx>=0) return {b:TRIP.bookings[idx],idx};
  }
  const stayRaw=String(stay.title||'').normalize('NFKD').toLowerCase();
  const stayKey=normalizedStayName(stay.title);
  let best=null,bestScore=-1;
  (TRIP.bookings||[]).forEach((b,idx)=>{
    if(b?.type!=='stay') return;
    const raw=String(b.title||'').normalize('NFKD').toLowerCase();
    const key=normalizedStayName(b.title);
    let score=0;
    if(raw&&stayRaw&&(stayRaw.includes(raw)||raw.includes(stayRaw))) score+=100;
    if(key&&stayKey&&(stayKey.includes(key)||key.includes(stayKey))) score+=80;
    (key.match(/[a-z0-9à-ž]+/g)||[]).forEach(t=>{if(t.length>=3&&stayKey.includes(t))score+=8});
    if(score>bestScore){bestScore=score;best={b,idx}}
  });
  return bestScore>=16?best:null;
}

function bookingCoversNight(b,dateString){
  if(!b||b.type!=='stay'||!dateString)return false;
  const raw=b._raw||{};
  const start=String(raw.starts_at||b.imported?.startDate||'').slice(0,10);
  const end=String(raw.ends_at||b.imported?.endDate||'').slice(0,10);
  return Boolean(start&&end&&dateString>=start&&dateString<end);
}
function stayForNight(dayIndex){
  const day=TRIP.days?.[dayIndex];
  if(!day)return null;
  const explicit=[...(day.events||[])].reverse().find(e=>e.type==='stay');
  if(explicit)return explicit;

  const dateString=day.date;
  for(let i=dayIndex-1;i>=0;i--){
    const stays=[...(TRIP.days?.[i]?.events||[])].reverse().filter(e=>e.type==='stay');
    for(const stay of stays){
      const linked=eventBookings(stay);
      if(linked.some(({b})=>bookingCoversNight(b,dateString)))return stay;
      const fallback=findStayBooking(stay);
      if(fallback&&bookingCoversNight(fallback.b,dateString))return stay;
    }
  }

  const active=(TRIP.bookings||[]).map((b,idx)=>({b,idx})).filter(x=>bookingCoversNight(x.b,dateString));
  if(!active.length)return null;
  const first=active[0].b;
  return {
    type:'stay',
    title:first.title||'住宿',
    subtitle:'續住',
    note:'',
    reservationId:first.id||null,
    reservationIds:active.map(x=>x.b.id).filter(Boolean),
    lat:first._raw?.latitude??null,
    lng:first._raw?.longitude??null,
    address:first._raw?.address||'',
    navQuery:first._raw?.nav_query||'',
    googleMapsUrl:first._raw?.google_maps_url||'',
    googleMapsResolvedUrl:first._raw?.google_maps_resolved_url||''
  };
}
function tonightBookings(stay){
  const linked=eventBookings(stay);
  if(linked.length)return linked;
  const match=findStayBooking(stay);
  return match?[match]:[];
}
function renderTonightBookingPanel(b,idx,n){
  const d=b.details||{};
  const rows=(d.rows||[]).map(([label,value])=>`<div class="booking-detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  const amenities=(d.amenities||[]).length?`<div class="booking-detail-section"><div class="booking-detail-label">設備／包含</div><div class="amenity-chips">${d.amenities.map(x=>`<span>${escapeHtml(x)}</span>`).join('')}</div></div>`:'';
  const tips=(d.tips||[]).length?`<div class="booking-detail-section"><div class="booking-detail-label warn">注意事項</div><ul class="booking-tip-list">${d.tips.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul></div>`:'';
  const source=d.source?`<div class="booking-detail-source">資料來源：${escapeHtml(d.source)}</div>`:'';
  const alertHtml=b.alert?`<div class="alert-box">⚠️ ${escapeHtml(b.alert)}</div>`:'';
  const notice=b.notice?`<div class="notice">${escapeHtml(b.notice)}</div>`:'';
  const code=b.code?`<div class="booking-code"><div><small>CONFIRMATION</small><strong id="today-code-${idx}">${escapeHtml(maskCode(b.code,b.secret))}</strong></div><button class="reveal-btn" onclick="event.stopPropagation();toggleTodayCode(${idx})">顯示</button></div>`:'';
  return `<div class="booking-detail-panel stay-booking-panel"><div class="stay-booking-summary"><strong>BOOKING ${n} · ${escapeHtml(b.provider||'')}</strong><span>${escapeHtml(b.dates||'')}</span><span>${escapeHtml(b.meta||'')}</span></div>${code}${alertHtml}${notice}<div class="booking-detail-grid">${rows}</div>${amenities}${tips}${source}</div>`;
}
function renderTonightBooking(stay){
  const linked=tonightBookings(stay);
  if(!linked.length)return '';
  const panels=linked.map(({b,idx},n)=>renderTonightBookingPanel(b,idx,n+1)).join('');
  return `<div class="stay-booking-inline"><button class="booking-detail-toggle stay-booking-toggle" id="today-booking-toggle" type="button" onclick="event.stopPropagation();toggleTodayBookingDetails()"><span>預訂資訊 · ${linked.length} 筆</span><span class="detail-chevron">⌄</span></button><div class="stay-booking-list" id="today-booking-detail" hidden>${panels}</div></div>`;
}

function toggleTodayBookingDetails(){
  const panel=qs('#today-booking-detail'),btn=qs('#today-booking-toggle');
  if(!panel||!btn)return;
  const open=panel.hidden;panel.hidden=!open;btn.classList.toggle('open',open);
  const count=panel.querySelectorAll('.stay-booking-panel').length;
  const label=btn.querySelector('span:first-child');
  if(label)label.textContent=open?'收起預訂資訊':`預訂資訊 · ${count} 筆`;
}

function toggleTodayCode(idx){
  const b=(TRIP.bookings||[])[idx]; if(!b?.code) return;
  const el=qs('#today-code-'+idx); if(!el) return;
  const masked=maskCode(b.code,b.secret);
  el.textContent=el.textContent===masked?(b.secret?`${b.code} · PIN ${b.secret}`:b.code):masked;
}
function renderDayNote(d){
  const wrap=qs('#dayNoteWrap'),toggle=qs('#dayNoteToggle'),body=qs('#dayNoteBody');
  if(!wrap||!toggle||!body) return;
  const note=String(d?.short||'').trim();
  const visible=true;
  wrap.hidden=false;

  const icon=qs('#dayNoteIcon');
  if(icon) icon.innerHTML=iconSVG('dayNote');
  const preview=qs('#dayNotePreview');
  const text=qs('#dayNoteText');
  const editBtn=qs('#dayNoteEditBtn');
  if(preview) preview.textContent=note?note.replace(/\s+/g,' ').trim():'尚未新增今日備註';
  if(text) text.textContent=note||'尚未新增今日備註。';
  if(editBtn){
    editBtn.hidden=!(editMode&&canEditTrip());
    editBtn.textContent='✎ 編輯本日';
  }

  toggle.setAttribute('aria-expanded','false');
  wrap.classList.remove('open');
  body.hidden=true;
}

function toggleDayNote(){
  const wrap=qs('#dayNoteWrap'),toggle=qs('#dayNoteToggle'),body=qs('#dayNoteBody');
  if(!wrap||!toggle||!body) return;
  const open=toggle.getAttribute('aria-expanded')!=='true';
  toggle.setAttribute('aria-expanded',String(open));
  wrap.classList.toggle('open',open);
  body.hidden=!open;
}

function ensureDayNoteEditor(){
  let sheet=qs('#dayNoteEditSheet');
  if(sheet) return sheet;
  const backdrop=document.createElement('div');
  backdrop.className='modal-backdrop';
  backdrop.id='dayNoteEditBackdrop';
  sheet=document.createElement('aside');
  sheet.className='edit-sheet day-note-edit-sheet';
  sheet.id='dayNoteEditSheet';
  sheet.setAttribute('aria-hidden','true');
  sheet.innerHTML=`
    <div class="sheet-handle"></div>
    <div class="sheet-title">
      <div><span class="section-kicker">DAY NOTE</span><h2>編輯今日備註</h2></div>
      <button class="round-btn" id="closeDayNoteEdit">×</button>
    </div>
    <form class="edit-form" id="dayNoteEditForm">
      <input type="hidden" id="dayNoteEditDayIndex">
      <label><span>整日備註</span><textarea id="dayNoteEditText" rows="9" placeholder="例如：整天路線、備案、今天可能需要捨棄的景點、行車時間提醒…"></textarea></label>
      <div class="edit-form-actions">
        <button type="button" class="edit-delete" id="clearDayNote">清除</button>
        <button type="submit" class="edit-save">儲存</button>
      </div>
      <p class="edit-status" id="dayNoteEditStatus"></p>
    </form>`;
  document.body.append(backdrop,sheet);
  const close=()=>{
    sheet.classList.remove('show');
    backdrop.classList.remove('show');
    sheet.setAttribute('aria-hidden','true');
  };
  qs('#closeDayNoteEdit').onclick=close;
  backdrop.onclick=close;
  qs('#clearDayNote').onclick=()=>{qs('#dayNoteEditText').value=''};
  qs('#dayNoteEditForm').onsubmit=saveDayNoteEditor;
  return sheet;
}

function openDayNoteEditor(dayIndex=selectedDay){
  if(!canEditTrip()) return;
  const d=TRIP.days?.[dayIndex];
  if(!d?.id) return;
  const sheet=ensureDayNoteEditor();
  qs('#dayNoteEditDayIndex').value=String(dayIndex);
  qs('#dayNoteEditText').value=d.short||'';
  qs('#dayNoteEditStatus').textContent='';
  qs('#dayNoteEditBackdrop').classList.add('show');
  sheet.classList.add('show');
  sheet.setAttribute('aria-hidden','false');
  setTimeout(()=>qs('#dayNoteEditText')?.focus(),60);
}

async function saveDayNoteEditor(e){
  e.preventDefault();
  const dayIndex=Number(qs('#dayNoteEditDayIndex').value);
  const d=TRIP.days?.[dayIndex];
  if(!d?.id) return;
  const short=qs('#dayNoteEditText').value.trim();
  const status=qs('#dayNoteEditStatus');
  status.textContent='儲存中…';
  try{
    await travelEditor('save_day',{day:{
      id:d.id,baseVersion:d.version,date:d.date,label:d.label,name:d.name,short,
      heroImageUrl:d.heroImageUrl,km:d.km,driveMinutes:d.driveMinutes,
      departureTime:d.departureTime||'',sunrise:d.sunrise,sunset:d.sunset
    }});
    qs('#dayNoteEditSheet').classList.remove('show');
    qs('#dayNoteEditBackdrop').classList.remove('show');
    await hydratePrivateCloudData();
  }catch(err){
    if(err.code==='version_conflict'){
      status.textContent='本日資料已被其他裝置更新，正在重新載入…';
      await hydratePrivateCloudData();
      return;
    }
    status.textContent='儲存失敗：'+(err.code||err.message);
  }
}

function renderToday(){
  const d=currentDay();
  const dayIndex=selectedDay;
  const ui=dayUi(d);
  const context=dayContext(d.date);
  const weekday=d.date?new Intl.DateTimeFormat('en-US',{weekday:'short',timeZone:'UTC'}).format(new Date(d.date+'T00:00:00Z')).toUpperCase():'';
  qs('#heroDay').textContent=`${d.label} · ${String(d.date||'').slice(5).replace('-','/')} ${weekday}`.trim();
  qs('#heroTitle').textContent=derivedDayTitle(d,dayIndex);
  const rel=qs('#heroRelativeLabel');
  if(rel) rel.textContent=context.label;
  const heading=qs('#timelineHeading');
  if(heading) heading.textContent=`${context.timelineLabel||context.label}行程`;
  qs('#todayView').classList.toggle('past-day',context.isPast);
  const hero=qs('#heroCard');
  hero.style.setProperty('--hero-photo',ui.photo);
  hero.style.backgroundImage=ui.photo;
  hero.dataset.heroSource=d.heroImageUrl?'manual':'fallback';
  hero.dataset.heroSubject='';
  refreshHeroPhoto(dayIndex);
  qs('#todayKm').textContent=`${d.km} km`;
  qs('#todayDrive').textContent=driveText(d);
  const sun=sunTimesForDay(dayIndex);
  qs('#todaySunrise').textContent=sun.sunrise;
  qs('#todaySunset').textContent=sun.sunset;
  qs('#weatherTemp').textContent='--°';
  qs('#weatherLabel').textContent='讀取中';
  renderDayNote(d);
  const weatherIcon=qs('#weatherIconWrap');
  if(weatherIcon) weatherIcon.innerHTML=iconSVG('weatherUnknown');
  const prevStay=dayIndex>0?stayForNight(dayIndex-1):null;
  const firstEvent=d.events[0]||null;
  const firstIsSameOriginDrive=Boolean(prevStay&&firstEvent?.type==='drive'&&validCoord(firstEvent)&&Math.abs(firstEvent.lat-prevStay.lat)<1e-6&&Math.abs(firstEvent.lng-prevStay.lng)<1e-6);
  const overnightDeparture=(prevStay&&!firstIsSameOriginDrive)
    ? `<div class="timeline-item timeline-route-origin"><div class="timeline-dot" aria-hidden="true"></div><article class="timeline-card"><div class="timeline-top"><div><div class="type">移動</div><h3>${escapeHtml(prevStay.title)} 出發</h3></div><div class="time">${escapeHtml(d.departureTime||'')}</div></div><div class="sub">前一晚住宿 · 今日路線起點</div>${hasNavigationTarget(prevStay)?`<div class="card-actions"><button class="mini-btn" onclick="event.stopPropagation();window.open('https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(prevStay.navQuery||prevStay.address||`${prevStay.lat},${prevStay.lng}`)}&travelmode=driving','_blank','noopener')">導航</button></div>`:''}</article></div>`
    : '';
  qs('#timeline').innerHTML=overnightDeparture+d.events.map((e,eventIndex)=>renderTimelineEvent(e,eventIndex,d,selectedDay)).join('');
  const stay=stayForNight(dayIndex);
  qs('#tonightCard').innerHTML=stay?`<div class="stay-card"><div class="stay-top"><div><span class="section-kicker">TONIGHT</span><h3>${escapeHtml(stay.title||'')}</h3><p>${escapeHtml(stay.subtitle||'')}</p></div></div>${stay.note?`<p style="margin-top:10px">${escapeHtml(stay.note)}</p>`:''}${renderTonightBooking(stay)}</div>`:`<div class="stay-card"><p>今晚沒有住宿資料。</p></div>`;
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
    // Sunrise/sunset are astronomical values from date + location and do not wait for forecast.
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
  const coord=validCoord(e)?`${e.lat},${e.lng}`:'';
  const destination=String(e.navQuery||e.address||coord||e.title||'').trim();
  if(!destination) return;
  const url=`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
  window.open(url,'_blank','noopener');
}

function initMap(){
  if(map) return;
  map=L.map('map',{zoomControl:false,preferCanvas:true}).setView([32.8031,130.7079],8);
  L.control.zoom({position:'bottomright'}).addTo(map);

  // Use Leaflet raster tiles directly. The previous MapLibre bridge could
  // occasionally render as a blank/grey canvas on Android WebView/PWA.
  const base=L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,
    attribution:'&copy; OpenStreetMap contributors',
    updateWhenIdle:false,
    keepBuffer:3
  });
  let tileErrors=0;
  base.on('tileerror',()=>{
    tileErrors++;
    if(tileErrors===4) console.warn('Basemap tiles are failing to load.');
  });
  base.addTo(map);
}

function markerIcon(label,car=false){
  const markerContent=car?iconSVG('car'):escapeHtml(label);
  return L.divIcon({className:'',html:`<div class="custom-marker ${car?'car':''}"><div></div><span>${markerContent}</span></div>`,iconSize:[34,42],iconAnchor:[17,38]});
}

function hasExplicitRouteLocation(e){
  if(!e) return false;
  return Boolean(
    String(e.navQuery||'').trim() ||
    String(e.address||'').trim() ||
    String(e.googleMapsUrl||'').trim() ||
    String(e.googleMapsResolvedUrl||'').trim() ||
    String(e.reservationId||'').trim()
  );
}

function isRouteStop(e){
  if(!e||e.uncertain||!validCoord(e)) return false;

  // "drive" cards imported from the old spreadsheet sometimes carried only
  // a rough region coordinate so the prototype map had something to draw.
  // They are movement notes, not real destinations.  Never send those coarse
  // placeholder coordinates to OSRM / Google Maps unless the item has an
  // explicit navigation source (Maps link, address, nav query or reservation).
  if(e.type==='drive'&&!hasExplicitRouteLocation(e)) return false;

  return true;
}

function getRouteStops(d){
  const dayIndex=TRIP.days.indexOf(d);
  const raw=d.events.filter(isRouteStop);

  // Start: previous night's accommodation, including multi-night stays that
  // do not have a duplicated stay itinerary row on the following day.
  if(dayIndex>0){
    const prev=TRIP.days[dayIndex-1];
    const overnight=stayForNight(dayIndex-1);
    if(overnight&&!overnight.uncertain&&validCoord(overnight)){
      const first=raw[0];
      if(!first||Math.abs(first.lat-overnight.lat)>1e-6||Math.abs(first.lng-overnight.lng)>1e-6){
        raw.unshift({...overnight,_routeCarryover:true,_routeCarryoverFrom:prev?.label||''});
      }
    }
  }

  // End: tonight's accommodation. This is important on the second night of
  // a multi-night stay: the route should return to the same hotel even though
  // there is no duplicate stay itinerary item for that date.
  const tonight=stayForNight(dayIndex);
  if(tonight&&!tonight.uncertain&&validCoord(tonight)){
    const last=raw[raw.length-1];
    if(!last||Math.abs(last.lat-tonight.lat)>1e-6||Math.abs(last.lng-tonight.lng)>1e-6){
      raw.push({...tonight,_routeReturnStay:true,_routeReturnDay:d.label});
    }
  }

  // Only collapse adjacent duplicates. If a day starts and ends at the same
  // hotel with real stops in between, both hotel points are intentionally kept.
  const out=[];
  for(const e of raw){
    const last=out[out.length-1];
    if(!last||Math.abs(last.lat-e.lat)>1e-6||Math.abs(last.lng-e.lng)>1e-6) out.push(e);
  }
  return out;
}

function googleRoutePoint(stop){
  if(!stop) return '';
  // Coordinates are the most deterministic cross-device representation.
  if(Number.isFinite(stop.lat)&&Number.isFinite(stop.lng)) return `${stop.lat},${stop.lng}`;
  return String(stop.navQuery||stop.address||stop.title||'').trim();
}

function buildGoogleMapsDayRouteUrl(dayIndex){
  const d=TRIP.days?.[dayIndex];
  if(!d) return '';
  const stops=getRouteStops(d).filter(s=>googleRoutePoint(s));
  if(stops.length<2) return '';

  const origin=googleRoutePoint(stops[0]);
  const destination=googleRoutePoint(stops[stops.length-1]);
  const waypoints=stops.slice(1,-1).map(googleRoutePoint).filter(Boolean);

  const params=new URLSearchParams({
    api:'1',
    origin,
    destination,
    travelmode:'driving'
  });
  if(waypoints.length) params.set('waypoints',waypoints.join('|'));
  return 'https://www.google.com/maps/dir/?'+params.toString();
}

function openGoogleDayRoute(){
  const indices=sortedMapDays().length?sortedMapDays():[selectedDay];
  if(indices.length!==1){
    alert('Google 路線一次匯出一天。請先切回單日模式。');
    return;
  }
  const dayIndex=indices[0];
  const stops=getRouteStops(TRIP.days[dayIndex]);
  if(stops.length<2){
    alert('這一天至少需要 2 個有座標的地點才能建立 Google 路線。');
    return;
  }
  const url=buildGoogleMapsDayRouteUrl(dayIndex);
  if(!url) return;
  window.open(url,'_blank','noopener');
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
    segmentDistancesKm:(route.legs||[]).map(leg=>Number(leg.distance||0)/1000),
    segmentDurationsSec:(route.legs||[]).map(leg=>Number(leg.duration||0)),
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

function setRouteGeometry(points,totalKm=null,stopPoints=[],segmentDistancesKm=null,segmentDurationsSec=null,totalDurationSec=null){
  routeGeometry=points||[];
  routeCumulative=[];
  let total=0;
  for(let i=0;i<routeGeometry.length;i++){
    if(i) total+=haversineKm(routeGeometry[i-1],routeGeometry[i]);
    routeCumulative.push(total);
  }
  routeTotalKm=Number.isFinite(totalKm)?totalKm:total;
  routeStopFractions=[];
  routeSegmentDistancesKm=[];
  routeSegmentDurationsSec=[];
  routeTotalDurationSec=Number.isFinite(Number(totalDurationSec))?Math.max(0,Number(totalDurationSec)):0;

  const supplied=Array.isArray(segmentDistancesKm)?segmentDistancesKm.map(Number):[];
  const suppliedDurations=Array.isArray(segmentDurationsSec)?segmentDurationsSec.map(Number):[];
  const validSupplied=stopPoints.length>=2
    && supplied.length===stopPoints.length-1
    && supplied.every(v=>Number.isFinite(v)&&v>=0)
    && supplied.reduce((a,b)=>a+b,0)>0;

  if(validSupplied){
    const legTotal=supplied.reduce((a,b)=>a+b,0);
    let acc=0;
    routeStopFractions=[0];
    routeSegmentDistancesKm=[...supplied];
    if(suppliedDurations.length===supplied.length && suppliedDurations.every(v=>Number.isFinite(v)&&v>=0)){
      routeSegmentDurationsSec=[...suppliedDurations];
      if(!routeTotalDurationSec) routeTotalDurationSec=suppliedDurations.reduce((a,b)=>a+b,0);
    }
    for(const km of supplied){
      acc+=km;
      routeStopFractions.push(Math.min(1,acc/legTotal));
    }
    routeStopFractions[routeStopFractions.length-1]=1;
    return;
  }

  const denom=routeCumulative[routeCumulative.length-1]||1;
  for(const stop of stopPoints){
    let best=0,bestDist=Infinity;
    for(let i=0;i<routeGeometry.length;i++){
      const dist=(routeGeometry[i][0]-stop[0])**2+(routeGeometry[i][1]-stop[1])**2;
      if(dist<bestDist){bestDist=dist;best=i}
    }
    routeStopFractions.push((routeCumulative[best]||0)/denom);
  }
  for(let i=0;i<routeStopFractions.length-1;i++){
    routeSegmentDistancesKm.push(Math.max(0,(routeStopFractions[i+1]-routeStopFractions[i])*routeTotalKm));
  }
}

function formatRouteKm(km){
  const n=Math.max(0,Number(km)||0);
  return n>=100?String(Math.round(n)):n.toFixed(1);
}

function formatRouteMinutes(durationSec){
  return `${Math.max(0,Math.round((Number(durationSec)||0)/60))} min`;
}

function updateRouteMetricToggle(){
  const btn=qs('#routeMetricToggle');
  if(!btn) return;
  btn.dataset.mode=routeMetricMode;
  btn.setAttribute('aria-label',routeMetricMode==='distance'?'目前顯示公里，點擊切換成分鐘':'目前顯示分鐘，點擊切換成公里');
  qsa('#routeMetricToggle [data-route-metric]').forEach(el=>{
    el.classList.toggle('active',el.dataset.routeMetric===routeMetricMode);
  });
}

function updateRouteProgressMetric(t=0){
  const progress=Math.max(0,Math.min(1,Number(t)||0));
  const value=qs('#routeDistance');
  const suffix=qs('#routeDistanceSuffix');
  if(!value||!suffix) return;
  if(routeMetricMode==='time' && routeTotalDurationSec>0){
    value.textContent=String(Math.round(routeTotalDurationSec*progress/60));
    suffix.innerHTML=` / <span id="routeTotal">${Math.round(routeTotalDurationSec/60)}</span> min`;
  }else{
    const km=routeTotalKm*progress;
    value.textContent=km<100?km.toFixed(1):String(Math.round(km));
    suffix.innerHTML=` / <span id="routeTotal">${routeTotalKm<100?routeTotalKm.toFixed(1):Math.round(routeTotalKm)}</span> km`;
  }
}

function setRouteMetricMode(mode){
  routeMetricMode=mode==='time'?'time':'distance';
  try{localStorage.setItem('travelRouteMetric',routeMetricMode)}catch(_){}
  updateRouteMetricToggle();
  if(routeScaleState){
    renderRouteScale(
      routeScaleState.stops,
      routeScaleState.segments,
      routeScaleState.totalKm,
      {
        approx:routeScaleState.approx,
        durations:routeScaleState.durations,
        totalDurationSec:routeScaleState.totalDurationSec
      }
    );
  }
  updateRouteProgressMetric((+qs('#routeSlider')?.value||0)/100);
}

function toggleRouteMetric(){
  setRouteMetricMode(routeMetricMode==='distance'?'time':'distance');
}

function setRouteScaleMessage(message){
  const el=qs('#routeStops');
  if(!el) return;
  el.innerHTML=`<div class="route-scale-message">${escapeHtml(message)}</div>`;
}

function renderRouteScale(stops,segments=routeSegmentDistancesKm,totalKm=routeTotalKm,{approx=false,durations=routeSegmentDurationsSec,totalDurationSec=routeTotalDurationSec}={}){
  const el=qs('#routeStops');
  if(!el) return;
  if(!Array.isArray(stops)||stops.length<2){
    routeScaleState=null;
    setRouteScaleMessage(stops?.length?'只有一個路線點':'沒有可用的路線點');
    return;
  }

  let seg=Array.isArray(segments)?segments.map(Number):[];
  if(seg.length!==stops.length-1||!seg.every(v=>Number.isFinite(v)&&v>=0)||seg.reduce((a,b)=>a+b,0)<=0){
    seg=[];
    for(let i=0;i<stops.length-1;i++){
      seg.push(haversineKm([stops[i].lat,stops[i].lng],[stops[i+1].lat,stops[i+1].lng]));
    }
  }
  const segTotal=seg.reduce((a,b)=>a+b,0)||1;
  const displayTotal=Number.isFinite(Number(totalKm))&&Number(totalKm)>0?Number(totalKm):segTotal;

  let dur=Array.isArray(durations)?durations.map(Number):[];
  let displayTotalDuration=Number.isFinite(Number(totalDurationSec))&&Number(totalDurationSec)>0?Number(totalDurationSec):0;
  const validDurations=dur.length===seg.length && dur.every(v=>Number.isFinite(v)&&v>=0) && dur.reduce((a,b)=>a+b,0)>0;
  if(validDurations){
    if(!displayTotalDuration) displayTotalDuration=dur.reduce((a,b)=>a+b,0);
  }else if(displayTotalDuration>0){
    // Before the routing response arrives, keep the time view usable by distributing
    // the day's known total drive time in proportion to the fallback leg distances.
    dur=seg.map(km=>displayTotalDuration*(Math.max(0,km)/segTotal));
  }else{
    dur=seg.map(()=>0);
  }

  routeScaleState={
    stops,
    segments:[...seg],
    totalKm:displayTotal,
    approx:Boolean(approx),
    durations:[...dur],
    totalDurationSec:displayTotalDuration
  };

  const prefix=approx?'≈':'';
  const kmLabels=seg.map(km=>`${prefix}${formatRouteKm(km)} km`);
  const timeLabels=dur.map(sec=>`${prefix}${formatRouteMinutes(sec)}`);
  const activeLabels=routeMetricMode==='time'?timeLabels:kmLabels;

  // Readability scale: every leg reserves enough room for the longest label it can
  // show (KM or MIN), then any remaining width is distributed proportionally.
  // This keeps every label on one horizontal baseline without sacrificing the
  // longer-leg visual relationship.
  const wrapWidth=Math.max(240,Number(qs('#routeScaleWrap')?.clientWidth||el.clientWidth||360));
  const edgeInsetPx=window.innerWidth<=420?20:22;
  const trackWidth=Math.max(180,wrapWidth-edgeInsetPx*2);
  const charPx=window.innerWidth<=420?5.0:5.6;
  const minWidths=seg.map((_,i)=>{
    const longest=Math.max(kmLabels[i].length,timeLabels[i].length);
    return Math.max(46,Math.ceil(longest*charPx+14));
  });
  const wanted=minWidths.reduce((a,b)=>a+b,0);
  const fitScale=wanted>trackWidth?trackWidth/wanted:1;
  const reservedWidths=minWidths.map(px=>px*fitScale);
  const reserved=reservedWidths.reduce((a,b)=>a+b,0);
  const flexible=Math.max(0,trackWidth-reserved);
  const displaySegPx=seg.map((km,i)=>reservedWidths[i]+flexible*(Math.max(0,km)/segTotal));

  const positions=[0];
  let displayAcc=0;
  for(const px of displaySegPx){
    displayAcc+=px;
    positions.push(Math.min(100,(displayAcc/trackWidth)*100));
  }
  positions[positions.length-1]=100;

  const labels=activeLabels.map((label,i)=>{
    const left=(positions[i]+positions[i+1])/2;
    return `<span class="route-segment-label" style="left:${left.toFixed(3)}%">${label}</span>`;
  }).join('');

  const realStopProgress=(()=>{
    if(routeStopFractions.length===stops.length){
      return routeStopFractions.map(v=>Math.max(0,Math.min(100,Number(v||0)*100)));
    }
    const out=[0];
    let acc=0;
    for(const km of seg){
      acc+=Math.max(0,Number(km)||0);
      out.push(Math.min(100,(acc/segTotal)*100));
    }
    if(out.length) out[out.length-1]=100;
    return out;
  })();

  const nodes=positions.map((p,i)=>{
    const title=escapeHtml(stops[i]?.title?.split('\n')[0]||`Stop ${i+1}`);
    const edge=i===0?' edge-start':(i===positions.length-1?' edge-end':'');
    const target=Number(realStopProgress[i]??p);
    return `<button type="button" class="route-node${i===0?' current':''}${edge}" data-route-node="${i}" data-route-progress="${p.toFixed(3)}" data-route-target="${target.toFixed(3)}" data-route-name="${title}" style="left:${p.toFixed(3)}%" aria-label="${title}"><b>${i+1}</b><span class="route-node-tooltip">${title}</span></button>`;
  }).join('');

  el.innerHTML=`<div class="route-scale" data-approx="${approx?'1':'0'}" data-metric="${routeMetricMode}">
    <div class="route-track-area">
      <div class="route-track"><div class="route-track-progress"></div></div>
      ${nodes}
      ${labels}
    </div>
  </div>`;

  qsa('.route-node').forEach(node=>{
    node.addEventListener('click',e=>{
      e.preventDefault();e.stopPropagation();
      clearRouteTimer();
      qsa('.route-node.show-name').forEach(other=>other.classList.remove('show-name'));
      node.classList.add('show-name');

      // Jump directly to the real route position for this stop. The ruler uses
      // readability-adjusted visual spacing, so never use the visual left % as
      // the car/slider target.
      const target=Math.max(0,Math.min(100,Number(node.dataset.routeTarget||0)));
      if(qs('#routeSlider')) qs('#routeSlider').value=target;
      updateRouteAt(target);
    });
    node.addEventListener('focus',()=>node.classList.add('show-name'));
    node.addEventListener('blur',()=>node.classList.remove('show-name'));
  });

  updateRouteMetricToggle();
  updateRouteScaleProgress(+qs('#routeSlider')?.value||0);
}

function updateRouteScaleProgress(v){
  const pct=Math.max(0,Math.min(100,Number(v)||0));
  const nodes=qsa('.route-node');
  let current=-1;

  // Convert real route progress to the ruler's adjusted visual position so the
  // fill, active node and car stay synchronized even when short legs are widened.
  let visualPct=pct;
  if(nodes.length>=2){
    const target=nodes.map(node=>Math.max(0,Math.min(100,Number(node.dataset.routeTarget||0))));
    const visual=nodes.map(node=>Math.max(0,Math.min(100,Number(node.dataset.routeProgress||0))));
    if(pct<=target[0]) visualPct=visual[0];
    else if(pct>=target[target.length-1]) visualPct=visual[visual.length-1];
    else{
      for(let i=0;i<target.length-1;i++){
        if(pct<=target[i+1]+0.0001){
          const span=Math.max(0.0001,target[i+1]-target[i]);
          const f=Math.max(0,Math.min(1,(pct-target[i])/span));
          visualPct=visual[i]+(visual[i+1]-visual[i])*f;
          break;
        }
      }
    }
  }

  const progress=qs('.route-track-progress');
  if(progress) progress.style.width=`${visualPct}%`;

  nodes.forEach((node,i)=>{
    const target=Number(node.dataset.routeTarget||0);
    const passed=target<=pct+0.001;
    node.classList.toggle('passed',passed);
    if(passed) current=i;
    node.classList.remove('current');
  });
  if(current>=0) nodes[current]?.classList.add('current');
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
    setRouteScaleMessage('請先由 Owner / Editor 新增行程日。');
    return;
  }
  const token=++routeRenderToken;
  const indices=sortedMapDays().length?sortedMapDays():[selectedDay];
  const isMulti=indices.length>1;
  const singleIndex=indices[0];
  const singleDay=TRIP.days[singleIndex];
  const fallbackTotals=selectionFallbackTotals(indices);

  qs('#mapDayLabel').textContent=isMulti?`${indices.length}天`:singleDay.label;
  qs('#mapDayName').textContent=isMulti?(indices.length===TRIP.days.length?'全程路線':'多日路線'):derivedDayTitle(singleDay,singleIndex);
  clearMapTripLayers();

  qs('#playRoute').disabled=isMulti;
  qs('#playRoute').textContent=isMulti?'多日總覽':'▶ 跟著走';
  const googleRouteBtn=qs('#exportGoogleRoute');
  if(googleRouteBtn){
    googleRouteBtn.disabled=isMulti;
    googleRouteBtn.title=isMulti?'請先切回單日模式':'用今天所有地圖點建立 Google Maps 路線';
  }
  qs('#routePanel').classList.toggle('multi-mode',isMulti);
  qs('#routeSlider').disabled=isMulti;
  qs('#routeSlider').value=0;
  qs('#routeDistance').textContent='0';
  qs('#routeDistanceSuffix').innerHTML=isMulti?' km':` / <span id="routeTotal">${Math.round(singleDay.km)}</span> km`;
  updateMapRangeText(indices,fallbackTotals.km,fallbackTotals.sec);
  routeGeometry=[]; routeCumulative=[]; routeStopFractions=[]; routeSegmentDistancesKm=[]; routeSegmentDurationsSec=[]; routeTotalKm=0; routeTotalDurationSec=0; routeScaleState=null;

  const bounds=L.latLngBounds([]);
  const fallbackLayers=new Map();

  indices.forEach(dayIndex=>{
    const d=TRIP.days[dayIndex];
    const stops=getRouteStops(d);
    stops.forEach((e,i)=>{
      const eventIndex=d.events.indexOf(e);
      const label=isMulti?`${dayIndex}·${i+1}`:`${i+1}`;
      const m=L.marker([e.lat,e.lng],{icon:markerIcon(label),tripMarker:true}).addTo(map);
      const carry=e._routeCarryover===true;
      const navButton=carry
        ? `<button class="popup-nav" onclick="window.open('https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(e.navQuery||e.address||`${e.lat},${e.lng}`)}&travelmode=driving','_blank','noopener')">Google 導航</button>`
        : `<button class="popup-nav" onclick="openMapsEvent(${dayIndex},${eventIndex})">Google 導航</button>`;
      const meta=carry?`${d.label} 起點 · 前晚住宿`:`${d.label} · ${e.time||''}`;
      m.bindPopup(`<b>${meta} ${e.title}</b><br><span style="font-size:11px">${e.subtitle||''}</span><br>${navButton}`);
      bounds.extend([e.lat,e.lng]);
    });
    const fallbackPoints=stops.map(e=>[e.lat,e.lng]);
    if(fallbackPoints.length){
      const layer=L.polyline(fallbackPoints,{color:routeColor(dayIndex),weight:isMulti?4:4,opacity:.58,dashArray:'8,7'}).addTo(map);
      fallbackLayers.set(dayIndex,layer);
      mapRouteLayers.push(layer);
      fallbackPoints.forEach(pt=>bounds.extend(pt));
      if(!isMulti){
        setRouteGeometry(fallbackPoints,d.km,fallbackPoints,null,null,Number(d.driveMinutes)?Number(d.driveMinutes)*60:parseDriveSeconds(d.drive));
        routeCar=L.marker(fallbackPoints[0],{icon:markerIcon('',true),zIndexOffset:1000}).addTo(map);
      }
    }
  });

  if(bounds.isValid()){
    const uniquePoints=[];
    indices.forEach(dayIndex=>getRouteStops(TRIP.days[dayIndex]).forEach(e=>{
      const key=`${Number(e.lat).toFixed(6)},${Number(e.lng).toFixed(6)}`;
      if(!uniquePoints.some(x=>x.key===key))uniquePoints.push({key,lat:e.lat,lng:e.lng});
    }));
    if(uniquePoints.length===1)map.setView([uniquePoints[0].lat,uniquePoints[0].lng],13);
    else map.fitBounds(bounds,{padding:[28,28],maxZoom:14});
  }

  if(isMulti){
    qs('#routeCurrent').textContent=`已選 ${indices.length} 天`;
    qs('#routeMeta').textContent=indices.map(i=>TRIP.days[i].label).join(' · ');
    qs('#routeDistance').textContent=fallbackTotals.km.toFixed(1);
    setRouteScaleMessage(`合計估算 · ${fallbackTotals.km.toFixed(1)} km · ${formatDriveTime(fallbackTotals.sec)} · 正在更新道路路線…`);
  }else{
    const stops=getRouteStops(singleDay);
    renderRouteScale(stops,routeSegmentDistancesKm,routeTotalKm,{approx:true});
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
        setRouteGeometry(
          road.points,
          road.distanceKm,
          road.snapped.length?road.snapped:stops.map(e=>[e.lat,e.lng]),
          road.segmentDistancesKm,
          road.segmentDurationsSec,
          road.durationSec
        );
        renderRouteScale(stops,road.segmentDistancesKm,road.distanceKm,{durations:road.segmentDurationsSec,totalDurationSec:road.durationSec});
        updateRouteAt(+qs('#routeSlider').value);
      }
    }catch(err){
      console.warn(`Road routing unavailable for ${d.label}; keeping fallback.`,err);
      results.push({dayIndex,road:null});
    }
  }

  if(token!==routeRenderToken) return;
  if(bounds.isValid()){
    const pointCount=indices.reduce((n,dayIndex)=>n+getRouteStops(TRIP.days[dayIndex]).length,0);
    if(pointCount>1)map.fitBounds(bounds,{padding:[28,28],maxZoom:14});
  }

  if(isMulti){
    let totalKm=0,totalSec=0;
    for(const {dayIndex,road} of results){
      if(road){totalKm+=road.distanceKm;totalSec+=road.durationSec}
      else{totalKm+=Number(TRIP.days[dayIndex].km)||0;totalSec+=parseDriveSeconds(TRIP.days[dayIndex].drive)}
    }
    qs('#routeDistance').textContent=totalKm.toFixed(1);
    setRouteScaleMessage(`${indices.length} 天合計 · 約 ${totalKm.toFixed(1)} km · ${formatDriveTime(totalSec)} · `+indices.map(i=>TRIP.days[i].label).join(' + '));
    updateMapRangeText(indices,totalKm,totalSec);
  }else if(!results[0]?.road){
    const d=singleDay,stops=getRouteStops(d);
    renderRouteScale(stops,routeSegmentDistancesKm,routeTotalKm,{approx:true});
    qs('#routeMeta').textContent=`${d.label} · 離線備援距離`;
  }
}

function updateRouteAt(v){
  const indices=sortedMapDays();
  if(indices.length!==1||!map||!routeGeometry.length||!routeCar) return;
  const d=TRIP.days[indices[0]], stops=getRouteStops(d), t=v/100, pos=positionAlongRoute(t);
  if(pos) routeCar.setLatLng(pos);
  const idx=currentStopIndex(t,stops), stop=stops[idx]||stops[0];
  qs('#routeCurrent').textContent=stop?stop.title.split('\n')[0]:derivedDayTitle(d,selectedDay);
  qs('#routeMeta').textContent=`${d.label} · ${stop?.time||''}`;
  qs('#routeSlider').value=v;
  updateRouteProgressMetric(t);
  updateRouteScaleProgress(v);
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
  const rows=(d.rows||[]).map(([label,value])=>`<div class="booking-detail-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
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

const AIRPORT_COORDS={
  KEF:{name:'Keflavík International Airport',lat:63.985,lng:-22.6056},
  KMJ:{name:'熊本機場',lat:32.8373,lng:130.8551},
  KHH:{name:'高雄國際機場',lat:22.5771,lng:120.3500}
};
function arrivalAirportForDay(day){
  const flight=(day?.events||[]).find(e=>e?.type==='flight');
  const text=String(flight?.title||'');
  const route=text.match(/\b([A-Z]{3})\s*(?:→|->|›|–|-)\s*([A-Z]{3})\b/i);
  const code=(route?.[2]||'').toUpperCase();
  return code&&AIRPORT_COORDS[code]?AIRPORT_COORDS[code]:null;
}
function sunLocationForDay(dayIndex){
  const day=TRIP.days?.[dayIndex];
  if(!day)return null;
  // Arrival day: sunrise/sunset follows the landing point when known.
  if(dayIndex===0){
    const airport=arrivalAirportForDay(day);
    if(airport)return airport;
  }
  // Travel days: use the previous night's accommodation as the local base.
  if(dayIndex>0){
    const previousNight=stayForNight(dayIndex-1);
    if(previousNight&&validCoord(previousNight)){
      return {name:previousNight.title||'前一晚住宿',lat:previousNight.lat,lng:previousNight.lng};
    }
  }
  const first=(day.events||[]).find(validCoord);
  if(first)return {name:first.title||derivedDayTitle(day,dayIndex),lat:first.lat,lng:first.lng};
  if(TRIP?.slug==='iceland-2026')return WEATHER_LOCATIONS[day.label]||null;
  if(TRIP?.slug==='kumamoto-2027')return {name:'熊本',lat:32.8031,lng:130.7079};
  return null;
}
function dayOfYearUTC(dateString){
  const [y,m,d]=String(dateString).split('-').map(Number);
  const start=Date.UTC(y,0,0),current=Date.UTC(y,m-1,d);
  return Math.floor((current-start)/86400000);
}
function normalizeDegrees(v){return ((v%360)+360)%360}
function timezoneOffsetMinutes(dateString,timeZone){
  try{
    const ref=new Date(`${dateString}T12:00:00Z`);
    const parts=new Intl.DateTimeFormat('en-CA',{timeZone:timeZone||'UTC',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(ref);
    const get=t=>Number(parts.find(p=>p.type===t)?.value||0);
    const localAsUtc=Date.UTC(get('year'),get('month')-1,get('day'),get('hour'),get('minute'),get('second'));
    return Math.round((localAsUtc-ref.getTime())/60000);
  }catch(_){return 0}
}
function solarTimeLocal(dateString,lat,lng,isSunrise,timeZone){
  const n=dayOfYearUTC(dateString);
  const lngHour=lng/15;
  const t=n+(((isSunrise?6:18)-lngHour)/24);
  const m=0.9856*t-3.289;
  let l=m+1.916*Math.sin(m*Math.PI/180)+0.020*Math.sin(2*m*Math.PI/180)+282.634;
  l=normalizeDegrees(l);
  let ra=Math.atan(0.91764*Math.tan(l*Math.PI/180))*180/Math.PI;
  ra=normalizeDegrees(ra);
  const lQuadrant=Math.floor(l/90)*90,raQuadrant=Math.floor(ra/90)*90;
  ra=(ra+(lQuadrant-raQuadrant))/15;
  const sinDec=0.39782*Math.sin(l*Math.PI/180);
  const cosDec=Math.cos(Math.asin(sinDec));
  const cosH=(Math.cos(90.833*Math.PI/180)-sinDec*Math.sin(lat*Math.PI/180))/(cosDec*Math.cos(lat*Math.PI/180));
  if(cosH>1||cosH<-1)return '--:--';
  let h=(isSunrise?360-Math.acos(cosH)*180/Math.PI:Math.acos(cosH)*180/Math.PI)/15;
  const localMean=h+ra-0.06571*t-6.622;
  let utc=localMean-lngHour;
  utc=((utc%24)+24)%24;
  const offset=timezoneOffsetMinutes(dateString,timeZone)/60;
  let local=((utc+offset)%24+24)%24;
  let hour=Math.floor(local),minute=Math.round((local-hour)*60);
  if(minute===60){minute=0;hour=(hour+1)%24}
  return String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');
}
function sunTimesForDay(dayIndex){
  const day=TRIP.days?.[dayIndex],loc=sunLocationForDay(dayIndex);
  if(!day||!loc)return {sunrise:'--:--',sunset:'--:--',location:null};
  return {
    sunrise:solarTimeLocal(day.date,Number(loc.lat),Number(loc.lng),true,TRIP.timezone||'UTC'),
    sunset:solarTimeLocal(day.date,Number(loc.lat),Number(loc.lng),false,TRIP.timezone||'UTC'),
    location:loc
  };
}

function weatherLocationForDay(dayIndex){
  const d=TRIP.days?.[dayIndex];
  if(!d) return null;
  const fallback=(d.events||[]).find(validCoord);
  if(TRIP?.slug!=='iceland-2026'){
    if(fallback)return {name:d.name||fallback.title||d.label,lat:fallback.lat,lng:fallback.lng};
    if(TRIP?.slug==='kumamoto-2027')return {name:'Kumamoto',lat:32.8031,lng:130.7079};
  }
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
  qs('#weatherSheetTitle').textContent=`${d.label} · ${derivedDayTitle(d,dayIndex)}`;
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
          <p>Open-Meteo 最長提供 16 天預報。這一天的逐小時預報預計從 <b>${zhDate(w.availableFrom)}</b> 起開始出現；到時重新打開 App 就會自動抓最新資料。</p>
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
  // Do not switch layout states mid-animation: the old 0.82 threshold changed
  // Hero height/font/display in one frame, which could change scrollY and flicker.
  // hero-compact is now only a final visual state after the continuous animation.
  hero.classList.toggle('hero-compact',progress>=0.995);
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
  updateEditAvailability();
  updateMailBadges();
  requestAnimationFrame(updateHeroCollapse);
}

function renderAll(){
  renderDayStrip();
  renderStaticIcons();
  renderToday();
  renderBookings();
  renderBottomNavIcons();
  if(map)renderMapDay();
  syncEditModeChrome();
}

qsa('.nav-item[data-target]').forEach(b=>b.onclick=()=>showView(b.dataset.target));
qsa('[data-nav]').forEach(b=>b.onclick=()=>showView(b.dataset.nav));
qs('#routeSlider').oninput=e=>{clearRouteTimer();updateRouteAt(+e.target.value)};
qs('#routePlayCircle').onclick=togglePlay;
qs('#playRoute').onclick=togglePlay;
if(qs('#exportGoogleRoute')) qs('#exportGoogleRoute').onclick=openGoogleDayRoute;
if(qs('#routeMetricToggle')) qs('#routeMetricToggle').onclick=toggleRouteMetric;
updateRouteMetricToggle();
qs('#mapMultiToggle').onclick=toggleMapMultiMode;
function closeTripDatesEditor(){
  qs('#tripDatesSheet')?.classList.remove('show');
  qs('#tripDatesBackdrop')?.classList.remove('show');
  qs('#tripDatesSheet')?.setAttribute('aria-hidden','true');
}
function openTripDatesEditor(){
  if(!canEditTrip())return;
  qs('#tripStartDateInput').value=TRIP?.startDate||TRIP?.days?.[0]?.date||'';
  qs('#tripEndDateInput').value=TRIP?.endDate||TRIP?.days?.at(-1)?.date||'';
  qs('#tripDatesStatus').textContent='';
  qs('#tripDatesBackdrop').classList.add('show');
  qs('#tripDatesSheet').classList.add('show');
  qs('#tripDatesSheet').setAttribute('aria-hidden','false');
}
async function saveTripDates(e){
  e.preventDefault();
  const startDate=qs('#tripStartDateInput').value,endDate=qs('#tripEndDateInput').value;
  const status=qs('#tripDatesStatus');
  if(!startDate||!endDate||endDate<startDate){status.textContent='結束日期不可早於開始日期。';return}
  status.textContent='儲存中…';
  try{
    const data=await travelEditor('set_trip_dates',{startDate,endDate});
    closeTripDatesEditor();
    await hydratePrivateCloudData();
    syncTripLabels();
    renderAll();
    if(data?.adjusted){
      alert('日期已儲存。因為範圍外仍有既有行程或正式預訂，Travel OS 已自動保留那些日期，沒有刪除資料。');
    }
  }catch(err){
    status.textContent='儲存失敗：'+(err.code||err.message||'unknown');
  }
}

const openTripSheet=()=>{
  updateEditAvailability();
  qs('#tripSheet').classList.add('show');
  qs('#sheetBackdrop').classList.add('show');
  if(cloudSyncState!=='synced'){
    window.TravelAuth?.resumeSessionCheck?.({keepReady:true})
      .then(()=>hydratePrivateCloudData())
      .catch(()=>{});
  }
};
qs('#tripMenuBtn').onclick=openTripSheet;
qs('#heroMenuBtn').onclick=openTripSheet;
qsa('.subview-menu-btn').forEach(btn=>btn.onclick=openTripSheet);
if(qs('#globalEditDay')) qs('#globalEditDay').onclick=editCurrentDay;
if(qs('#globalAddItem')) qs('#globalAddItem').onclick=()=>openItemEditor(selectedDay,null);
if(qs('#globalDoneEdit')) qs('#globalDoneEdit').onclick=()=>toggleEditMode(false);
if(qs('#editTripDatesBtn')) qs('#editTripDatesBtn').onclick=()=>openTripSettingsEditor('edit');
if(qs('#closeTripDates')) qs('#closeTripDates').onclick=closeTripDatesEditor;
if(qs('#tripDatesBackdrop')) qs('#tripDatesBackdrop').onclick=closeTripDatesEditor;
if(qs('#tripDatesForm')) qs('#tripDatesForm').onsubmit=saveTripDates;
function closeSheet(){qs('#tripSheet').classList.remove('show');qs('#sheetBackdrop').classList.remove('show')}
qs('#closeSheet').onclick=closeSheet;
qs('#sheetBackdrop').onclick=closeSheet;
qs('#weatherBtn').onclick=openWeatherSheet;
qs('#closeWeather').onclick=closeWeatherSheet;
qs('#weatherBackdrop').onclick=closeWeatherSheet;
qs('#demoModeToggle').onclick=toggleDemoMode;
if(qs('#newTripBtn')) qs('#newTripBtn').onclick=createNewTrip;
if(qs('#moreNewTrip')) qs('#moreNewTrip').onclick=createNewTrip;
if(qs('#moreResync')) qs('#moreResync').onclick=async()=>{
  const btn=qs('#moreResync');btn.disabled=true;
  try{
    cloudSyncState='syncing';syncMoreStatus();
    await window.TravelAuth?.resumeSessionCheck?.({keepReady:true});
    await hydratePrivateCloudData();
    await renderMoreView();
  }finally{btn.disabled=false;}
};
if(qs('#moreSignOut')) qs('#moreSignOut').onclick=()=>window.TravelAuth?.signOut?.().then(()=>location.reload());
if(qs('#moreRerouteMail')) qs('#moreRerouteMail').onclick=rerouteGlobalMail;

if(qs('#chooserSignOut')) qs('#chooserSignOut').onclick=()=>window.TravelAuth?.signOut?.().then(()=>location.reload());
if(qs('#heroTripSwitch')) qs('#heroTripSwitch').onclick=e=>{e.stopPropagation();showView('more');};

function setAuthGateState(state){
  const msg=qs('#authMessage'), foot=qs('#authFoot'), btn=qs('#magicLinkBtn');
  if(btn) btn.disabled=state==='sending_link'||state==='loading'||state==='registering_device';
  if(state==='link_sent'){
    if(msg) msg.textContent='登入連結已寄出，請到信箱點一下 Magic Link。';
    if(foot) foot.textContent='點開後會回到 Travel OS，並把這支裝置記為 Trusted Device。';
  }else if(state==='unauthorized_email'){
    if(msg) msg.textContent='此信箱不在授權清單，請找 Trip Owner 加入再登入。';
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
  const mailImportMeta=row?.details?.mailImport&&typeof row.details.mailImport==='object'?row.details.mailImport:{};
  const imported=mailImportMeta?.parsed||null;
  const pushImported=(label,value)=>{
    if(value===null||value===undefined||value==='')return;
    if(rows.some(x=>Array.isArray(x)&&String(x[0])===label))return;
    rows.push([label,String(value)]);
  };
  const forwarders=Array.isArray(mailImportMeta?.forwardedByHistory)
    ?mailImportMeta.forwardedByHistory.filter(Boolean)
    :(mailImportMeta?.forwardedBy?[mailImportMeta.forwardedBy]:[]);
  if(forwarders.length)pushImported('轉寄自',Array.from(new Set(forwarders)).join('、'));

  if(imported){
    pushImported('房型',imported.roomType);
    pushImported('主要住客',imported.leadGuest);
    pushImported('入住人數',imported.guests||(imported.guestCount?imported.guestCount+' 人':''));
    pushImported('房間數',imported.roomCount?imported.roomCount+' 間':'');
    pushImported('住宿晚數',imported.nightCount?imported.nightCount+' 晚':'');
    pushImported('方案 / 餐食',imported.mealPlan||imported.amenities);
    if(imported.mealPlan&&imported.amenities)pushImported('包含 / 設施',imported.amenities);

    pushImported('租車公司',imported.rentalCompany);
    pushImported('車型',imported.vehicleModel);
    pushImported('租車天數',imported.rentalDays?imported.rentalDays+' 天':'');
    pushImported('取車地點',imported.pickupLocation);
    pushImported('還車地點',imported.dropoffLocation);
    pushImported('變速箱',imported.transmission);
    pushImported('租車方案',imported.plan);
    pushImported('租車包含',imported.extras);
    pushImported('保險',imported.insurances);

    pushImported('營運公司',imported.activityProvider);
    pushImported('集合地點',imported.meetingPoint||imported.address);
    pushImported('集合時間',imported.meetingTime||imported.time);
    pushImported('活動備註',imported.providerNote||imported.importantInfo);

    pushImported('航空公司',imported.airlineName);
    pushImported('行李',imported.baggageSummary);

    if(Array.isArray(imported.segments)&&imported.segments.length){
      imported.segments.forEach((seg,i)=>{
        const direction='航段 '+(i+1);
        const dep=[seg.departureAirport,seg.departureName].filter(Boolean).join(' ');
        const arr=[seg.arrivalAirport,seg.arrivalName].filter(Boolean).join(' ');
        const depTerminal=seg.departureTerminal?('T'+String(seg.departureTerminal).replace(/^T/i,'')):'';
        const arrTerminal=seg.arrivalTerminal?('T'+String(seg.arrivalTerminal).replace(/^T/i,'')):'';
        const when=[seg.date,seg.departureTime].filter(Boolean).join(' ');
        const arrival=[seg.arrivalDate&&seg.arrivalDate!==seg.date?seg.arrivalDate:'',seg.arrivalTime,arr,arrTerminal].filter(Boolean).join(' ');
        pushImported(direction+' '+(seg.flightNo||''),[when,dep,depTerminal,'→',arrival].filter(Boolean).join(' '));
        pushImported(direction+' 機型 / 艙等',[seg.aircraft,seg.cabin].filter(Boolean).join(' · '));
        pushImported(direction+' 座位 / 行李',[seg.seat,seg.carryOn,seg.checkedBaggage].filter(Boolean).join(' · '));
      });
    }
    if(imported.awardMiles)pushImported('兌換里數',Number(imported.awardMiles).toLocaleString()+' miles');
    let flightPassengers=Array.isArray(imported.passengers)?imported.passengers.filter(Boolean):[];
    if(!flightPassengers.length&&Array.isArray(imported.passengerDetails)){
      flightPassengers=Array.from(new Set(imported.passengerDetails.map(line=>{
        const m=String(line).match(/^(?:去程|回程)\s+[A-Z]{2}\d+\s+((?:MR|MS|MRS|MISS|MSTR)\s+.+?)\s+\d+\s*公斤/i);
        return m?.[1]?.trim()||'';
      }).filter(Boolean)));
    }
    if(flightPassengers.length)pushImported('旅客',flightPassengers.join('、'));
    if(Array.isArray(imported.passengerDetails)){
      imported.passengerDetails.forEach((line,i)=>{
        pushImported((i===0?'去程':i===1?'回程':'航段 '+(i+1))+' 行李 / 座位',line);
      });
    }
    if(row?.amount!==null&&row?.amount!==undefined&&row?.amount!==''){
      pushImported('總金額',(row.currency?row.currency+' ':'')+Number(row.amount).toLocaleString());
    }
    if(imported.paymentStatus||row?.payment_status)pushImported('付款狀態',imported.paymentStatus||row.payment_status);
    pushImported('付款方式',imported.paymentMethod);
    pushImported('付款卡',imported.paymentCardLast4?'••••'+imported.paymentCardLast4:'');
  }
  return {
    id:row?.id,
    version:row?.version||1,
    type:d.type||row?.reservation_type||'other',
    provider:d.provider||row?.provider||'',
    title:d.title||row?.title||'預訂',
    dates:d.dates||row?.public_summary||(
      imported?.segments?.length
        ?imported.segments.map(s=>[String(s.date||'').slice(5).replace('-','/'),s.departureAirport&&s.arrivalAirport?(s.departureAirport+'→'+s.arrivalAirport):''].filter(Boolean).join(' ')).join(' · ')
        :''
    ),
    meta:d.meta||row?.location_name||row?.public_summary||(
      imported?.passengers?.length?imported.passengers.join('、'):''
    ),
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
    imported:row?.details?.mailImport?.parsed||null,
    amount:row?.amount??null,
    currency:row?.currency||'',
    paymentStatus:row?.payment_status||'',
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
    settings:data.trip?.settings&&typeof data.trip.settings==='object'?data.trip.settings:{},
    version:data.trip?.version||1,
    role:data.role||'viewer',
    days,
    bookings:(data.reservations||[]).map(normalizeReservation),
    mailImports:Array.isArray(data.mailImports)?data.mailImports:[]
  };
}

let placeAutoResolveRunning=false;
async function maybeAutoResolveMissingPlaces(){
  if(placeAutoResolveRunning||!cloudLoaded||!canEditTrip()||demoMode)return;
  const eligible=new Set(['spot','food','shop','stay','car','tour']);
  const due=[];
  const retryCutoff=Date.now()-30*86400000;
  (TRIP?.days||[]).forEach((day,dayIndex)=>(day.events||[]).forEach((event,eventIndex)=>{
    if(!event?.id||!eligible.has(event.type)||event.uncertain||validCoord(event))return;
    const checked=event.placeLookupCheckedAt?new Date(event.placeLookupCheckedAt).getTime():0;
    if(event.placeLookupStatus==='not_found'&&checked>retryCutoff)return;
    due.push({dayIndex,eventIndex,event});
  }));
  if(!due.length)return;
  placeAutoResolveRunning=true;
  let changed=false;
  try{
    for(const row of due.slice(0,8)){
      try{
        const r=await travelEditor('lookup_place',{id:row.event.id,title:row.event.title});
        if(r?.status==='matched')changed=true;
      }catch(err){console.warn('Auto place lookup failed',row.event.title,err)}
    }
    if(changed)await hydratePrivateCloudData();
  }finally{placeAutoResolveRunning=false}
}

let placeAutoCheckRunning=false;
function daysBetweenISO(a,b){return isoDayNumber(a)-isoDayNumber(b)}
function placeAutoCheckPlan(){
  const today=icelandTodayISO();
  const start=TRIP?.startDate||TRIP?.days?.[0]?.date;
  const end=TRIP?.endDate||TRIP?.days?.at(-1)?.date;
  if(!start||!end||today>end)return {enabled:false,reason:'trip_ended'};
  const until=daysBetweenISO(start,today);
  if(until>30)return {enabled:false,reason:'more_than_30_days'};
  if(until>=8)return {enabled:true,maxAgeDays:14,scope:'all'};
  if(until>=2)return {enabled:true,maxAgeDays:7,scope:'all'};
  if(until===1)return {enabled:true,maxAgeDays:1,scope:'all'};
  return {enabled:true,maxAgeDays:1,scope:'today_tomorrow'};
}
async function maybeAutoCheckPlaceHours(){
  if(placeAutoCheckRunning||!cloudLoaded||!canEditTrip()||demoMode)return;
  const plan=placeAutoCheckPlan();
  if(!plan.enabled)return;
  const today=icelandTodayISO();
  const tomorrow=new Date(today+'T00:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  const tomorrowISO=tomorrow.toISOString().slice(0,10);
  const cutoff=Date.now()-plan.maxAgeDays*86400000;
  const eligible=new Set(['spot','food','shop','stay','car','tour']);
  const due=[];
  (TRIP.days||[]).forEach(day=>(day.events||[]).forEach(event=>{
    if(!event?.id||!event.googleMapsUrl||!eligible.has(event.type))return;
    if(plan.scope==='today_tomorrow'&&![today,tomorrowISO].includes(day.date))return;
    const checked=event.hoursCheckedAt?new Date(event.hoursCheckedAt).getTime():0;
    if(!checked||checked<=cutoff)due.push({day,event});
  }));
  if(!due.length)return;
  placeAutoCheckRunning=true;
  try{
    for(const {event} of due){
      try{
        const data=await travelEditor('resolve_google_map',{url:event.googleMapsUrl,title:event.title,lat:event.lat,lng:event.lng});
        if(data?.hoursLookup?.status==='api_error')continue;
        await travelEditor('save_place_hours',{
          id:event.id,googleMapsUrl:event.googleMapsUrl,
          googleMapsResolvedUrl:data.finalUrl||event.googleMapsResolvedUrl||'',
          openingHours:Array.isArray(data.weeklyHours)?data.weeklyHours:[],
          closedWeekdays:Array.isArray(data.closedDays)?data.closedDays:[],
          hoursSource:data.hoursSource||null
        });
      }catch(_){}
    }
    await hydratePrivateCloudData();
  }finally{placeAutoCheckRunning=false}
}

async function hydratePrivateCloudData(){
  const client=window.TravelAuth?.getClient?.();
  const authSnapshot=window.TravelAuth?.snapshot?.()||{};
  const user=authSnapshot.user;
  if(!window.TRAVEL_CONFIG?.tripSlug) return false;
  if(!client||!user){
    cloudLoaded=false;
    cloudSyncState=authSnapshot.state==='reauth_required'?'auth':'cache';
    syncTripLabels();
    return false;
  }
  cloudSyncState='syncing';
  cloudLastError='';
  syncTripLabels();
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
    cloudSyncState='synced';
    cloudLastError='';
    if(initialTripDaySelectionPending){
      syncToReferenceTripDay(false,true);
      initialTripDaySelectionPending=false;
    }else{
      selectedDay=Math.min(selectedDay,Math.max(0,TRIP.days.length-1));
      mapPrimaryDay=selectedDay;
      mapSelectedDays=new Set(TRIP.days.length?[selectedDay]:[]);
    }
    await window.TravelStore?.replaceTrip?.({...data,bookings:normalized.bookings});
    syncTripLabels();
    updateDemoModeUI();
    renderAll();
    updateEditAvailability();
    refreshGlobalMailBadge().catch(()=>{});
    setTimeout(()=>maybeAutoResolveMissingPlaces().catch(()=>{}),500);
    setTimeout(()=>maybeAutoCheckPlaceHours().catch(()=>{}),1800);
    return true;
  }catch(err){
    cloudLoaded=false;
    cloudSyncState='error';
    cloudLastError=String(err?.message||err||'Cloud sync failed');
    console.warn('Cloud trip data unavailable; using trusted local cache.',err);
    try{
      const cached=await window.TravelStore?.getTrip?.();
      if(cached?.days?.length){
        TRIP=cached;
        currentTripRole=cached.role||'viewer';
        if(initialTripDaySelectionPending){
          syncToReferenceTripDay(false,true);
          initialTripDaySelectionPending=false;
        }
        syncTripLabels();
        renderAll();
        updateEditAvailability();
      }
    }catch(_){}
    syncTripLabels();
    return false;
  }
}

function tripHref(slug){
  return `${window.TRAVEL_CONFIG?.appBasePath||'/travel-os/'}?trip=${encodeURIComponent(slug)}`;
}

async function fetchAuthorizedTrips(){
  const cached=await window.TravelStore?.listTrips?.().catch(()=>[])||[];
  if(!navigator.onLine){
    authorizedTrips=cached;
    return authorizedTrips;
  }
  const client=window.TravelAuth?.getClient?.();
  if(!client){
    authorizedTrips=cached;
    return authorizedTrips;
  }
  const {data,error}=await client.functions.invoke('travel-trips',{body:{action:'list'}});
  if(error){
    if(cached.length){authorizedTrips=cached;return authorizedTrips}
    throw error;
  }
  authorizedTrips=Array.isArray(data?.trips)?data.trips:[];
  await window.TravelStore?.setTripDirectory?.(authorizedTrips).catch(()=>{});
  return authorizedTrips;
}
async function travelTripsApi(action,payload={}){
  const client=window.TravelAuth?.getClient?.();
  if(!client) throw new Error('auth_not_ready');
  const {data,error}=await client.functions.invoke('travel-trips',{body:{action,...payload}});
  if(error){
    let body=null;
    try{body=error.context?await error.context.clone().json():null}catch(_){}
    const e=new Error(body?.error||error.message||'edge_function_error');
    e.code=body?.error||error.code||'edge_function_error';
    e.linkedMailCount=body?.linkedMailCount;
    throw e;
  }
  if(data?.error){
    const e=new Error(data.error);e.code=data.error;e.linkedMailCount=data.linkedMailCount;throw e;
  }
  return data||{};
}

async function renderTripChooser(){
  const chooser=qs('#tripChooser'),shell=qs('.app-shell');
  if(!chooser)return;
  chooser.hidden=false;
  if(shell)shell.hidden=true;
  const list=qs('#tripList'),status=qs('#chooserStatus');

  const cached=await window.TravelStore?.listTrips?.().catch(()=>[])||[];
  if(cached.length){
    authorizedTrips=cached;
    list.innerHTML=cached.map(t=>`<button class="trip-choice" data-trip-slug="${escapeHtml(t.slug)}"><div><h2>${escapeHtml(t.title)}</h2><p>${escapeHtml(t.start_date||'')} ${t.end_date?'→ '+escapeHtml(t.end_date):''}</p></div><span class="trip-role">${escapeHtml(t.role||'viewer')}</span></button>`).join('');
    list.querySelectorAll('[data-trip-slug]').forEach(btn=>btn.onclick=()=>{location.href=tripHref(btn.dataset.tripSlug)});
    const canCreate=cached.some(t=>t.role==='owner');
    const newBtn=qs('#newTripBtn');if(newBtn)newBtn.hidden=!canCreate;
    status.textContent=navigator.onLine?'正在更新旅程清單…':'離線模式 · 顯示此裝置已下載的旅程';
  }else{
    status.textContent=navigator.onLine?'讀取旅程中…':'離線且此裝置尚未下載任何旅程。請先連線開啟一次旅程。';
  }

  if(!navigator.onLine)return;

  try{
    const trips=await fetchAuthorizedTrips();
    list.innerHTML=trips.length?trips.map(t=>`<button class="trip-choice" data-trip-slug="${escapeHtml(t.slug)}"><div><h2>${escapeHtml(t.title)}</h2><p>${escapeHtml(t.start_date||'')} ${t.end_date?'→ '+escapeHtml(t.end_date):''}</p></div><span class="trip-role">${escapeHtml(t.role||'viewer')}</span></button>`).join(''):`<div class="booking-empty">目前沒有可使用的旅程。</div>`;
    list.querySelectorAll('[data-trip-slug]').forEach(btn=>btn.onclick=()=>{location.href=tripHref(btn.dataset.tripSlug)});
    const canCreate=trips.some(t=>t.role==='owner');
    const newBtn=qs('#newTripBtn');if(newBtn)newBtn.hidden=!canCreate;
    status.textContent='';
  }catch(err){
    console.warn(err);
    const cached=await window.TravelStore?.listTrips?.().catch(()=>[]);
    if(cached?.length){
      authorizedTrips=cached;
      list.innerHTML=cached.map(t=>`<button class="trip-choice" data-trip-slug="${escapeHtml(t.slug)}"><div><h2>${escapeHtml(t.title)}</h2><p>${escapeHtml(t.start_date||'')} ${t.end_date?'→ '+escapeHtml(t.end_date):''}</p></div><span class="trip-role">${escapeHtml(t.role||'viewer')}</span></button>`).join('');
      list.querySelectorAll('[data-trip-slug]').forEach(btn=>btn.onclick=()=>{location.href=tripHref(btn.dataset.tripSlug)});
      const canCreate=cached.some(t=>t.role==='owner');
      const newBtn=qs('#newTripBtn');if(newBtn)newBtn.hidden=!canCreate;
      status.textContent='離線模式 · 顯示此裝置已下載的旅程';
    }else{
      status.textContent='離線且此裝置尚未下載任何旅程。請先連線開啟一次旅程。';
    }
  }
}


function pendingMailCount(){
  return canEditTrip()&&Array.isArray(TRIP?.mailImports)?TRIP.mailImports.length:0;
}
function updateMailBadges(){
  const count=pendingMailCount()+tripPlaceAlerts().length;
  const targets=[qs('#heroMenuBtn'),qs('#tripMenuBtn'),...qsa('.subview-menu-btn')].filter(Boolean);
  targets.forEach(btn=>{
    let badge=btn.querySelector('.menu-mail-badge');
    if(!badge){
      badge=document.createElement('span');
      badge.className='menu-mail-badge';
      btn.appendChild(badge);
    }
    badge.textContent=String(count);
    badge.hidden=!count;
    btn.classList.toggle('has-mail-badge',Boolean(count));
  });
}
function syncMoreStatus(){
  const status=qs('#moreSyncStatus'),detail=qs('#moreSyncDetail'),email=qs('#moreAccountEmail');
  if(status){
    const labels={synced:'Cloud synced',syncing:'正在同步…',auth:'需要重新登入',error:'同步失敗',cache:'Offline cache'};
    status.textContent=labels[cloudSyncState]||'Offline cache';
  }
  if(detail) detail.textContent=cloudLastError||'Travel OS Cloud';
  const auth=window.TravelAuth?.snapshot?.()||{};
  if(email) email.textContent=auth.user?.email||'—';
}
async function renderMoreView(){
  syncMoreStatus();
  const host=qs('#moreTripList');
  if(!host)return;
  host.innerHTML='<div class="booking-empty">讀取旅程中…</div>';
  try{
    const trips=await fetchAuthorizedTrips();
    host.innerHTML=trips.length?trips.map(t=>`
      <button class="more-trip-card ${t.slug===window.TRAVEL_CONFIG.tripSlug?'active':''}" type="button" data-more-trip="${escapeHtml(t.slug)}">
        <span><small>${escapeHtml(String(t.role||'viewer').toUpperCase())}</small><strong>${escapeHtml(t.title)}</strong><em>${escapeHtml(t.start_date||'')}${t.end_date?' → '+escapeHtml(t.end_date):''}</em></span>
        <span>${t.slug===window.TRAVEL_CONFIG.tripSlug?'目前':'→'}</span>
      </button>`).join(''):'<div class="booking-empty">目前沒有可使用的旅程。</div>';
    host.querySelectorAll('[data-more-trip]').forEach(btn=>btn.onclick=()=>{
      if(btn.dataset.moreTrip!==window.TRAVEL_CONFIG.tripSlug) location.href=tripHref(btn.dataset.moreTrip);
    });
    const canCreate=trips.some(t=>t.role==='owner');
    if(qs('#moreNewTrip')) qs('#moreNewTrip').hidden=!canCreate;
    await loadGlobalMailInbox();
  }catch(err){
    const cached=await window.TravelStore?.listTrips?.().catch(()=>[]);
    if(cached?.length){
      authorizedTrips=cached;
      host.innerHTML=cached.map(t=>`
        <button class="more-trip-card ${t.slug===window.TRAVEL_CONFIG.tripSlug?'active':''}" type="button" data-more-trip="${escapeHtml(t.slug)}">
          <span><small>${escapeHtml(String(t.role||'viewer').toUpperCase())}</small><strong>${escapeHtml(t.title)}</strong><em>${escapeHtml(t.start_date||'')}${t.end_date?' → '+escapeHtml(t.end_date):''}</em></span>
          <span>${t.slug===window.TRAVEL_CONFIG.tripSlug?'目前':'→'}</span>
        </button>`).join('');
      host.querySelectorAll('[data-more-trip]').forEach(btn=>btn.onclick=()=>{if(btn.dataset.moreTrip!==window.TRAVEL_CONFIG.tripSlug)location.href=tripHref(btn.dataset.moreTrip)});
      if(qs('#moreNewTrip'))qs('#moreNewTrip').hidden=true;
    }else{
      host.innerHTML='<div class="booking-empty">離線且此裝置尚未下載旅程清單。</div>';
    }
    await loadGlobalMailInbox().catch(()=>{});
  }
}

async function globalMailApi(action,payload={}){
  const client=window.TravelAuth?.getClient?.();
  if(!client) throw new Error('auth_not_ready');
  const {data,error}=await client.functions.invoke('travel-global-mail',{body:{action,...payload}});
  if(error) throw error;
  if(data?.error){const e=new Error(data.error);e.code=data.error;throw e;}
  return data||{};
}
function globalMailTitle(mail){
  const d=mail?.parsed_data||{};
  return d.title||mail?.subject||'未分類信件';
}
function globalMailDate(mail){
  const d=mail?.parsed_data||{};
  return d.startDate||d.date||d.routingEventDate||'日期未辨識';
}
function renderGlobalMailInbox(data){
  const host=qs('#moreMailInbox'),countEl=qs('#moreMailCount'),badge=qs('#globalMailBadge');
  if(!host)return;
  const mails=Array.isArray(data?.mails)?data.mails:[];
  const trips=Array.isArray(data?.trips)?data.trips:[];
  if(countEl)countEl.textContent=String(mails.length);
  if(badge){
    badge.textContent=String(mails.length);
    badge.hidden=!mails.length;
  }
  if(!mails.length){
    host.innerHTML='<div class="booking-empty">目前沒有未分類信件。</div>';
    return;
  }
  host.innerHTML=mails.map(mail=>{
    const d=mail.parsed_data||{};
    const candidates=Array.isArray(mail.route_candidates)?mail.route_candidates:[];
    const options=trips.map(t=>`<option value="${escapeHtml(t.id)}">${escapeHtml(t.title)} · ${escapeHtml(t.start_date||'')} → ${escapeHtml(t.end_date||'')}</option>`).join('');
    const hint=mail.routing_status==='ambiguous'&&candidates.length
      ? '可能屬於：'+candidates.slice(0,2).map(c=>c.title+' '+Math.round(Number(c.score||0)*100)+'%').join(' / ')
      : '找不到符合日期的旅程';
    return `
      <article class="global-mail-card" data-global-mail="${escapeHtml(mail.id)}">
        <div class="global-mail-top">
          <div><small>${escapeHtml(mail.source_provider||'UNKNOWN')} · ${escapeHtml(String(mail.reservation_type||'').toUpperCase())}</small>
          <h3>${escapeHtml(globalMailTitle(mail))}</h3>
          <p>${escapeHtml(globalMailDate(mail))} · ${escapeHtml(hint)}</p></div>
          <span>${mail.routing_status==='ambiguous'?'待選擇':'未分類'}</span>
        </div>
        <div class="global-mail-actions">
          <select data-global-mail-trip="${escapeHtml(mail.id)}"><option value="">選擇旅程…</option>${options}</select>
          <button type="button" data-global-mail-assign="${escapeHtml(mail.id)}">加入旅程</button>
          <button type="button" class="secondary" data-global-mail-ignore="${escapeHtml(mail.id)}">忽略</button>
        </div>
      </article>`;
  }).join('');
  host.querySelectorAll('[data-global-mail-assign]').forEach(btn=>btn.onclick=async()=>{
    const id=btn.dataset.globalMailAssign;
    const select=host.querySelector('[data-global-mail-trip="'+CSS.escape(id)+'"]');
    if(!select?.value){alert('請先選擇旅程。');return;}
    btn.disabled=true;
    try{
      await globalMailApi('assign',{mailId:id,tripId:select.value});
      const card=btn.closest('.global-mail-card');
      if(card){card.classList.add('mail-removing');await new Promise(r=>setTimeout(r,360));}
      await loadGlobalMailInbox();
      if(select.value===TRIP?.id) await hydratePrivateCloudData();
    }catch(err){alert('指定旅程失敗：'+(err.code||err.message||'unknown'));btn.disabled=false;}
  });
  host.querySelectorAll('[data-global-mail-ignore]').forEach(btn=>btn.onclick=async()=>{
    const id=btn.dataset.globalMailIgnore;
    if(!confirm('忽略這封未分類信件？'))return;
    btn.disabled=true;
    try{
      await globalMailApi('ignore',{mailId:id});
      const card=btn.closest('.global-mail-card');
      if(card){card.classList.add('mail-removing');await new Promise(r=>setTimeout(r,360));}
      await loadGlobalMailInbox();
    }catch(err){alert('忽略失敗：'+(err.code||err.message||'unknown'));btn.disabled=false;}
  });
}
async function refreshGlobalMailBadge(){
  try{
    const data=await globalMailApi('list');
    const count=Number(data?.count||0);
    const badge=qs('#globalMailBadge');
    if(badge){badge.textContent=String(count);badge.hidden=!count;}
    const countEl=qs('#moreMailCount');if(countEl)countEl.textContent=String(count);
    return count;
  }catch(_){return 0;}
}
async function loadGlobalMailInbox(){
  const host=qs('#moreMailInbox');
  if(host)host.innerHTML='<div class="booking-empty">讀取收件匣中…</div>';
  try{
    const data=await globalMailApi('list');
    renderGlobalMailInbox(data);
    return data;
  }catch(err){
    if(host)host.innerHTML='<div class="booking-empty">無法讀取全域收件匣。</div>';
    throw err;
  }
}
async function rerouteGlobalMail(){
  const btn=qs('#moreRerouteMail'); if(btn)btn.disabled=true;
  try{
    const result=await globalMailApi('reroute');
    await loadGlobalMailInbox();
    if(window.TRAVEL_CONFIG?.tripSlug) await hydratePrivateCloudData();
    return result;
  }finally{if(btn)btn.disabled=false;}
}
function themeOptions(selected='earth'){
  return Object.entries(TRIP_THEMES).map(([key,t])=>`<option value="${key}" ${key===selected?'selected':''}>${t.name} · ${t.desc}</option>`).join('');
}
function ensureTripSettingsSheet(){
  let sheet=qs('#tripSettingsSheet');
  if(sheet)return sheet;
  const backdrop=document.createElement('div');
  backdrop.className='modal-backdrop';backdrop.id='tripSettingsBackdrop';
  sheet=document.createElement('aside');
  sheet.className='edit-sheet trip-settings-sheet';sheet.id='tripSettingsSheet';sheet.setAttribute('aria-hidden','true');
  sheet.innerHTML=`
    <div class="sheet-handle"></div>
    <div class="sheet-title"><div><span class="section-kicker">TRIP SETTINGS</span><h2 id="tripSettingsTitle">編輯旅程</h2><p>名稱、日期、時區與配色都可以之後再調整。</p></div><button class="round-btn" id="closeTripSettings">×</button></div>
    <form class="edit-form" id="tripSettingsForm">
      <input type="hidden" id="tripSettingsMode">
      <label><span>旅程名稱</span><input id="tripSettingsName" required></label>
      <div class="edit-form-grid">
        <label><span>開始日期</span><input id="tripSettingsStart" type="date"></label>
        <label><span>結束日期</span><input id="tripSettingsEnd" type="date"></label>
      </div>
      <label><span>時區</span><input id="tripSettingsTimezone" placeholder="Asia/Tokyo"></label>
      <label><span>配色模板</span><select id="tripSettingsTheme"></select></label>
      <div class="theme-preview-grid" id="tripThemePreview"></div>
      <div class="edit-form-actions"><button type="submit" class="edit-save" id="tripSettingsSave">儲存</button></div>
      <p class="edit-status" id="tripSettingsStatus"></p>
    </form>`;
  document.body.append(backdrop,sheet);
  const close=()=>{sheet.classList.remove('show');backdrop.classList.remove('show');sheet.setAttribute('aria-hidden','true')};
  qs('#closeTripSettings').onclick=close;backdrop.onclick=close;
  qs('#tripSettingsForm').onsubmit=saveTripSettings;
  qs('#tripSettingsTheme').onchange=()=>renderTripThemePreview(qs('#tripSettingsTheme').value);
  return sheet;
}
function renderTripThemePreview(selected){
  const host=qs('#tripThemePreview');if(!host)return;
  host.innerHTML=Object.entries(TRIP_THEMES).map(([key,t])=>`
    <button type="button" class="theme-preview ${selected===key?'active':''}" data-theme-pick="${key}">
      <span class="theme-swatch theme-${key}"></span><strong>${t.name}</strong><small>${t.desc}</small>
    </button>`).join('');
  host.querySelectorAll('[data-theme-pick]').forEach(btn=>btn.onclick=()=>{
    qs('#tripSettingsTheme').value=btn.dataset.themePick;
    renderTripThemePreview(btn.dataset.themePick);
  });
}
function openTripSettingsEditor(mode='edit'){
  ensureTripSettingsSheet();
  const creating=mode==='create';
  qs('#tripSettingsMode').value=mode;
  qs('#tripSettingsTitle').textContent=creating?'建立新旅程':'編輯旅程';
  const title=creating?'':(TRIP?.title||'');
  const suggested=creating?suggestTripTheme(title):currentTripTheme();
  qs('#tripSettingsName').value=title;
  qs('#tripSettingsStart').value=creating?'':(TRIP?.startDate||'');
  qs('#tripSettingsEnd').value=creating?'':(TRIP?.endDate||'');
  qs('#tripSettingsTimezone').value=creating?'Asia/Tokyo':(TRIP?.timezone||'UTC');
  qs('#tripSettingsTheme').innerHTML=themeOptions(suggested);
  renderTripThemePreview(suggested);
  qs('#tripSettingsStatus').textContent='';
  qs('#tripSettingsBackdrop').classList.add('show');qs('#tripSettingsSheet').classList.add('show');qs('#tripSettingsSheet').setAttribute('aria-hidden','false');
}
async function saveTripSettings(e){
  e.preventDefault();
  const mode=qs('#tripSettingsMode').value;
  const title=qs('#tripSettingsName').value.trim();
  const startDate=qs('#tripSettingsStart').value||null,endDate=qs('#tripSettingsEnd').value||null;
  const timezone=qs('#tripSettingsTimezone').value.trim()||'UTC';
  const theme=qs('#tripSettingsTheme').value||'earth';
  const status=qs('#tripSettingsStatus');
  if(!title){status.textContent='請輸入旅程名稱。';return}
  if(startDate&&endDate&&endDate<startDate){status.textContent='結束日期不可早於開始日期。';return}
  status.textContent='儲存中…';
  let attemptedCreateSlug='';
  try{
    if(mode==='create'){
      const suggested=title.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||('trip-'+Date.now());
      const slug=prompt('網址名稱（英文/數字/連字號）',suggested);
      if(!slug){status.textContent='已取消建立。';return}
      attemptedCreateSlug=slug;
      const device=await window.TravelStore.getDevice();
      const data=await travelTripsApi('create',{title,slug,startDate,endDate,timezone,theme,devicePublicId:device.device_public_id,deviceSecret:device.device_secret,deviceName:device.label});
      try{
        await globalMailApi('reroute');
        const client=window.TravelAuth?.getClient?.();
        if(client&&data?.trip?.id){
          const {error}=await client.functions.invoke('travel-mail-ingest',{body:{action:'reparse',tripId:data.trip.id}});
          if(error)console.warn('Mail reparse after trip create failed',error);
          await globalMailApi('reroute');
        }
      }catch(err){console.warn('Mail reroute/reparse after trip create failed',err)}
      location.href=tripHref(data.trip.slug);
      return;
    }
    await travelTripsApi('update',{tripSlug:window.TRAVEL_CONFIG.tripSlug,title,timezone,theme});
    if(startDate&&endDate)await travelEditor('set_trip_dates',{startDate,endDate});
    qs('#tripSettingsSheet').classList.remove('show');qs('#tripSettingsBackdrop').classList.remove('show');
    await hydratePrivateCloudData();
  }catch(err){
    // A network/runtime error can happen after the backend has already committed
    // the new trip. Reconcile once before telling the traveler that creation failed.
    if(mode==='create'&&attemptedCreateSlug){
      try{
        const trips=await fetchAuthorizedTrips();
        const created=trips.find(t=>String(t.slug)===String(attemptedCreateSlug));
        if(created){
          status.textContent='旅程已建立，正在開啟…';
          location.href=tripHref(created.slug);
          return;
        }
      }catch(reconcileErr){console.warn('Trip create reconciliation failed',reconcileErr)}
    }
    status.textContent='儲存失敗：'+(err.code||err.message||'unknown');
  }
}
async function createNewTrip(){openTripSettingsEditor('create')}


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
  }catch(err){
    const cached=await window.TravelStore?.listTrips?.().catch(()=>[])||[];
    if(cached.length){
      host.innerHTML='<div class="section-kicker">SWITCH TRIP · OFFLINE</div>'+cached.map(t=>`<button class="sheet-action-card" data-switch-trip="${escapeHtml(t.slug)}"><span><small>${escapeHtml(String(t.role||'viewer').toUpperCase())}</small><strong>${escapeHtml(t.title)}</strong></span><span>${t.slug===window.TRAVEL_CONFIG.tripSlug?'✓':'→'}</span></button>`).join('');
      host.querySelectorAll('[data-switch-trip]').forEach(btn=>btn.onclick=()=>{if(btn.dataset.switchTrip!==window.TRAVEL_CONFIG.tripSlug)location.href=tripHref(btn.dataset.switchTrip)});
    }else{
      host.innerHTML='<p class="member-status">離線且此裝置尚未下載旅程清單。</p>';
    }
  }
}


const OFFLINE_EDITOR_ACTIONS=new Set(['save_item','delete_item','reorder_items','save_day','save_reservation','delete_reservation']);
function offlineClone(v){return JSON.parse(JSON.stringify(v))}
function isNetworkEditorError(err){
  const code=String(err?.code||'').toLowerCase();
  const msg=String(err?.message||'').toLowerCase();
  const status=Number(err?.status||0);
  return !navigator.onLine||status===0||code==='edge_function_error'||code.includes('fetch')||msg.includes('failed to fetch')||msg.includes('network');
}
function offlineEventFromItem(item,existing={}){
  return {
    ...existing,
    id:existing.id||item.id||('offline-'+crypto.randomUUID()),
    version:existing.version||Number(item.baseVersion||1)||1,
    time:item.time||'',
    type:item.type||existing.type||'other',
    title:item.title||'',
    subtitle:item.subtitle||'',
    note:item.note||'',
    intro:item.intro||'',
    tips:Array.isArray(item.tips)?offlineClone(item.tips):[],
    reservationId:item.reservationId||null,
    reservationIds:Array.isArray(item.reservationIds)?offlineClone(item.reservationIds):[],
    address:item.address||'',
    lat:item.lat??null,lng:item.lng??null,
    navQuery:item.navQuery||'',
    googleMapsUrl:item.googleMapsUrl||'',
    googleMapsResolvedUrl:item.googleMapsResolvedUrl||'',
    openingHours:Array.isArray(item.openingHours)?offlineClone(item.openingHours):[],
    closedWeekdays:Array.isArray(item.closedWeekdays)?offlineClone(item.closedWeekdays):[],
    hoursSource:item.hoursSource||null,
    hoursCheckedAt:item.hoursCheckedAt||null,
    uncertain:Boolean(item.uncertain)
  };
}
function offlineBookingFromReservation(r,existing={}){
  return {
    ...existing,
    id:existing.id||r.id||('offline-'+crypto.randomUUID()),
    version:existing.version||Number(r.baseVersion||1)||1,
    type:r.type||existing.type||'other',
    provider:r.provider||'',
    title:r.title||'預訂',
    dates:[r.startsAt?String(r.startsAt).slice(0,10):'',r.endsAt?String(r.endsAt).slice(0,10):''].filter(Boolean).join(' → '),
    meta:r.summary||'',
    code:r.confirmationCode||'',
    secret:r.pinCode||'',
    status:r.status||'confirmed',
    notice:r.privateNotes||'',
    details:existing.details||{rows:[],amenities:[],tips:[],source:'離線編輯'},
    imported:existing.imported||null,
    amount:r.amount??existing.amount??null,
    currency:r.currency||existing.currency||'',
    paymentStatus:r.paymentStatus||existing.paymentStatus||'',
    _raw:{...(existing._raw||{}),starts_at:r.startsAt||null,ends_at:r.endsAt||null,address:r.address||'',latitude:r.lat??null,longitude:r.lng??null,nav_query:r.navQuery||'',google_maps_url:r.googleMapsUrl||'',google_maps_resolved_url:r.googleMapsResolvedUrl||''}
  };
}
async function applyOfflineEditorAction(action,payload){
  if(!TRIP||!OFFLINE_EDITOR_ACTIONS.has(action))return null;
  let entityId=action,baseVersion=1,localTempId=null;
  if(action==='save_item'){
    const item=offlineClone(payload.item||{});
    let day=TRIP.days.find(d=>d.id===item.dayId)||(item.date?TRIP.days.find(d=>d.date===item.date):null);
    if(!day)throw Object.assign(new Error('offline_day_missing'),{code:'offline_day_missing'});
    let idx=item.id?day.events.findIndex(e=>e.id===item.id):-1;
    const existing=idx>=0?day.events[idx]:{};
    const local=offlineEventFromItem(item,existing);
    if(idx>=0)day.events[idx]=local;else day.events.push(local);
    entityId=local.id;baseVersion=Number(item.baseVersion||existing.version||1)||1;
    if(String(entityId).startsWith('offline-')){
      localTempId=entityId;
      item.id=null;
      payload={...payload,item};
    }
  }else if(action==='delete_item'){
    entityId=String(payload.id||'');baseVersion=Number(payload.baseVersion||1)||1;
    for(const day of TRIP.days){const i=day.events.findIndex(e=>e.id===entityId);if(i>=0){day.events.splice(i,1);break}}
  }else if(action==='reorder_items'){
    const day=TRIP.days.find(d=>d.id===payload.dayId);
    if(day){
      const map=new Map(day.events.map(e=>[e.id,e]));
      day.events=(payload.orderedIds||[]).map((id,i)=>{const e=map.get(id);if(e)e.sortOrder=i;return e}).filter(Boolean);
    }
    entityId=String(payload.dayId||'');
  }else if(action==='save_day'){
    const d=payload.day||{};
    const day=TRIP.days.find(x=>x.id===d.id)||TRIP.days.find(x=>x.date===d.date);
    if(!day)throw Object.assign(new Error('offline_day_missing'),{code:'offline_day_missing'});
    entityId=day.id;baseVersion=Number(d.baseVersion||day.version||1)||1;
    Object.assign(day,{
      name:d.name,short:d.short??d.notes??day.short,heroImageUrl:d.heroImageUrl??day.heroImageUrl,
      km:d.km??day.km,driveMinutes:d.driveMinutes??day.driveMinutes,departureTime:d.departureTime??day.departureTime,
      sunrise:d.sunrise??day.sunrise,sunset:d.sunset??day.sunset
    });
  }else if(action==='save_reservation'){
    const r=offlineClone(payload.reservation||{});
    let idx=r.id?TRIP.bookings.findIndex(b=>b.id===r.id):-1;
    const existing=idx>=0?TRIP.bookings[idx]:{};
    const local=offlineBookingFromReservation(r,existing);
    if(idx>=0)TRIP.bookings[idx]=local;else TRIP.bookings.push(local);
    entityId=local.id;baseVersion=Number(r.baseVersion||existing.version||1)||1;
    if(String(entityId).startsWith('offline-')){
      localTempId=entityId;r.id=null;payload={...payload,reservation:r};
    }
  }else if(action==='delete_reservation'){
    entityId=String(payload.id||'');baseVersion=Number(payload.baseVersion||1)||1;
    TRIP.bookings=TRIP.bookings.filter(b=>b.id!==entityId);
  }
  await window.TravelStore?.saveUiTrip?.(TRIP);
  await window.TravelStore?.queueOperation?.({
    entity_type:'editor_action',entity_id:entityId||action,action,base_version:baseVersion,
    patch:{payload:offlineClone(payload),localTempId}
  });
  cloudLoaded=false;cloudSyncState='cache';
  cloudLastError='離線變更已儲存在此裝置；恢復網路後會自動同步。';
  syncTripLabels();renderAll();updateEditAvailability();
  return {ok:true,offlineQueued:true};
}
async function invokeTravelEditorOnline(action,payload={}){
  const client=window.TravelAuth?.getClient?.();
  if(!client) throw new Error('auth_not_ready');
  const device=await window.TravelStore.getDevice();
  const {data,error}=await client.functions.invoke('travel-editor',{body:{
    tripSlug:window.TRAVEL_CONFIG.tripSlug,
    devicePublicId:device.device_public_id,
    deviceSecret:device.device_secret,
    action,...payload
  }});
  if(error){
    let body=null;
    try{ body=error.context?await error.context.clone().json():null; }catch(_){}
    const code=body?.error||error.code||'edge_function_error';
    const e=new Error(code);e.code=code;e.currentVersion=body?.currentVersion;e.status=error.context?.status;throw e;
  }
  if(data?.error){
    const e=new Error(data.error);e.code=data.error;e.currentVersion=data.currentVersion;throw e;
  }
  return data;
}
let offlineFlushRunning=false;
async function flushOfflineEditorQueue(){
  if(offlineFlushRunning||!navigator.onLine||!window.TRAVEL_CONFIG?.tripSlug)return;
  const pending=await window.TravelStore?.getPendingOperations?.();
  if(!pending?.length)return;
  offlineFlushRunning=true;
  cloudSyncState='syncing';cloudLastError='正在同步離線變更…';syncTripLabels();
  try{
    for(const op of pending){
      if(op.entity_type!=='editor_action')continue;
      const payload=offlineClone(op.patch?.payload||{});
      if(op.action==='save_item'&&String(payload.item?.id||'').startsWith('offline-'))payload.item.id=null;
      if(op.action==='save_reservation'&&String(payload.reservation?.id||'').startsWith('offline-'))payload.reservation.id=null;
      try{
        await invokeTravelEditorOnline(op.action,payload);
        await window.TravelStore?.completeOperation?.(op.op_id);
      }catch(err){
        await window.TravelStore?.updateOperation?.(op.op_id,{attempts:Number(op.attempts||0)+1,last_error:String(err?.code||err?.message||err),last_attempt_at:new Date().toISOString()});
        if(err?.code==='version_conflict'){
          cloudLastError='離線變更與雲端版本衝突；已保留待處理變更。';
        }else{
          cloudLastError='離線變更尚未同步，稍後會再試。';
        }
        throw err;
      }
    }
    await hydratePrivateCloudData();
    cloudLastError='';
  }catch(err){
    console.warn('Offline editor sync paused',err);
    cloudSyncState='cache';syncTripLabels();
  }finally{offlineFlushRunning=false}
}

async function travelEditor(action,payload={}){
  if(OFFLINE_EDITOR_ACTIONS.has(action)&&!navigator.onLine){
    return applyOfflineEditorAction(action,payload);
  }
  try{
    return await invokeTravelEditorOnline(action,payload);
  }catch(err){
    if(OFFLINE_EDITOR_ACTIONS.has(action)&&isNetworkEditorError(err)){
      return applyOfflineEditorAction(action,payload);
    }
    throw err;
  }
}

function canEditTrip(){return currentTripRole==='owner'||currentTripRole==='editor'}

function ensureDeleteTripSheet(){
  let sheet=qs('#deleteTripSheet');if(sheet)return sheet;
  const backdrop=document.createElement('div');backdrop.className='modal-backdrop';backdrop.id='deleteTripBackdrop';
  sheet=document.createElement('aside');sheet.className='edit-sheet delete-trip-sheet';sheet.id='deleteTripSheet';sheet.setAttribute('aria-hidden','true');
  sheet.innerHTML=`
    <div class="sheet-handle"></div>
    <div class="sheet-title"><div><span class="section-kicker danger-kicker">DANGER ZONE</span><h2>刪除旅程</h2><p>這個動作不能復原。</p></div><button class="round-btn" id="closeDeleteTrip">×</button></div>
    <div class="delete-trip-summary" id="deleteTripSummary"></div>
    <label class="delete-confirm-label"><span>輸入完整旅程名稱以確認</span><input id="deleteTripConfirmName" autocomplete="off"></label>
    <button type="button" class="delete-trip-confirm" id="deleteTripConfirmBtn" disabled>永久刪除旅程</button>
    <p class="edit-status" id="deleteTripStatus"></p>`;
  document.body.append(backdrop,sheet);
  const close=()=>{sheet.classList.remove('show');backdrop.classList.remove('show');sheet.setAttribute('aria-hidden','true')};
  qs('#closeDeleteTrip').onclick=close;backdrop.onclick=close;
  qs('#deleteTripConfirmName').oninput=()=>{
    qs('#deleteTripConfirmBtn').disabled=qs('#deleteTripConfirmName').value.trim()!==String(TRIP?.title||'');
  };
  qs('#deleteTripConfirmBtn').onclick=confirmDeleteCurrentTrip;
  return sheet;
}
let deleteTripPreview=null;
async function deleteCurrentTrip(){
  if(currentTripRole!=='owner')return;
  ensureDeleteTripSheet();
  qs('#deleteTripStatus').textContent='讀取資料中…';
  qs('#deleteTripConfirmName').value='';qs('#deleteTripConfirmBtn').disabled=true;
  qs('#deleteTripBackdrop').classList.add('show');qs('#deleteTripSheet').classList.add('show');qs('#deleteTripSheet').setAttribute('aria-hidden','false');
  try{
    deleteTripPreview=await travelTripsApi('delete_preview',{tripSlug:window.TRAVEL_CONFIG.tripSlug});
    const n=Number(deleteTripPreview.linkedMailCount||0);
    qs('#deleteTripSummary').innerHTML=`
      <div><span>旅程</span><strong>${escapeHtml(deleteTripPreview.trip?.title||TRIP?.title||'')}</strong></div>
      <div><span>行程項目</span><strong>${Number(deleteTripPreview.itineraryCount||0)}</strong></div>
      <div><span>正式預訂</span><strong>${Number(deleteTripPreview.reservationCount||0)}</strong></div>
      <div class="${n?'mail-warning':''}"><span>原始信件</span><strong>${n} 封</strong></div>
      ${n?`<p class="delete-mail-note">刪除時會先把這 ${n} 封信解除 Trip 關聯，退回「更多 → 未分類信件」，再刪除旅程。Email 本身不會刪除。</p>`:''}`;
    qs('#deleteTripConfirmBtn').textContent=n?'解除信件關聯並刪除旅程':'永久刪除旅程';
    qs('#deleteTripStatus').textContent='';
  }catch(err){
    qs('#deleteTripStatus').textContent='無法讀取刪除資訊：'+(err.code||err.message||'unknown');
  }
}
async function confirmDeleteCurrentTrip(){
  if(!deleteTripPreview)return;
  const btn=qs('#deleteTripConfirmBtn'),status=qs('#deleteTripStatus');
  btn.disabled=true;status.textContent='刪除中…';
  try{
    const n=Number(deleteTripPreview.linkedMailCount||0);
    await travelTripsApi('delete',{tripSlug:window.TRAVEL_CONFIG.tripSlug,confirmTitle:TRIP.title,detachMail:n>0});
    try{await window.TravelStore?.clearTrip?.(window.TRAVEL_CONFIG.tripSlug)}catch(err){console.warn('Local trip cache cleanup failed',err)}
    location.href=window.TRAVEL_CONFIG?.appBasePath||'/travel-os/';
  }catch(err){
    status.textContent='刪除失敗：'+(err.code||err.message||'unknown');
    btn.disabled=false;
  }
}


function updateEditAvailability(){
  let btn=qs('#editModeBtn');
  if(!canEditTrip()){
    editMode=false;
    if(btn){btn.remove();btn=null;}
    qsa('.edit-inline-actions,.edit-chip').forEach(el=>el.remove());
    syncEditModeChrome();
  }else if(!btn&&qs('#membersBtn')){
    btn=document.createElement('button');
    btn.id='editModeBtn';btn.type='button';btn.className='sheet-action-card';
    btn.innerHTML='<span><small>ITINERARY</small><strong>編輯行程</strong></span><span>→</span>';
    qs('#membersBtn').before(btn);
    btn.onclick=()=>{closeSheet();toggleEditMode();};
  }

  let alertBtn=qs('#tripAlertBtn');
  const placeAlerts=tripPlaceAlerts();
  if(!alertBtn&&qs('#membersBtn')){
    alertBtn=document.createElement('button');
    alertBtn.id='tripAlertBtn';alertBtn.type='button';alertBtn.className='sheet-action-card';
    qs('#membersBtn').before(alertBtn);
    alertBtn.onclick=async()=>{
      const alerts=tripPlaceAlerts();
      if(!alerts.length)return;
      const x=alerts[0];
      if(x.kind==='changed'&&x.itemId){
        const markRead=confirm(x.message+'\n\n按「確定」標記這筆營業時間變動為已讀；按「取消」只查看行程。');
        if(markRead){
          try{await travelEditor('ack_place_alert',{id:x.itemId});await hydratePrivateCloudData();}catch(_){}
        }
      }
      closeSheet();
      selectedDay=x.dayIndex;mapPrimaryDay=x.dayIndex;mapSelectedDays=new Set([x.dayIndex]);
      showView('today');renderAll();
      setTimeout(()=>document.querySelector(`#timeline [data-event-index="${x.eventIndex}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}),80);
    };
  }
  if(alertBtn){
    alertBtn.hidden=!placeAlerts.length;
    alertBtn.innerHTML='<span><small>TRIP ALERT</small><strong>行程提醒</strong><em>'+placeAlerts.length+' 筆需要注意 · 點一下查看</em></span><span class="trip-alert-count">'+placeAlerts.length+'</span>';
  }

  let audit=qs('#placeAuditBtn');
  if(!audit&&qs('#membersBtn')){
    audit=document.createElement('button');
    audit.id='placeAuditBtn';audit.type='button';audit.className='sheet-action-card';
    audit.innerHTML='<span><small>PLACE CHECK</small><strong>檢查營業時間 / 公休日</strong><em id="placeAuditStatus">檢查已補 Google Maps 連結的行程</em></span><span>→</span>';
    qs('#membersBtn').before(audit);
    audit.onclick=auditTripPlaceHours;
  }
  if(audit){
    audit.hidden=!canEditTrip();
    const placeNoticeCount=placeAlerts.length;
    const auditStatus=qs('#placeAuditStatus')?.textContent||'檢查已補 Google Maps 連結的行程';
    audit.innerHTML='<span><small>PLACE CHECK</small><strong>檢查營業時間 / 公休日</strong><em id="placeAuditStatus">'+escapeHtml(auditStatus)+'</em></span>'+(placeNoticeCount?'<span class="trip-alert-count">'+placeNoticeCount+'</span>':'<span>→</span>');
  }
  let mailBtn=qs('#mailImportBtn');
  if(!mailBtn&&qs('#membersBtn')){
    mailBtn=document.createElement('button');
    mailBtn.id='mailImportBtn';mailBtn.type='button';mailBtn.className='sheet-action-card';
    qs('#membersBtn').before(mailBtn);
    mailBtn.onclick=()=>{closeSheet();openMailImportSheet();};
  }
  if(mailBtn){
    const pending=Array.isArray(TRIP?.mailImports)?TRIP.mailImports.length:0;
    mailBtn.hidden=!canEditTrip();
    mailBtn.innerHTML='<span><small>MAIL IMPORT</small><strong>信箱匯入</strong><em>'+(pending?pending+' 筆待確認':'目前沒有待確認')+'</em></span>'+(pending?'<span class="trip-alert-count">'+pending+'</span>':'<span>→</span>');
  }
  const publicShare=qs('#publicShareBtn');
  if(publicShare) publicShare.hidden=currentTripRole!=='owner';

  let deleteTripBtn=qs('#deleteTripBtn');
  if(!deleteTripBtn&&qs('#tripSheet')){
    deleteTripBtn=document.createElement('button');
    deleteTripBtn.id='deleteTripBtn';
    deleteTripBtn.type='button';
    deleteTripBtn.className='sheet-action-card trip-delete-card';
    deleteTripBtn.innerHTML='<span><small>DANGER ZONE</small><strong>刪除旅程</strong><em>永久刪除這個 Trip 與其行程 / 預訂資料</em></span><span>→</span>';
    qs('#tripSheet').append(deleteTripBtn);
    deleteTripBtn.onclick=deleteCurrentTrip;
  }
  if(deleteTripBtn) deleteTripBtn.hidden=currentTripRole!=='owner';
  syncTripLabels();
}


function ensureMailImportSheet(){
  let sheet=qs('#mailImportSheet');
  if(sheet)return sheet;
  const backdrop=document.createElement('div');
  backdrop.className='modal-backdrop';
  backdrop.id='mailImportBackdrop';
  sheet=document.createElement('aside');
  sheet.className='members-sheet mail-import-sheet';
  sheet.id='mailImportSheet';
  sheet.setAttribute('aria-hidden','true');
  sheet.innerHTML=`
    <div class="sheet-handle"></div>
    <div class="sheet-title">
      <div><span class="section-kicker">MAIL IMPORT</span><h2>信箱匯入</h2><p>來自 mTripPlan Gmail。先比較差異，確認後才更新正式預訂。</p></div>
      <button class="round-btn" id="closeMailImport">×</button>
    </div>
    <div class="mail-import-toolbar">
      <div class="mail-import-status" id="mailImportStatus"></div>
      <button type="button" class="mini-btn mail-reparse-btn" id="mailReparseBtn">重新辨識既有信件</button>
    </div>
    <div class="mail-import-list" id="mailImportList"></div>`;
  document.body.append(backdrop,sheet);
  const close=()=>{
    sheet.classList.remove('show');
    backdrop.classList.remove('show');
    sheet.setAttribute('aria-hidden','true');
  };
  qs('#closeMailImport').onclick=close;
  backdrop.onclick=close;
  qs('#mailReparseBtn').onclick=reparseTripMail;
  return sheet;
}

async function reparseTripMail(){
  if(!canEditTrip()||!TRIP?.id)return;
  const btn=qs('#mailReparseBtn');
  if(btn){btn.disabled=true;btn.textContent='重新辨識中…';}
  try{
    const client=window.TravelAuth?.getClient?.();
    if(!client)throw new Error('auth_not_ready');
    const {data,error}=await client.functions.invoke('travel-mail-ingest',{body:{action:'reparse',tripId:TRIP.id}});
    if(error)throw error;
    if(data?.error){const e=new Error(data.error);e.code=data.error;throw e;}
    await hydratePrivateCloudData();
    renderMailImportSheet();
    alert([
      '信件重新辨識完成',
      '',
      '重新解析：'+Number(data?.changed||0),
      '回到待確認：'+Number(data?.pendingReview||0),
      '已分類：'+Number(data?.classified||0),
      '已忽略非必要信件：'+Number(data?.ignored||0),
      '',
      '重新辨識不會直接修改正式預訂，請在下方逐筆確認後再套用。'
    ].join('\n'));
  }catch(err){
    alert('重新辨識失敗：'+(err.code||err.message||'unknown'));
  }finally{
    if(btn){btn.disabled=false;btn.textContent='重新辨識既有信件';}
  }
}

function mailValue(value){
  if(value===null||value===undefined||value==='')return '—';
  if(typeof value==='object')return JSON.stringify(value);
  return String(value);
}
function mailSuggestedItems(mail){
  const d=mail?.parsed_data||{};
  const hits=[];
  if(mail?.reservation_type==='stay'&&d.startDate){
    const dayIndex=(TRIP.days||[]).findIndex(x=>x.date===String(d.startDate).slice(0,10));
    if(dayIndex>=0){
      const key=normalizedStayName(d.displayTitle||d.title||'');
      (TRIP.days[dayIndex].events||[]).forEach((e,eventIndex)=>{
        if(e.type!=='stay')return;
        const ek=normalizedStayName(e.title||'');
        if(key&&ek&&(ek.includes(key)||key.includes(ek)))hits.push({dayIndex,eventIndex,event:e});
      });
    }
  }
  if(mail?.reservation_type==='flight'){
    const segs=Array.isArray(d.segments)&&d.segments.length?d.segments:[{date:d.date,flightNo:d.flightNo}];
    segs.forEach(seg=>{
      const dayIndex=(TRIP.days||[]).findIndex(x=>x.date===String(seg?.date||'').slice(0,10));
      if(dayIndex<0||!seg?.flightNo)return;
      const f=String(seg.flightNo).replace(/\s+/g,'').toLowerCase();
      (TRIP.days[dayIndex].events||[]).forEach((e,eventIndex)=>{
        if(e.type==='flight'&&String(e.title||'').replace(/\s+/g,'').toLowerCase().includes(f))hits.push({dayIndex,eventIndex,event:e});
      });
    });
  }
  const seen=new Set();
  return hits.filter(x=>x.event?.id&&!seen.has(x.event.id)&&(seen.add(x.event.id),true));
}
function mailGroupLabel(mail){
  const hits=mailSuggestedItems(mail);
  if(!hits.length)return '會建立新的預訂與行程事件';
  if(mail.reservation_type==='flight')return '會加入同一航班事件：'+hits.map(x=>x.event.title).join(' / ');
  return '會加入同一住宿事件：'+hits[0].event.title;
}

function mailExistingReservation(mail){
  if(!mail?.matched_reservation_id)return null;
  return (TRIP.bookings||[]).find(b=>String(b.id)===String(mail.matched_reservation_id))||null;
}
function mailReviewRows(mail){
  const d=mail?.parsed_data||{};
  const existing=mailExistingReservation(mail);
  const raw=existing?._raw||{};
  const rows=[];
  const add=(label,oldValue,newValue)=>{
    if(newValue===null||newValue===undefined||newValue==='')return;
    rows.push([label,mailValue(oldValue),mailValue(newValue)]);
  };
  add('轉寄自','',mail?.envelope_from);
  add('名稱',raw.title||existing?.title,d.title);
  add('訂位代碼',raw.confirmation_code||existing?.code,d.confirmationCode);
  add('PIN',raw.pin_code||existing?.secret,d.pinCode);
  add('金額',raw.amount,d.amount!==undefined&&d.amount!==null?(d.currency?d.amount+' '+d.currency:d.amount):'');
  add('付款',raw.payment_status,d.paymentStatus);
  add('開始',raw.starts_at,[d.startDate||d.date,d.startTime||d.time||d.departureTime].filter(Boolean).join(' '));
  add('結束',raw.ends_at,[d.endDate||d.date,d.endTime||d.arrivalTime].filter(Boolean).join(' '));
  if(mail?.reservation_type==='flight'){
    add('航空公司','',d.airlineName||d.provider);
    if(Array.isArray(d.segments)&&d.segments.length){
      add('航段','',d.segments.map(seg=>[
        seg.flightNo,
        [seg.date,seg.departureTime,seg.departureAirport].filter(Boolean).join(' '),
        '→',
        [seg.arrivalDate&&seg.arrivalDate!==seg.date?seg.arrivalDate:'',seg.arrivalTime,seg.arrivalAirport].filter(Boolean).join(' ')
      ].filter(Boolean).join(' ')).join(' / '));
    }
    add('行李','',d.baggageSummary);
    add('兌換里數','',d.awardMiles?Number(d.awardMiles).toLocaleString():'');
  }
  add('地址',raw.address,d.address);
  add('取消期限',raw.cancellation_policy,d.cancellationDeadline?.date?[d.cancellationDeadline.date,d.cancellationDeadline.time].filter(Boolean).join(' '):(d.cancellationDeadlineText||d.cancellationPolicy));
  add('房型','',d.roomType);
  add('主要住客','',d.leadGuest);
  add('入住人數','',d.guests||(d.guestCount?String(d.guestCount):''));
  add('房間數','',d.roomCount?String(d.roomCount):'');
  add('晚數','',d.nightCount?String(d.nightCount):'');
  add('方案 / 餐食','',d.amenities);
  add('付款卡','',d.paymentCardLast4?'••••'+d.paymentCardLast4:'');
  add('PNR / 訂單','',d.confirmationCode);
  if(d.flightNo)add('航班',raw.title,d.flightNo+' '+(d.departureAirport||'')+' → '+(d.arrivalAirport||''));
  if(d.participants)add('人數 / 方案','',d.participants);
  if(d.vehicle)add('車型',raw.title,d.vehicle);
  return rows;
}
function renderMailImportSheet(){
  const list=qs('#mailImportList'),status=qs('#mailImportStatus');
  if(!list||!status)return;
  const mails=Array.isArray(TRIP?.mailImports)?TRIP.mailImports:[];
  status.textContent=mails.length?mails.length+' 筆待確認':'目前沒有待確認信件';
  if(!mails.length){
    list.innerHTML='<div class="booking-empty">新的旅遊確認信進來後會出現在這裡。</div>';
    return;
  }
  list.innerHTML=mails.map(mail=>{
    const d=mail.parsed_data||{};
    const existing=mailExistingReservation(mail);
    const rows=mailReviewRows(mail);
    const diff=rows.length?rows.map(([label,oldValue,newValue])=>`
      <div class="mail-diff-row">
        <span>${escapeHtml(label)}</span>
        <div><small>目前</small><strong>${escapeHtml(oldValue)}</strong></div>
        <div><small>信件</small><strong>${escapeHtml(newValue)}</strong></div>
      </div>`).join(''):'<div class="mail-no-diff">已解析，但沒有新的可套用欄位。</div>';
    return `
      <article class="mail-import-card" data-mail-id="${escapeHtml(mail.id)}">
        <div class="mail-import-head">
          <div><small>${escapeHtml(mail.source_provider||'UNKNOWN')} · ${escapeHtml(String(mail.reservation_type||'').toUpperCase())}</small>
          <h3>${escapeHtml(d.title||mail.subject||'待確認信件')}</h3>
          <p>${existing?'同一張訂單更新：'+escapeHtml(existing.title):escapeHtml(mailGroupLabel(mail))}</p>
          <p class="mail-parser-meta">${escapeHtml(String(mail.parser_method||'rules').toUpperCase())} · 信心 ${Math.round(Number(mail.parser_confidence||0)*100)}%${Array.isArray(mail.validation_issues)&&mail.validation_issues.length?' · ⚠ '+mail.validation_issues.length+' 項':''}</p></div>
          <span class="mail-import-badge">${existing?'MATCHED':'NEW'}</span>
        </div>
        <div class="mail-diff-list">${diff}</div>
        <div class="mail-import-actions">
          <button type="button" class="mail-ignore" data-mail-ignore="${escapeHtml(mail.id)}">忽略</button>
          ${existing?`<button type="button" class="mail-save-new" data-mail-save-new="${escapeHtml(mail.id)}">另存</button>`:''}
          <button type="button" class="mail-apply" data-mail-apply="${escapeHtml(mail.id)}">${existing?'套用更新':(mailSuggestedItems(mail).length?'新增訂單並合併':'新增預訂')}</button>
        </div>
      </article>`;
  }).join('');
  list.querySelectorAll('[data-mail-ignore]').forEach(btn=>btn.onclick=()=>reviewMailImport(btn.dataset.mailIgnore,'ignore',btn));
  list.querySelectorAll('[data-mail-save-new]').forEach(btn=>btn.onclick=()=>reviewMailImport(btn.dataset.mailSaveNew,'save_new',btn));
  list.querySelectorAll('[data-mail-apply]').forEach(btn=>btn.onclick=()=>reviewMailImport(btn.dataset.mailApply,'apply',btn));
}
async function openMailImportSheet(){
  if(!canEditTrip())return;
  const sheet=ensureMailImportSheet();
  renderMailImportSheet();
  qs('#mailImportBackdrop').classList.add('show');
  sheet.classList.add('show');
  sheet.setAttribute('aria-hidden','false');
}
async function reviewMailImport(mailId,mode,button){
  if(!mailId||!canEditTrip())return;
  const mail=(TRIP.mailImports||[]).find(x=>String(x.id)===String(mailId));
  const existing=mailExistingReservation(mail);
  const suggestions=mailSuggestedItems(mail);
  const verb=mode==='apply'
    ?(existing
      ?'套用這封信到同一張既有訂單？\n\n未解析到的原資料會保留。'
      :suggestions.length
        ?'新增這張預訂，並掛到下列既有行程事件？\n\n'+suggestions.map(x=>'• '+x.event.title).join('\n')+'\n\n不同 PNR / 訂單號仍會保留成不同訂單。'
        :'新增這張預訂，並建立對應的行程事件？')
    :mode==='save_new'
      ?'將這封信另存成一張獨立的新預訂？\n\n不會覆蓋目前配對到的既有預訂；系統會依這封信自己的日期建立或連到對應行程。'
      :'忽略這封信？\n\n只會從待確認清單移除，不會刪除 Gmail 信件。';
  if(!confirm(verb))return;
  const card=button.closest('.mail-import-card');
  button.disabled=true;
  if(card) card.classList.add('mail-processing');
  try{
    const payload={mailId};
    if(mode==='apply'||mode==='save_new'){
      payload.itineraryItemIds=mode==='apply'?suggestions.map(x=>x.event.id):[];
      payload.createItinerary=true;
      if(mode==='save_new')payload.forceCreateNew=true;
    }
    await travelEditor(mode==='ignore'?'mail_ignore':'mail_apply',payload);
    const oldHeight=card?.getBoundingClientRect().height||0;
    if(card){
      card.style.height=oldHeight+'px';
      requestAnimationFrame(()=>card.classList.add('mail-removing'));
      await new Promise(resolve=>setTimeout(resolve,420));
    }
    await hydratePrivateCloudData();
    renderMailImportSheet();
    updateEditAvailability();
    updateMailBadges();
  }catch(err){
    if(card){
      card.classList.remove('mail-processing','mail-removing');
      card.style.height='';
    }
    alert('處理失敗：'+(err.code||err.message||'unknown'));
    button.disabled=false;
  }
}

async function auditTripPlaceHours(){
  if(!canEditTrip())return;
  const btn=qs('#placeAuditBtn'),status=qs('#placeAuditStatus');
  const eligible=new Set(['spot','food','shop','stay','car','tour']);
  const all=[];
  TRIP.days.forEach((day,dayIndex)=>(day.events||[]).forEach((event,eventIndex)=>{
    if(event?.id&&eligible.has(event.type)) all.push({day,dayIndex,event,eventIndex});
  }));
  const linked=all.filter(x=>x.event.googleMapsUrl);
  const missing=all.filter(x=>!x.event.googleMapsUrl);
  if(!linked.length){
    status.textContent=`沒有可檢查的 Google Maps 地點 · 待補 ${missing.length}`;
    return;
  }
  if(!confirm(`將立即重新檢查 ${linked.length} 筆地點。\n這會呼叫 Google Places API；平常自動查核會依低頻規則執行。\n\n是否繼續？`))return;
  btn.disabled=true;
  let done=0,withHours=0,noHours=0,failed=0,changed=0;
  for(const row of linked){
    const {event}=row;
    try{
      const before=JSON.stringify(event.openingHours||[]);
      const data=await travelEditor('resolve_google_map',{url:event.googleMapsUrl,title:event.title,lat:event.lat,lng:event.lng});
      const hours=Array.isArray(data.weeklyHours)?data.weeklyHours:[];
      const closed=Array.isArray(data.closedDays)?data.closedDays:[];
      const lookup=data?.hoursLookup||{};
      if(lookup.configured===false) throw new Error('places_api_not_configured');
      if(lookup.status==='api_error'){failed++;continue;}
      await travelEditor('save_place_hours',{
        id:event.id,googleMapsUrl:event.googleMapsUrl,
        googleMapsResolvedUrl:data.finalUrl||event.googleMapsResolvedUrl||'',
        openingHours:hours,closedWeekdays:closed,hoursSource:data.hoursSource||null
      });
      if(hours.length)withHours++;else noHours++;
      if(event.hoursCheckedAt&&before!==JSON.stringify(hours))changed++;
    }catch(err){failed++}
    finally{
      done++;
      status.textContent=`檢查中 ${done}/${linked.length} · 有資料 ${withHours} · 無資料 ${noHours}`;
    }
  }
  await hydratePrivateCloudData();
  const alerts=tripPlaceAlerts();
  const conflictCount=alerts.filter(x=>x.kind==='closed'||x.kind==='conflict').length;
  const changeCount=alerts.filter(x=>x.kind==='changed').length;
  btn.disabled=false;
  status.textContent=`完成 · 有營業資料 ${withHours} · 衝突 ${conflictCount} · 變動 ${changeCount}`;
  alert([
    '營業時間檢查完成','',
    `已檢查：${linked.length}`,
    `✅ 有營業時間：${withHours}`,
    `ℹ️ Google 無營業時間資料：${noHours}`,
    `⚠️ 行程衝突 / 公休：${conflictCount}`,
    `🔄 營業時間變動：${changeCount}`,
    `❌ API 查詢失敗：${failed}`,
    `🔗 待補 Google Maps：${missing.length}`
  ].join('\n'));
}

function syncEditModeChrome(){
  const active=editMode&&canEditTrip();
  document.documentElement.classList.toggle('editing-trip',active);
  const toolbar=qs('#globalEditToolbar');
  if(toolbar){
    toolbar.hidden=!active;
    qs('#globalEditRole').textContent=String(currentTripRole||'editor').toUpperCase();
  }
}
function toggleEditMode(force){
  if(!canEditTrip()){
    alert('目前帳號為 Viewer，沒有編輯此旅程的權限。');
    return;
  }
  editMode=typeof force==='boolean'?force:!editMode;
  renderAll();
  syncEditModeChrome();
}
function decorateTimelineEditor(){
  const old=qs('#editModeBanner');if(old)old.remove();
  if(editMode&&canEditTrip()){
    const originCard=qs('#timeline .timeline-route-origin .timeline-card');
    if(originCard){
      const originActions=document.createElement('div');
      originActions.className='edit-inline-actions';
      const timeEdit=document.createElement('button');
      timeEdit.type='button';
      timeEdit.className='edit-chip';
      timeEdit.textContent='◷ 編輯出發時間';
      timeEdit.onclick=e=>{e.stopPropagation();openDepartureTimeEditor(selectedDay)};
      originActions.append(timeEdit);
      originCard.append(originActions);
    }

    qsa('#timeline .timeline-item[data-event-index]').forEach(timelineItem=>{
      const eventIndex=Number(timelineItem.dataset.eventIndex);
      if(!Number.isInteger(eventIndex)) return;
      const item=currentDay().events[eventIndex];
      const card=timelineItem.querySelector('.timeline-card');
      if(!item||!card) return;
      const actions=document.createElement('div');actions.className='edit-inline-actions';
      const edit=document.createElement('button');edit.className='edit-chip';edit.textContent='✎ 編輯';edit.onclick=e=>{e.stopPropagation();openItemEditor(selectedDay,eventIndex)};
      actions.append(edit);
      if(!item.time){
        const drag=document.createElement('button');
        drag.type='button';drag.className='edit-chip drag-handle';drag.textContent='☰ 長按拖曳';
        drag.title='無固定時間，可長按拖曳排序';
        enableFlexibleDrag(card,drag,eventIndex);
        actions.append(drag);
      }else{
        const fixed=document.createElement('span');fixed.className='fixed-time-hint';fixed.textContent='固定時間 · 自動排序';
        actions.append(fixed);
      }
      card.append(actions);
    });
  }
  syncEditModeChrome();
}

function ensureDepartureTimeEditor(){
  let sheet=qs('#departureTimeSheet');
  if(sheet) return sheet;

  const backdrop=document.createElement('div');
  backdrop.className='modal-backdrop';
  backdrop.id='departureTimeBackdrop';

  sheet=document.createElement('aside');
  sheet.className='edit-sheet departure-time-sheet';
  sheet.id='departureTimeSheet';
  sheet.setAttribute('aria-hidden','true');
  sheet.innerHTML=`
    <div class="sheet-handle"></div>
    <div class="sheet-title">
      <div><span class="section-kicker">DAY ROUTE</span><h2>編輯出發時間</h2></div>
      <button class="round-btn" id="closeDepartureTimeEdit">×</button>
    </div>
    <form class="edit-form" id="departureTimeForm">
      <input type="hidden" id="departureDayIndex">
      <label><span>出發時間</span><input id="departureTimeInput" type="time"></label>
      <p class="edit-help">這個時間只屬於當天路線起點，不會新增一筆假的行程。</p>
      <div class="edit-form-actions">
        <button type="button" class="edit-delete departure-clear" id="clearDepartureTime">清除</button>
        <button type="submit" class="edit-save">儲存</button>
      </div>
      <p class="edit-status" id="departureTimeStatus"></p>
    </form>`;
  document.body.append(backdrop,sheet);

  const close=()=>{
    sheet.classList.remove('show');
    backdrop.classList.remove('show');
    sheet.setAttribute('aria-hidden','true');
  };
  qs('#closeDepartureTimeEdit').onclick=close;
  backdrop.onclick=close;
  qs('#departureTimeForm').onsubmit=saveDepartureTimeEditor;
  qs('#clearDepartureTime').onclick=()=>{
    qs('#departureTimeInput').value='';
  };
  return sheet;
}

function openDepartureTimeEditor(dayIndex){
  if(!canEditTrip()) return;
  const d=TRIP.days?.[dayIndex];
  if(!d?.id) return;
  const sheet=ensureDepartureTimeEditor();
  qs('#departureDayIndex').value=String(dayIndex);
  qs('#departureTimeInput').value=d.departureTime||'';
  qs('#departureTimeStatus').textContent='';
  qs('#departureTimeBackdrop').classList.add('show');
  sheet.classList.add('show');
  sheet.setAttribute('aria-hidden','false');
  setTimeout(()=>qs('#departureTimeInput')?.focus(),60);
}

async function saveDepartureTimeEditor(e){
  e.preventDefault();
  const dayIndex=Number(qs('#departureDayIndex').value);
  const d=TRIP.days?.[dayIndex];
  if(!d?.id) return;
  const departureTime=qs('#departureTimeInput').value||'';
  const status=qs('#departureTimeStatus');
  status.textContent='儲存中…';
  try{
    await travelEditor('save_day',{day:{
      id:d.id,
      baseVersion:d.version,
      date:d.date,
      label:d.label,
      name:d.name,
      short:d.short||'',
      heroImageUrl:d.heroImageUrl,
      km:d.km,
      driveMinutes:d.driveMinutes,
      departureTime,
      sunrise:d.sunrise,
      sunset:d.sunset
    }});
    qs('#departureTimeSheet').classList.remove('show');
    qs('#departureTimeBackdrop').classList.remove('show');
    await hydratePrivateCloudData();
  }catch(err){
    if(err.code==='version_conflict'){
      status.textContent='本日資料已被其他裝置更新，正在重新載入…';
      await hydratePrivateCloudData();
      return;
    }
    status.textContent='儲存失敗：'+(err.code||err.message);
  }
}

function setItemEditorOpen(open){
  document.documentElement.classList.toggle('item-editor-open',Boolean(open));
}
function closeItemEditor(){
  const sheet=qs('#itemEditSheet'),backdrop=qs('#itemEditBackdrop');
  if(sheet){
    sheet.classList.remove('show');
    sheet.setAttribute('aria-hidden','true');
  }
  if(backdrop)backdrop.classList.remove('show');
  setItemEditorOpen(false);
}
function ensureItemEditor(){
  let sheet=qs('#itemEditSheet');
  if(sheet)return sheet;
  const backdrop=document.createElement('div');backdrop.className='modal-backdrop';backdrop.id='itemEditBackdrop';
  sheet=document.createElement('aside');sheet.className='edit-sheet';sheet.id='itemEditSheet';sheet.setAttribute('aria-hidden','true');
  sheet.innerHTML=`
    <div class="sheet-handle"></div>
    <div class="sheet-title"><div><span class="section-kicker">ITINERARY EDITOR</span><h2 id="itemEditTitle">新增行程</h2></div><button class="round-btn" id="closeItemEdit" type="button" aria-label="取消編輯">×</button></div>
    <form class="edit-form" id="itemEditForm">
      <input type="hidden" id="editItemId"><input type="hidden" id="editItemVersion">
      <div class="edit-form-grid">
        <label><span>日期</span><input id="editItemDate" type="date" required></label>
        <label><span>時間</span><input id="editItemTime" type="time"></label>
      </div>

      <label class="google-map-primary-field">
        <span>Google Maps 連結 <small class="inline-field-help">（貼上後會自動抓取資料）</small></span>
        <div class="map-link-display" id="itemMapLinkDisplay" hidden>
          <a class="mini-btn map-open-link" id="editItemMapOpen" target="_blank" rel="noopener">開啟 Google Maps ↗</a>
          <button type="button" class="mini-btn map-edit-link" id="editItemMapEdit">編輯</button>
        </div>
        <div class="map-import-row" id="editItemMapEditRow"><input id="editItemMapUrl" inputmode="url" placeholder="貼上 Google Maps 連結"></div>
      </label>
      <p class="edit-status map-import-status" id="mapImportStatus"></p>

      <div class="edit-form-grid">
        <label><span>類型</span><select id="editItemType"><option value="spot">景點</option><option value="drive">移動</option><option value="stay">住宿</option><option value="food">餐食</option><option value="tour">Tour</option><option value="flight">航班</option><option value="car">租車</option><option value="shop">補給</option><option value="plan">備案</option><option value="other">其他</option></select></label>
        <label><span>名稱</span><input id="editItemName" required></label>
      </div>
      <label class="uncertain-row"><input id="editItemUncertain" type="checkbox"><span>不確定</span><small>可能不會去；不列入地圖、里程與駕車時間</small></label>
      <label id="stayReservationLinkRow"><span>住宿預訂連動</span><select id="editItemReservation"><option value="">不連動預訂</option></select><small class="field-help">連動後，名稱以每日行程為準；地址、GPS、Google Maps 由住宿預訂共用。</small></label>
      <label><span>副標題</span><input id="editItemSubtitle"></label>
      <label><span>備註</span><textarea id="editItemNote"></textarea></label>
      <label><span>景點介紹</span><textarea id="editItemIntro"></textarea></label>
      <label><span>注意事項（每行一項）</span><textarea id="editItemTips"></textarea></label>
      <label><span>地址</span><input id="editItemAddress" autocomplete="street-address" placeholder="有解析到地址時會保留；也可手動輸入"></label>
      <div class="edit-form-grid">
        <label><span>Latitude</span><input id="editItemLat" type="number" step="any"></label>
        <label><span>Longitude</span><input id="editItemLng" type="number" step="any"></label>
      </div>
      <label><span>導航搜尋（可留空）</span><input id="editItemNav"></label>

      <div class="edit-form-actions item-edit-actions">
        <button type="button" class="edit-delete" id="deleteItemBtn">刪除</button>
        <button type="button" class="edit-cancel" id="cancelItemEdit">取消</button>
        <button type="submit" class="edit-save">確認</button>
      </div>
      <p class="edit-status" id="itemEditStatus"></p>
    </form>`;
  document.body.append(backdrop,sheet);
  qs('#closeItemEdit').onclick=closeItemEditor;
  qs('#cancelItemEdit').onclick=closeItemEditor;
  backdrop.onclick=closeItemEditor;
  qs('#itemEditForm').onsubmit=saveItemEditor;
  qs('#deleteItemBtn').onclick=deleteCurrentItem;
  qs('#editItemMapEdit').onclick=()=>setItemMapEditMode(true);
  qs('#editItemMapUrl').addEventListener('input',scheduleItemMapImport);
  qs('#editItemMapUrl').addEventListener('change',scheduleItemMapImport);
  qs('#editItemType').onchange=()=>{
    const row=qs('#stayReservationLinkRow');
    if(row) row.hidden=qs('#editItemType').value!=='stay';
  };
  return sheet;
}

let itemMapImportTimer=0;
function usableMapUrl(value){return /^https?:\/\//i.test(String(value||'').trim())}
function setItemMapEditMode(editing=false){
  const input=qs('#editItemMapUrl'),row=qs('#editItemMapEditRow'),display=qs('#itemMapLinkDisplay'),open=qs('#editItemMapOpen');
  if(!input||!row||!display||!open)return;
  const url=input.dataset.resolvedUrl||input.value.trim();
  const has=usableMapUrl(url);
  row.hidden=has&&!editing;
  display.hidden=!has||editing;
  if(has)open.href=url;
  if(editing)setTimeout(()=>{input.focus();input.select()},30);
}
function scheduleItemMapImport(){
  clearTimeout(itemMapImportTimer);
  const input=qs('#editItemMapUrl'),url=input?.value.trim()||'';
  if(!url){setItemMapEditMode(true);return}
  if(!usableMapUrl(url))return;
  itemMapImportTimer=setTimeout(()=>importGoogleMapIntoEditor(),450);
}

function openItemEditor(dayIndex,eventIndex){
  if(!canEditTrip())return;
  const sheet=ensureItemEditor(),event=eventIndex===null?null:TRIP.days[dayIndex]?.events?.[eventIndex];
  qs('#itemEditTitle').textContent=event?'編輯行程':'新增行程';
  qs('#editItemDate').value=event?(TRIP.days[dayIndex]?.date||''):(TRIP.days[dayIndex]?.date||TRIP.startDate||'');
  qs('#editItemId').value=event?.id||'';
  qs('#editItemVersion').value=event?.version||'';
  qs('#editItemTime').value=event?.time||'';
  qs('#editItemType').value=event?.type||'spot';
  qs('#editItemName').value=event?.title||'';
  qs('#editItemUncertain').checked=Boolean(event?.uncertain);
  const reservationSelect=qs('#editItemReservation');
  const stayBookings=(TRIP.bookings||[]).map((b,i)=>({b,i})).filter(x=>x.b?.type==='stay');
  reservationSelect.innerHTML='<option value="">不連動預訂</option>'+stayBookings.map(({b})=>`<option value="${escapeHtml(b.id||'')}">${escapeHtml(b.title||'住宿預訂')}</option>`).join('');
  reservationSelect.value=event?.reservationId||'';
  reservationSelect.dataset.reservationIds=JSON.stringify(Array.isArray(event?.reservationIds)?event.reservationIds:(event?.reservationId?[event.reservationId]:[]));
  qs('#stayReservationLinkRow').hidden=(event?.type||'spot')!=='stay';
  qs('#editItemSubtitle').value=event?.subtitle||'';
  qs('#editItemNote').value=event?.note||'';
  qs('#editItemIntro').value=event?.details?.intro||'';
  qs('#editItemTips').value=(event?.details?.tips||[]).join('\n');
  qs('#editItemAddress').value=event?.address||'';
  qs('#editItemLat').value=Number.isFinite(event?.lat)?event.lat:'';
  qs('#editItemLng').value=Number.isFinite(event?.lng)?event.lng:'';
  qs('#editItemMapUrl').value=event?.googleMapsUrl||'';
  qs('#editItemMapUrl').dataset.resolvedUrl=event?.googleMapsResolvedUrl||'';
  qs('#editItemMapUrl').dataset.openingHours=JSON.stringify(event?.openingHours||[]);
  qs('#editItemMapUrl').dataset.closedWeekdays=JSON.stringify(event?.closedWeekdays||[]);
  qs('#editItemMapUrl').dataset.hoursSource=event?.hoursSource||'';
  qs('#editItemMapUrl').dataset.hoursCheckedAt=event?.hoursCheckedAt||'';
  qs('#mapImportStatus').textContent=event?.hoursCheckedAt?'上次營業時間檢查：'+new Date(event.hoursCheckedAt).toLocaleString():'';
  setItemMapEditMode(!usableMapUrl(event?.googleMapsResolvedUrl||event?.googleMapsUrl));

  qs('#editItemNav').value=event?.navQuery||'';
  qs('#deleteItemBtn').hidden=!event;
  qs('#itemEditStatus').textContent='';
  setItemEditorOpen(true);
  qs('#itemEditBackdrop').classList.add('show');sheet.classList.add('show');sheet.setAttribute('aria-hidden','false');
}

async function importGoogleMapIntoEditor(){
  const input=qs('#editItemMapUrl');
  const url=input?.value.trim();
  const status=qs('#mapImportStatus');
  if(!url){status.textContent='請先貼上 Google Maps 連結。';return}
  status.textContent='解析 Google Maps 連結中…';
  try{
    const data=await travelEditor('resolve_google_map',{url});
    if(!data?.ok) throw new Error(data?.error||'map_resolve_failed');

    const nameInput=qs('#editItemName');
    const typeInput=qs('#editItemType');
    const addressInput=qs('#editItemAddress');
    const existingTitle=String(nameInput?.value||'').trim();
    const existingType=String(typeInput?.value||'').trim();
    const isNew=!String(qs('#editItemId')?.value||'').trim();

    // Prefer the localized Google Maps title for a new item. If the current
    // auto-derived title is only a shorter fragment (e.g. "Milch"), enrich it
    // to the full localized place name. Preserve unrelated user-written names.
    const localizedName=String(data.localizedName||data.name||'').trim();
    const originalName=String(data.originalName||'').trim();
    const currentTitle=String(nameInput?.value||'').trim();
    const titleLooksLikeFragment=Boolean(
      currentTitle&&localizedName&&localizedName.toLocaleLowerCase().includes(currentTitle.toLocaleLowerCase())&&localizedName.length>currentTitle.length
    );
    if((!currentTitle||titleLooksLikeFragment)&&localizedName) nameInput.value=localizedName;

    const subtitleInput=qs('#editItemSubtitle');
    const currentSubtitle=String(subtitleInput?.value||'').trim();
    if(!currentSubtitle&&originalName&&originalName!==localizedName) subtitleInput.value=originalName;

    const rating=Number(data.rating);
    const ratingCount=Number(data.userRatingCount);
    const ratingText=Number.isFinite(rating)
      ?rating.toFixed(1).replace(/\.0$/,'')+'⭐'+(Number.isFinite(ratingCount)?'('+Math.round(ratingCount).toLocaleString('en-US')+')':'')
      :'';
    const noteInput=qs('#editItemNote');
    const currentNote=String(noteInput?.value||'').trim();
    if(ratingText&&(!currentNote||/^\d(?:\.\d)?⭐(?:\([\d,]+\))?$/.test(currentNote))) noteInput.value=ratingText;

    const introInput=qs('#editItemIntro');
    const currentIntro=String(introInput?.value||'').trim();
    if(!currentIntro&&data.editorialSummary) introInput.value=String(data.editorialSummary).trim();

    if(data.address) addressInput.value=data.address;
    if(Number.isFinite(data.lat)) qs('#editItemLat').value=data.lat;
    if(Number.isFinite(data.lng)) qs('#editItemLng').value=data.lng;
    if(data.navQuery) qs('#editItemNav').value=data.navQuery;

    // New itinerary items always default to 景點. Google Maps parsing may suggest
    // a type, but never changes the user's type selection automatically.
    const suggestedType=(isNew&&data.suggestedType&&typeInput?.querySelector(`option[value="${data.suggestedType}"]`))
      ?data.suggestedType
      :'';

    // Preserve what the user pasted. Store the expanded URL separately for audit/debugging.
    input.dataset.resolvedUrl=data.finalUrl||'';

    const visitDate=qs('#editItemDate')?.value||'';
    const visitWeekday=visitDate?new Intl.DateTimeFormat('en-US',{weekday:'long',timeZone:'UTC'}).format(new Date(visitDate+'T00:00:00Z')):'';
    const hours=Array.isArray(data.weeklyHours)?data.weeklyHours:[];
    input.dataset.openingHours=JSON.stringify(hours);
    input.dataset.closedWeekdays=JSON.stringify(Array.isArray(data.closedDays)?data.closedDays:[]);
    input.dataset.hoursSource=data.hoursSource||'';
    input.dataset.hoursCheckedAt=new Date().toISOString();

    const hoursText=hours.length?'營業時間：'+hours.map(x=>`${x.day} ${x.hours}`).join('；'):'';
    const closedToday=visitWeekday&&Array.isArray(data.closedDays)&&data.closedDays.includes(visitWeekday);
    const warning=closedToday?`⚠️ 行程日期 ${visitDate}（${visitWeekday.slice(0,3).toUpperCase()}）為公休日，請調整行程。`:'';

    // Google Places business hours are reference/attention information, not
    // the visible itinerary subtitle/note. Put them into the expandable
    // "注意事項" section so the collapsed card stays concise.
    const tipsBox=qs('#editItemTips');
    const currentTips=tipsBox.value.split('\n').map(x=>x.trim()).filter(Boolean);
    const withoutAutoHours=currentTips.filter(x=>!/^營業時間：/.test(x)&&!/^⚠️ 行程日期 .*為公休日/.test(x));
    if(hoursText)withoutAutoHours.push(hoursText);
    if(warning)withoutAutoHours.push(warning);
    tipsBox.value=Array.from(new Set(withoutAutoHours)).join('\n');

    // Clean old auto-generated hours from Note when resolving the place again.
    const noteBox=qs('#editItemNote');
    noteBox.value=noteBox.value.split('\n')
      .filter(x=>!/^營業時間：/.test(x.trim())&&!/^⚠️ 行程日期 .*為公休日/.test(x.trim()))
      .join('\n').trim();

    const filled=[
      localizedName?'中文名稱':'',
      originalName&&originalName!==localizedName?'原文名稱':'',
      ratingText?'Google 評價':'',
      data.editorialSummary?'景點介紹':'',
      data.address?'地址':'',
      Number.isFinite(data.lat)&&Number.isFinite(data.lng)?'GPS':'',
      hours.length?'營業時間':''
    ].filter(Boolean).join('、');
    const kept=existingTitle?'；已保留你原本輸入的名稱':'';
    const typeHint=suggestedType&&suggestedType!==existingType
      ?`；Google 類型建議：${typeLabel[suggestedType]||suggestedType}（未自動修改）`
      :'';
    status.textContent=warning?warning:(filled?`已帶入：${filled}${kept}${typeHint}`:`連結已展開並保留原始網址${kept}${typeHint}。`);
    setItemMapEditMode(false);
  }catch(err){
    status.textContent='解析失敗，已保留你貼上的原始連結，不會覆蓋現有資料：'+(err.code||err.message||'unknown');
    setItemMapEditMode(true);
  }
}

async function saveItemEditor(e){
  e.preventDefault();
  const selectedDate=qs('#editItemDate').value;
  if(!selectedDate){qs('#itemEditStatus').textContent='請選擇日期。';return;}
  const existingDayIndex=TRIP.days.findIndex(d=>d.date===selectedDate);
  const item={
    id:qs('#editItemId').value||null,baseVersion:Number(qs('#editItemVersion').value)||0,
    date:selectedDate,dayId:existingDayIndex>=0?TRIP.days[existingDayIndex].id:null,
    time:qs('#editItemTime').value,type:qs('#editItemType').value,title:qs('#editItemName').value.trim(),
    subtitle:qs('#editItemSubtitle').value.trim(),note:qs('#editItemNote').value.trim(),intro:qs('#editItemIntro').value.trim(),
    tips:qs('#editItemTips').value.split('\n').map(x=>x.trim()).filter(Boolean),
    reservationId:(qs('#editItemType').value==='stay'&&qs('#editItemReservation').value)?qs('#editItemReservation').value:null,
    reservationIds:(()=>{
      const existing=JSON.parse(qs('#editItemReservation').dataset.reservationIds||'[]');
      const chosen=(qs('#editItemType').value==='stay'&&qs('#editItemReservation').value)?[qs('#editItemReservation').value]:[];
      return Array.from(new Set([...(Array.isArray(existing)?existing:[]),...chosen].filter(Boolean)));
    })(),
    address:(qs('#editItemType').value==='stay'&&qs('#editItemReservation').value)?'':qs('#editItemAddress').value.trim(),
    lat:(qs('#editItemType').value==='stay'&&qs('#editItemReservation').value)?null:(qs('#editItemLat').value===''?null:Number(qs('#editItemLat').value)),
    lng:(qs('#editItemType').value==='stay'&&qs('#editItemReservation').value)?null:(qs('#editItemLng').value===''?null:Number(qs('#editItemLng').value)),
    navQuery:(qs('#editItemType').value==='stay'&&qs('#editItemReservation').value)?'':qs('#editItemNav').value.trim(),
    googleMapsUrl:(qs('#editItemType').value==='stay'&&qs('#editItemReservation').value)?'':qs('#editItemMapUrl').value.trim(),
    googleMapsResolvedUrl:(qs('#editItemType').value==='stay'&&qs('#editItemReservation').value)?'':(qs('#editItemMapUrl').dataset.resolvedUrl||''),
    openingHours:JSON.parse(qs('#editItemMapUrl').dataset.openingHours||'[]'),
    closedWeekdays:JSON.parse(qs('#editItemMapUrl').dataset.closedWeekdays||'[]'),
    hoursSource:qs('#editItemMapUrl').dataset.hoursSource||null,
    hoursCheckedAt:qs('#editItemMapUrl').dataset.hoursCheckedAt||null,
    uncertain:qs('#editItemUncertain').checked
  };
  qs('#itemEditStatus').textContent='儲存中…';
  try{
    await travelEditor('save_item',{item});
    closeItemEditor();
    await hydratePrivateCloudData();
    const savedDayIndex=TRIP.days.findIndex(d=>d.date===selectedDate);
    if(savedDayIndex>=0){selectedDay=savedDayIndex;mapPrimaryDay=savedDayIndex;mapSelectedDays=new Set([savedDayIndex]);renderAll();}
  }catch(err){
    if(err.code==='version_conflict'){
      qs('#itemEditStatus').textContent='資料已被其他人更新，正在重新載入…';
      await hydratePrivateCloudData();return;
    }
    qs('#itemEditStatus').textContent='正在確認伺服器是否已儲存…';
    try{
      await hydratePrivateCloudData();
      const retryDayIndex=TRIP.days.findIndex(d=>d.date===selectedDate);
      const saved=TRIP.days?.[retryDayIndex]?.events?.some(x=>
        (item.id&&x.id===item.id)||(!item.id&&x.title===item.title&&String(x.time||'')===String(item.time||''))
      );
      if(saved){
        qs('#itemEditStatus').textContent='已儲存。';
        setTimeout(()=>closeItemEditor(),250);
        return;
      }
    }catch(_){}
    qs('#itemEditStatus').textContent='儲存失敗：'+(err.code||err.message);
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

function enableFlexibleDrag(card,handle,eventIndex){
  const itemEl=card.closest('.timeline-item');
  const source=()=>currentDay().events[eventIndex];
  let timer=null,active=false,pointerId=null,startX=0,startY=0,targetEl=null,dropAfter=false,ghost=null,placeholder=null,lastX=0,lastY=0;
  let grabOffsetX=0,grabOffsetY=0;

  const clearTargets=()=>qsa('#timeline .timeline-item').forEach(x=>x.classList.remove('drag-over','drop-before','drop-after'));
  const itemIndex=(el)=>Number(el?.dataset?.eventIndex);
  const eligibleTarget=(el)=>{
    if(!el||!el.closest('#timeline')||el===itemEl)return null;
    const idx=itemIndex(el);
    return Number.isInteger(idx)&&idx>=0?el:null;
  };
  const eligibleItems=()=>qsa('#timeline .timeline-item').filter(el=>eligibleTarget(el));

  const targetForY=y=>{
    const candidates=eligibleItems();
    if(!candidates.length)return {el:null,after:false};
    for(const el of candidates){
      const r=el.getBoundingClientRect();
      if(y<r.top+r.height/2) return {el,after:false};
    }
    return {el:candidates[candidates.length-1],after:true};
  };

  const placePlaceholder=(el,after)=>{
    if(!placeholder||!el)return;
    const parent=el.parentNode;
    if(!parent)return;
    if(after) parent.insertBefore(placeholder,el.nextSibling);
    else parent.insertBefore(placeholder,el);
  };

  const moveGhost=(x,y)=>{
    if(!ghost)return;
    ghost.style.transform=`translate3d(${Math.round(x-grabOffsetX)}px,${Math.round(y-grabOffsetY)}px,0)`;
  };

  const cleanup=()=>{
    if(timer){clearTimeout(timer);timer=null}
    window.removeEventListener('pointermove',onMove,{capture:true});
    window.removeEventListener('pointerup',onUp,{capture:true});
    window.removeEventListener('pointercancel',onCancel,{capture:true});
    active=false;pointerId=null;targetEl=null;dropAfter=false;
    itemEl.classList.remove('dragging','drag-ready','drag-source-hidden');
    clearTargets();
    document.body.classList.remove('timeline-dragging');
    if(ghost){ghost.remove();ghost=null}
    if(placeholder){placeholder.remove();placeholder=null}
  };

  const begin=()=>{
    const s=source();if(!s||s.time)return;
    active=true;
    itemEl.classList.add('drag-ready','dragging');
    document.body.classList.add('timeline-dragging');

    const rect=card.getBoundingClientRect();
    grabOffsetX=Math.max(0,Math.min(rect.width,lastX-rect.left));
    grabOffsetY=Math.max(0,Math.min(rect.height,lastY-rect.top));

    ghost=card.cloneNode(true);
    ghost.className='timeline-card timeline-drag-ghost';
    ghost.querySelectorAll('button').forEach(x=>x.remove());
    ghost.style.width=`${rect.width}px`;
    ghost.style.height=`${rect.height}px`;
    document.body.append(ghost);

    placeholder=document.createElement('div');
    placeholder.className='timeline-drop-placeholder';
    placeholder.style.height=`${Math.max(64,itemEl.getBoundingClientRect().height)}px`;
    itemEl.parentNode?.insertBefore(placeholder,itemEl);
    itemEl.classList.add('drag-source-hidden');

    moveGhost(lastX,lastY);
    window.addEventListener('pointermove',onMove,{capture:true,passive:false});
    window.addEventListener('pointerup',onUp,{capture:true,passive:false});
    window.addEventListener('pointercancel',onCancel,{capture:true,passive:false});
    if(navigator.vibrate) navigator.vibrate(18);
  };

  const onMove=e=>{
    if(!active||e.pointerId!==pointerId)return;
    e.preventDefault();e.stopPropagation();
    lastX=e.clientX;lastY=e.clientY;
    moveGhost(lastX,lastY);
    clearTargets();

    const hit=targetForY(lastY);
    targetEl=hit.el;dropAfter=hit.after;
    if(targetEl){
      targetEl.classList.add('drag-over',dropAfter?'drop-after':'drop-before');
      placePlaceholder(targetEl,dropAfter);
    }

    const edge=82;
    if(lastY<edge) window.scrollBy(0,-16);
    else if(lastY>window.innerHeight-edge) window.scrollBy(0,16);
  };

  const onUp=async e=>{
    if(!active||e.pointerId!==pointerId){cleanup();return}
    e.preventDefault();e.stopPropagation();
    const sourceId=source()?.id;
    const targetIndex=targetEl?itemIndex(targetEl):-1;
    const targetId=targetIndex>=0?currentDay().events[targetIndex]?.id:null;
    const after=dropAfter;
    cleanup();
    if(sourceId&&targetId&&sourceId!==targetId) await reorderFlexibleItem(selectedDay,sourceId,targetId,after);
  };
  const onCancel=()=>cleanup();

  handle.addEventListener('pointerdown',e=>{
    e.stopPropagation();
    if(e.button!==undefined&&e.button!==0)return;
    e.preventDefault();
    startX=lastX=e.clientX;
    startY=lastY=e.clientY;
    pointerId=e.pointerId;
    itemEl.classList.add('drag-ready');
    timer=setTimeout(()=>begin(),320);
  },{passive:false});

  handle.addEventListener('pointermove',e=>{
    if(!timer||active)return;
    lastX=e.clientX;lastY=e.clientY;
    if(Math.hypot(e.clientX-startX,e.clientY-startY)>10){
      clearTimeout(timer);timer=null;itemEl.classList.remove('drag-ready');
    }
  },{passive:true});

  handle.addEventListener('pointerup',()=>{
    if(timer){clearTimeout(timer);timer=null;itemEl.classList.remove('drag-ready')}
  },{passive:true});
  handle.addEventListener('pointercancel',cleanup,{passive:true});
}

async function reorderFlexibleItem(dayIndex,sourceId,targetId,after=false){
  const day=TRIP.days[dayIndex];
  if(!day?.id||!sourceId||!targetId||sourceId===targetId)return;
  const source=day.events.find(e=>e.id===sourceId),target=day.events.find(e=>e.id===targetId);
  if(!source||!target||source.time)return;

  const originalEvents=[...day.events];
  const ids=originalEvents.map(e=>e.id);if(ids.some(id=>!id))return;
  const from=ids.indexOf(sourceId);if(from<0)return;
  ids.splice(from,1);
  const targetPos=ids.indexOf(targetId);if(targetPos<0)return;
  ids.splice(targetPos+(after?1:0),0,sourceId);

  // Optimistic UI: move the card immediately on drop instead of waiting for
  // the network round-trip + cloud re-hydration. This prevents users from
  // thinking the drop failed and repeating the gesture.
  const byId=new Map(originalEvents.map(e=>[e.id,e]));
  day.events=ids.map((id,i)=>{
    const ev=byId.get(id);
    if(ev) ev.sortOrder=i;
    return ev;
  }).filter(Boolean);
  if(selectedDay===dayIndex) renderToday();

  try{
    await travelEditor('reorder_items',{dayId:day.id,orderedIds:ids});
    // Reconcile with the server after the instant local move.
    await hydratePrivateCloudData();
  }catch(err){
    day.events=originalEvents;
    if(selectedDay===dayIndex) renderToday();
    alert('排序失敗，已恢復原順序：'+(err.code||err.message));
  }
}

function ensureDayEditor(){
  let sheet=qs('#dayEditSheet');
  if(sheet) return sheet;
  const backdrop=document.createElement('div');
  backdrop.className='modal-backdrop';
  backdrop.id='dayEditBackdrop';

  sheet=document.createElement('aside');
  sheet.className='edit-sheet day-edit-sheet';
  sheet.id='dayEditSheet';
  sheet.setAttribute('aria-hidden','true');
  sheet.innerHTML=`
    <div class="sheet-handle"></div>
    <div class="sheet-title">
      <div><span class="section-kicker">DAY EDITOR</span><h2>編輯本日</h2></div>
      <button class="round-btn" id="closeDayEdit">×</button>
    </div>
    <form class="edit-form" id="dayEditForm">
      <input type="hidden" id="dayEditIndex">
      <div class="edit-form-grid">
        <label><span>日期</span><input id="dayEditDate" type="date" readonly></label>
        <label><span>出發時間</span><input id="dayEditDeparture" type="time"></label>
      </div>
      <p class="edit-help">日期由當天行程資料自動決定；若新增更早或更晚日期的行程，D0～Dn 會自動重排。</p>
      <label><span>當日標題</span><input id="dayEditName" required placeholder="例如：斯奈山半島"></label>
      <label><span>今日備註</span><textarea id="dayEditNote" rows="9" placeholder="整天路線、取捨策略、備案、行車提醒…"></textarea></label>
      <div class="edit-form-actions">
        <button type="button" class="edit-delete" id="clearDayEditNote">清除備註</button>
        <button type="submit" class="edit-save">儲存本日</button>
      </div>
      <p class="edit-status" id="dayEditStatus"></p>
    </form>`;
  document.body.append(backdrop,sheet);

  const close=()=>{
    sheet.classList.remove('show');
    backdrop.classList.remove('show');
    sheet.setAttribute('aria-hidden','true');
  };
  qs('#closeDayEdit').onclick=close;
  backdrop.onclick=close;
  qs('#clearDayEditNote').onclick=()=>{qs('#dayEditNote').value=''};
  qs('#dayEditForm').onsubmit=saveDayEditor;
  return sheet;
}

function openDayEditor(dayIndex=selectedDay){
  if(!canEditTrip()) return;
  const d=TRIP.days?.[dayIndex];
  if(!d?.id) return;
  const sheet=ensureDayEditor();
  qs('#dayEditIndex').value=String(dayIndex);
  qs('#dayEditDate').value=d.date||'';
  qs('#dayEditDeparture').value=d.departureTime||'';
  qs('#dayEditName').value=d.name||'';
  qs('#dayEditNote').value=d.short||'';
  qs('#dayEditStatus').textContent='';
  qs('#dayEditBackdrop').classList.add('show');
  sheet.classList.add('show');
  sheet.setAttribute('aria-hidden','false');
  setTimeout(()=>qs('#dayEditName')?.focus(),60);
}

async function saveDayEditor(e){
  e.preventDefault();
  const dayIndex=Number(qs('#dayEditIndex').value);
  const d=TRIP.days?.[dayIndex];
  if(!d?.id) return;
  const name=qs('#dayEditName').value.trim();
  const departureTime=qs('#dayEditDeparture').value||'';
  const short=qs('#dayEditNote').value.trim();
  const status=qs('#dayEditStatus');
  if(!name){status.textContent='請輸入當日標題。';return}
  status.textContent='儲存中…';
  try{
    await travelEditor('save_day',{day:{
      id:d.id,baseVersion:d.version,date:d.date,label:d.label,name,short,
      heroImageUrl:d.heroImageUrl,km:d.km,driveMinutes:d.driveMinutes,
      departureTime,sunrise:d.sunrise,sunset:d.sunset
    }});
    qs('#dayEditSheet').classList.remove('show');
    qs('#dayEditBackdrop').classList.remove('show');
    await hydratePrivateCloudData();
  }catch(err){
    if(err.code==='version_conflict'){
      status.textContent='本日資料已被其他裝置更新，正在重新載入…';
      await hydratePrivateCloudData();
      return;
    }
    status.textContent='儲存失敗：'+(err.code||err.message);
  }
}

function editCurrentDay(){
  openDayEditor(selectedDay);
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
      <div class="edit-form-grid"><label><span>入住日期</span><input id="editBookingStartDate" type="date"></label><label><span>退房日期</span><input id="editBookingEndDate" type="date"></label></div>
      <label><span>地點 / Meta</span><input id="editBookingLocation"></label>
      <label><span>地址</span><input id="editBookingAddress" autocomplete="street-address"></label>
      <div class="edit-form-grid"><label><span>Latitude</span><input id="editBookingLat" type="number" step="any"></label><label><span>Longitude</span><input id="editBookingLng" type="number" step="any"></label></div>
      <label><span>Google Maps</span>
        <div class="map-link-display" id="bookingMapLinkDisplay" hidden>
          <a class="mini-btn map-open-link" id="editBookingMapOpen" target="_blank" rel="noopener">開啟 Google Maps ↗</a>
          <button type="button" class="mini-btn map-edit-link" id="editBookingMapEdit">編輯</button>
        </div>
        <div class="map-import-row" id="editBookingMapEditRow"><input id="editBookingMapUrl" inputmode="url" placeholder="貼上 Google Maps 連結，會自動帶入"></div>
      </label>
      <p class="edit-status map-import-status" id="bookingMapImportStatus"></p>
      <label><span>導航搜尋（可留空）</span><input id="editBookingNav"></label>
      <div class="edit-form-grid"><label><span>Confirmation</span><input id="editBookingCode"></label><label><span>PIN</span><input id="editBookingPin"></label></div>
      <label><span>私人備註</span><textarea id="editBookingNotes"></textarea></label>
      <label><span>取消條款</span><textarea id="editBookingCancel"></textarea></label>
      <div class="edit-form-actions"><button type="button" class="edit-delete" id="deleteBookingBtn">刪除</button><button type="submit" class="edit-save">儲存</button></div>
      <p class="edit-status" id="bookingEditStatus"></p>
    </form>`;
  document.body.append(backdrop,sheet);
  const close=()=>{sheet.classList.remove('show');backdrop.classList.remove('show')};
  qs('#closeBookingEdit').onclick=close;backdrop.onclick=close;qs('#bookingEditForm').onsubmit=saveBookingEditor;qs('#deleteBookingBtn').onclick=deleteCurrentBooking;
  qs('#editBookingMapEdit').onclick=()=>setBookingMapEditMode(true);
  qs('#editBookingMapUrl').addEventListener('input',scheduleBookingMapImport);
  qs('#editBookingMapUrl').addEventListener('change',scheduleBookingMapImport);
  return sheet;
}

let bookingMapImportTimer=0;
function setBookingMapEditMode(editing=false){
  const input=qs('#editBookingMapUrl'),row=qs('#editBookingMapEditRow'),display=qs('#bookingMapLinkDisplay'),open=qs('#editBookingMapOpen');
  if(!input||!row||!display||!open)return;
  const url=input.dataset.resolvedUrl||input.value.trim();
  const has=usableMapUrl(url);
  row.hidden=has&&!editing;
  display.hidden=!has||editing;
  if(has)open.href=url;
  if(editing)setTimeout(()=>{input.focus();input.select()},30);
}
function scheduleBookingMapImport(){
  clearTimeout(bookingMapImportTimer);
  const input=qs('#editBookingMapUrl'),url=input?.value.trim()||'';
  if(!url){setBookingMapEditMode(true);return}
  if(!usableMapUrl(url))return;
  bookingMapImportTimer=setTimeout(()=>importGoogleMapIntoBookingEditor(),450);
}

function openBookingEditor(idx){
  if(!canEditTrip())return;
  const sheet=ensureBookingEditor(),b=idx===null?null:TRIP.bookings[idx],raw=b?._raw||{};
  qs('#bookingEditTitle').textContent=b?'編輯預訂':'新增預訂';
  qs('#editBookingId').value=b?.id||'';qs('#editBookingVersion').value=b?.version||'';
  qs('#editBookingType').value=b?.type||'stay';qs('#editBookingStatus').value=b?.status||'confirmed';
  qs('#editBookingName').value=b?.title||'';qs('#editBookingProvider').value=b?.provider||'';
  qs('#editBookingSummary').value=b?.dates||'';qs('#editBookingLocation').value=raw.location_name||b?.meta||'';
  qs('#editBookingStartDate').value=raw.starts_at?String(raw.starts_at).slice(0,10):'';
  qs('#editBookingEndDate').value=raw.ends_at?String(raw.ends_at).slice(0,10):'';
  qs('#editBookingAddress').value=raw.address||'';
  qs('#editBookingLat').value=Number.isFinite(raw.latitude)?raw.latitude:'';
  qs('#editBookingLng').value=Number.isFinite(raw.longitude)?raw.longitude:'';
  qs('#editBookingMapUrl').value=raw.google_maps_url||'';
  qs('#editBookingMapUrl').dataset.resolvedUrl=raw.google_maps_resolved_url||'';
  setBookingMapEditMode(!usableMapUrl(raw.google_maps_resolved_url||raw.google_maps_url));
  qs('#editBookingNav').value=raw.nav_query||'';
  qs('#bookingMapImportStatus').textContent='';
  qs('#editBookingCode').value=b?.code==='—'?'':(b?.code||'');qs('#editBookingPin').value=b?.secret||'';
  qs('#editBookingNotes').value=b?.notice||'';qs('#editBookingCancel').value=raw.cancellation_policy||'';
  qs('#deleteBookingBtn').hidden=!b;qs('#bookingEditStatus').textContent='';
  qs('#bookingEditBackdrop').classList.add('show');sheet.classList.add('show');
}

async function importGoogleMapIntoBookingEditor(){
  const input=qs('#editBookingMapUrl'),status=qs('#bookingMapImportStatus');
  const url=input?.value.trim();
  if(!url){status.textContent='請先貼上 Google Maps 連結。';return}
  status.textContent='解析 Google Maps 連結中…';
  try{
    const data=await travelEditor('resolve_google_map',{url});
    if(!data?.ok) throw new Error(data?.error||'map_resolve_failed');
    if(data.address) qs('#editBookingAddress').value=data.address;
    if(Number.isFinite(data.lat)) qs('#editBookingLat').value=data.lat;
    if(Number.isFinite(data.lng)) qs('#editBookingLng').value=data.lng;
    if(data.navQuery) qs('#editBookingNav').value=data.navQuery;
    input.dataset.resolvedUrl=data.finalUrl||'';
    const name=qs('#editBookingName');
    if(name&&!name.value.trim()&&data.name) name.value=data.name;
    status.textContent='已帶入住宿地址、GPS 與導航資料。';
    setBookingMapEditMode(false);
  }catch(err){
    status.textContent='解析失敗，已保留原始連結：'+(err.code||err.message||'unknown');
    setBookingMapEditMode(true);
  }
}

async function saveBookingEditor(e){
  e.preventDefault();
  const reservation={
    id:qs('#editBookingId').value||null,baseVersion:Number(qs('#editBookingVersion').value)||0,
    type:qs('#editBookingType').value,status:qs('#editBookingStatus').value,title:qs('#editBookingName').value.trim(),
    provider:qs('#editBookingProvider').value.trim(),summary:qs('#editBookingSummary').value.trim(),
    startsAt:qs('#editBookingStartDate').value||null,endsAt:qs('#editBookingEndDate').value||null,
    locationName:qs('#editBookingLocation').value.trim(),address:qs('#editBookingAddress').value.trim(),
    lat:qs('#editBookingLat').value===''?null:Number(qs('#editBookingLat').value),
    lng:qs('#editBookingLng').value===''?null:Number(qs('#editBookingLng').value),
    navQuery:qs('#editBookingNav').value.trim(),googleMapsUrl:qs('#editBookingMapUrl').value.trim(),
    googleMapsResolvedUrl:qs('#editBookingMapUrl').dataset.resolvedUrl||'',
    confirmationCode:qs('#editBookingCode').value.trim(),
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

async function loadPublicShareStatus(){
  const status=qs('#publicShareStatus');
  try{
    const data=await tripAdmin('public_share_status');
    const active=Boolean(data?.active);
    if(status) status.textContent=active?'已開啟':'尚未開啟';
    qs('#publicShareInactive').hidden=active;
    qs('#publicShareActive').hidden=!active;
    if(active){
      // Token itself is never returned by status lookup. Existing links can only
      // be copied in the browser session that created/reset them.
      const cached=localStorage.getItem('travelPublicShareUrl:'+window.TRAVEL_CONFIG.tripSlug)||'';
      qs('#publicShareUrl').value=cached;
      qs('#copyPublicShare').disabled=!cached;
      qs('#publicShareMessage').textContent=cached?'':'安全起見，伺服器只保存 token hash；若要重新取得可分享網址，請按「重設連結」。';
    }
    return active;
  }catch(err){
    if(status) status.textContent='讀取失敗';
    return false;
  }
}

async function createOrResetPublicShare(){
  const msg=qs('#publicShareMessage');
  if(msg) msg.textContent='建立中…';
  try{
    const data=await tripAdmin('create_public_share');
    const url=data?.url||'';
    if(url){
      localStorage.setItem('travelPublicShareUrl:'+window.TRAVEL_CONFIG.tripSlug,url);
      qs('#publicShareUrl').value=url;
      qs('#copyPublicShare').disabled=false;
    }
    qs('#publicShareInactive').hidden=true;
    qs('#publicShareActive').hidden=false;
    qs('#publicShareStatus').textContent='已開啟';
    if(msg) msg.textContent='公開連結已建立。舊連結（若有）已失效。';
  }catch(err){
    if(msg) msg.textContent='建立失敗：'+(err.message||'unknown');
  }
}

async function revokePublicShare(){
  if(!confirm('停止公開分享？目前的公開連結會立即失效。')) return;
  const msg=qs('#publicShareMessage');
  if(msg) msg.textContent='停止分享中…';
  try{
    await tripAdmin('revoke_public_share');
    localStorage.removeItem('travelPublicShareUrl:'+window.TRAVEL_CONFIG.tripSlug);
    qs('#publicShareUrl').value='';
    qs('#publicShareInactive').hidden=false;
    qs('#publicShareActive').hidden=true;
    qs('#publicShareStatus').textContent='尚未開啟';
  }catch(err){
    if(msg) msg.textContent='停止分享失敗：'+(err.message||'unknown');
  }
}

async function openPublicShareSheet(){
  closeSheet();
  qs('#publicShareBackdrop').classList.add('show');
  qs('#publicShareSheet').classList.add('show');
  qs('#publicShareSheet').setAttribute('aria-hidden','false');
  await loadPublicShareStatus();
}

function closePublicShareSheet(){
  qs('#publicShareBackdrop').classList.remove('show');
  qs('#publicShareSheet').classList.remove('show');
  qs('#publicShareSheet').setAttribute('aria-hidden','true');
}

async function tripAdmin(action='list',payload={}){
  const client=window.TravelAuth?.getClient?.();
  if(!client) throw new Error('auth_not_ready');
  const response=await client.functions.invoke('trip-admin',{body:{tripSlug:window.TRAVEL_CONFIG.tripSlug,action,...payload}});
  if(response.error){
    let body=null;
    try{body=response.error.context?await response.error.context.clone().json():null}catch(_){}
    const code=body?.error||response.error.code||'edge_function_error';
    const err=new Error(code);
    err.code=code;
    err.status=Number(response.error.context?.status||0);
    err.invitePending=Boolean(body?.invitePending);
    throw err;
  }
  if(response.data?.error){
    const err=new Error(response.data.error);
    err.code=response.data.error;
    err.invitePending=Boolean(response.data.invitePending);
    throw err;
  }
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
      const small=document.createElement('small');small.textContent='待完成登入 · '+String(i.role||'viewer').toUpperCase()+' · 未收到邀請信也可直接登入';
      who.append(strong,small);head.append(who);
      if(owner){
        const actions=document.createElement('div');actions.className='member-actions';
        const resend=document.createElement('button');resend.className='mini-btn';resend.textContent='重新寄送';
        resend.onclick=async()=>{
          resend.disabled=true;status.textContent='正在重新寄送邀請信…';
          try{
            const result=await tripAdmin('resend_invite',{inviteId:i.id});
            status.textContent=result.mode==='existing_user_allowed'
              ?'此 Email 已有帳號，不需邀請信；請對方直接用相同 Email 登入。'
              :'邀請信已重新寄出。';
            await loadMembers();
          }catch(err){
            console.warn(err);
            status.textContent=err.code==='invite_email_rate_limited'
              ?'Supabase 寄信頻率已達上限，邀請仍保留。請稍後再按「重新寄送」。'
              :'邀請信寄送失敗，邀請仍保留，可稍後重新寄送。';
          }finally{resend.disabled=false}
        };
        const cancel=document.createElement('button');cancel.className='member-remove';cancel.textContent='取消邀請';
        cancel.onclick=async()=>{await tripAdmin('revoke_invite',{inviteId:i.id});await loadMembers()};
        actions.append(resend,cancel);head.append(actions);
      }
      card.append(head);box.append(card);
    }

    status.textContent='';
  }catch(err){console.warn(err);status.textContent='無法讀取成員資料。'}
}
qs('#publicShareBtn').onclick=openPublicShareSheet;
qs('#closePublicShare').onclick=closePublicShareSheet;
qs('#publicShareBackdrop').onclick=closePublicShareSheet;
qs('#createPublicShare').onclick=createOrResetPublicShare;
qs('#resetPublicShare').onclick=()=>{if(confirm('重設公開連結？舊連結會立即失效。')) createOrResetPublicShare()};
qs('#revokePublicShare').onclick=revokePublicShare;
qs('#copyPublicShare').onclick=async()=>{
  const url=qs('#publicShareUrl').value;
  if(!url)return;
  try{await navigator.clipboard.writeText(url);qs('#publicShareMessage').textContent='已複製公開連結。'}
  catch(_){qs('#publicShareUrl').select();document.execCommand('copy');qs('#publicShareMessage').textContent='已複製公開連結。'}
};

qs('#membersBtn').onclick=async()=>{
  closeSheet();qs('#membersBackdrop').classList.add('show');qs('#membersSheet').classList.add('show');qs('#membersSheet').setAttribute('aria-hidden','false');await loadMembers();
};
qs('#closeMembers').onclick=closeMembersSheet;
qs('#membersBackdrop').onclick=closeMembersSheet;
qs('#dayNoteToggle').onclick=toggleDayNote;
qs('#dayNoteEditBtn').onclick=e=>{e.stopPropagation();openDayEditor(selectedDay)};
qs('#inviteMemberForm').onsubmit=async e=>{
  e.preventDefault();
  const email=qs('#inviteEmail').value.trim(),role=qs('#inviteRole').value;
  const status=qs('#memberStatus');
  status.textContent='正在建立邀請…';
  try{
    const result=await tripAdmin('invite',{email,role});
    qs('#inviteEmail').value='';
    status.textContent=result.mode==='invite_sent'
      ?`已授權 ${email} 使用此旅程。邀請信已寄出；若未收到，也可直接前往 Travel OS 使用此 Email 登入。`
      :`已授權 ${email} 使用此旅程；對方可直接使用相同 Email 登入。`;
    await loadMembers();
  }catch(err){
    console.warn(err);
    if(err.code==='invite_email_rate_limited'){
      status.textContent='成員權限已保留，但 Supabase 寄信頻率已達上限。稍後可在「待完成登入」旁按重新寄送。';
      qs('#inviteEmail').value='';
      await loadMembers();
    }else if(err.invitePending){
      status.textContent='成員權限已保留，但邀請信沒有成功寄出。稍後可按重新寄送。';
      qs('#inviteEmail').value='';
      await loadMembers();
    }else{
      status.textContent='邀請失敗：'+(err.code||err.message||'unknown');
    }
  }
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
      updateEditAvailability();
    }
  }catch(err){console.warn('Local store init failed',err)}

  if(window.TravelAuth){
    window.TravelAuth.onChange(s=>{
      setAuthGateState(s.state);
      if(s.state==='reauth_required'){
        cloudLoaded=false;
        cloudSyncState='auth';
        syncTripLabels();
      }else if(s.state==='offline_ready'){
        cloudLoaded=false;
        cloudSyncState='cache';
        syncTripLabels();
        if(!window.TRAVEL_CONFIG?.tripSlug)renderTripChooser();
      }else if(s.state==='ready'){
        if(window.TRAVEL_CONFIG?.tripSlug) hydratePrivateCloudData();
        else renderTripChooser();
      }
    });
    const authState=await window.TravelAuth.init();
    setAuthGateState(authState.state);
    if(authState.state==='ready'){
      if(window.TRAVEL_CONFIG?.tripSlug) await hydratePrivateCloudData();
      else await renderTripChooser();
    }else if(authState.state==='offline_ready'&&!window.TRAVEL_CONFIG?.tripSlug){
      await renderTripChooser();
    }
  }
}

qs('.app-shell')?.classList.add('today-mode');
const authTitle=qs('#authTripTitle');
if(authTitle) authTitle.textContent=`${APP_NAME} V${APP_VERSION}`;
if(window.TRAVEL_CONFIG?.tripSlug==='iceland-2026'){
  syncToReferenceTripDay(false,true);
  updateDemoModeUI();
  renderAll();
  updateHeroCollapse();
}else if(window.TRAVEL_CONFIG?.tripSlug){
  qs('.app-shell').style.visibility='hidden';
}
initCloudShell().finally(()=>{if(qs('.app-shell'))qs('.app-shell').style.visibility=''});
window.addEventListener('online',async()=>{
  if(!window.TRAVEL_CONFIG?.tripSlug) return;
  cloudSyncState='syncing';
  syncTripLabels();
  try{
    await window.TravelAuth?.resumeSessionCheck?.({keepReady:true});
    await flushOfflineEditorQueue();
    await hydratePrivateCloudData();
    updateEditAvailability();
  }catch(err){
    cloudLoaded=false;
    cloudSyncState='error';
    cloudLastError=String(err?.message||err||'Reconnect failed');
    syncTripLabels();
  }
});
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
