(() => {
  const DB_NAME='travel-os-local';
  const DB_VERSION=3;
  const DEVICE_KEY='travel-os-device-v1';
  const META_PREFIX='travel-os-meta:';
  const DB_OPEN_TIMEOUT=6000;

  function currentTripId(){return window.TRAVEL_CONFIG?.tripSlug||null}
  function clone(v){return JSON.parse(JSON.stringify(v))}
  function requestToPromise(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
  function txDone(tx){return new Promise((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted'))})}
  function withTimeout(promise,ms,label='timeout'){return Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error(label)),ms))])}

  function newDevice(){
    return {
      key:'current',
      device_public_id:crypto.randomUUID(),
      device_secret:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),
      label:(navigator.userAgentData?.platform||navigator.platform||'Browser')+' device',
      created_at:new Date().toISOString()
    };
  }
  function readLocalDevice(){
    try{
      const raw=localStorage.getItem(DEVICE_KEY);
      if(!raw)return null;
      const d=JSON.parse(raw);
      return d?.device_public_id&&d?.device_secret?d:null;
    }catch(_){return null}
  }
  function saveLocalDevice(device){
    try{localStorage.setItem(DEVICE_KEY,JSON.stringify(device))}catch(_){}
    return device;
  }
  function getFastDevice(){
    return readLocalDevice()||saveLocalDevice(newDevice());
  }
  function getFastMeta(key){
    try{const raw=localStorage.getItem(META_PREFIX+key);return raw===null?null:JSON.parse(raw)}catch(_){return null}
  }
  function setFastMeta(key,value){
    try{localStorage.setItem(META_PREFIX+key,JSON.stringify(value))}catch(_){}
    return value;
  }
  const TRIP_DIRECTORY_KEY='travel-os-trip-directory-v1';
  function readFastTripDirectory(){
    try{
      const rows=JSON.parse(localStorage.getItem(TRIP_DIRECTORY_KEY)||'[]');
      return Array.isArray(rows)?rows:[];
    }catch(_){return []}
  }
  function writeFastTripDirectory(rows){
    try{localStorage.setItem(TRIP_DIRECTORY_KEY,JSON.stringify(Array.isArray(rows)?rows:[]))}catch(_){}
    return rows;
  }
  function upsertFastTripDirectory(row){
    if(!row?.slug&&!row?.id)return readFastTripDirectory();
    const slug=row.slug||row.id;
    const rows=readFastTripDirectory().filter(x=>(x.slug||x.id)!==slug);
    rows.push({
      id:row.id||slug,slug,title:row.title||slug,start_date:row.start_date||row.startDate||null,
      end_date:row.end_date||row.endDate||null,timezone:row.timezone||'UTC',role:row.role||'viewer',
      source:row.source||'local',updated_at:row.updated_at||new Date().toISOString()
    });
    rows.sort((a,b)=>String(a.start_date||'').localeCompare(String(b.start_date||'')));
    writeFastTripDirectory(rows);
    return rows;
  }
  function removeFastTripDirectory(slug){
    writeFastTripDirectory(readFastTripDirectory().filter(x=>(x.slug||x.id)!==slug));
  }

  function openDb(){
    return new Promise((resolve,reject)=>{
      let settled=false;
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      const timer=setTimeout(()=>{
        if(settled)return;
        settled=true;
        reject(new Error('indexeddb_open_timeout'));
      },DB_OPEN_TIMEOUT);
      const done=(fn,value)=>{
        if(settled)return;
        settled=true;clearTimeout(timer);fn(value);
      };
      req.onblocked=()=>console.warn('Travel OS IndexedDB upgrade is blocked by another open tab; continuing without offline cache.');
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'});
        if(!db.objectStoreNames.contains('trips'))db.createObjectStore('trips',{keyPath:'id'});
        if(!db.objectStoreNames.contains('days')){
          const s=db.createObjectStore('days',{keyPath:'id'});
          s.createIndex('trip_id','trip_id',{unique:false});
          s.createIndex('trip_sort',['trip_id','sort_order'],{unique:false});
        }
        if(!db.objectStoreNames.contains('itinerary_items')){
          const s=db.createObjectStore('itinerary_items',{keyPath:'id'});
          s.createIndex('trip_id','trip_id',{unique:false});
          s.createIndex('day_sort',['day_id','sort_order'],{unique:false});
        }
        if(!db.objectStoreNames.contains('bookings')){
          const s=db.createObjectStore('bookings',{keyPath:'id'});
          s.createIndex('trip_id','trip_id',{unique:false});
        }
        if(!db.objectStoreNames.contains('sync_queue')){
          const s=db.createObjectStore('sync_queue',{keyPath:'op_id'});
          s.createIndex('status','status',{unique:false});
          s.createIndex('created_at','created_at',{unique:false});
        }
        if(!db.objectStoreNames.contains('conflicts')){
          const s=db.createObjectStore('conflicts',{keyPath:'id'});
          s.createIndex('trip_id','trip_id',{unique:false});
          s.createIndex('status','status',{unique:false});
        }
        if(!db.objectStoreNames.contains('device'))db.createObjectStore('device',{keyPath:'key'});
      };
      req.onsuccess=()=>{
        const db=req.result;
        db.onversionchange=()=>{try{db.close()}catch(_){}};
        done(resolve,db);
      };
      req.onerror=()=>done(reject,req.error||new Error('indexeddb_open_failed'));
    });
  }

  async function migrateDeviceFromDb(db){
    const local=readLocalDevice();
    if(local)return local;
    try{
      const tx=db.transaction('device','readonly');
      const row=await requestToPromise(tx.objectStore('device').get('current'));
      await txDone(tx);
      if(row?.device_public_id&&row?.device_secret)return saveLocalDevice(row);
    }catch(_){}
    return getFastDevice();
  }

  async function getAllFromIndex(db,storeName,indexName,key){
    const tx=db.transaction(storeName,'readonly');
    const rows=await requestToPromise(tx.objectStore(storeName).index(indexName).getAll(key));
    await txDone(tx);return rows;
  }
  async function deleteByIndex(store,index,key){
    const req=index.openCursor(IDBKeyRange.only(key));
    await new Promise((resolve,reject)=>{
      req.onsuccess=()=>{const cursor=req.result;if(!cursor){resolve();return}cursor.delete();cursor.continue()};
      req.onerror=()=>reject(req.error);
    });
  }
  async function getMeta(db,key){
    const tx=db.transaction('meta','readonly');
    const row=await requestToPromise(tx.objectStore('meta').get(key));
    await txDone(tx);return row?.value;
  }
  async function setMeta(db,key,value){
    const tx=db.transaction('meta','readwrite');
    tx.objectStore('meta').put({key,value,updated_at:new Date().toISOString()});
    await txDone(tx);
  }

  async function seedIfNeeded(db,seedTrip){
    const tripId=currentTripId();
    if(!tripId||!seedTrip?.days?.length)return false;
    const seedKey='seed_version:'+tripId;
    const seeded=await getMeta(db,seedKey);
    if(seeded==='release-1.1-fallback')return false;
    const existing=await loadTrip(db,tripId);
    if(existing?.source==='cloud')return false;

    const tx=db.transaction(['meta','trips','days','itinerary_items'],'readwrite');
    const now=new Date().toISOString();
    await deleteByIndex(tx.objectStore('days'),tx.objectStore('days').index('trip_id'),tripId);
    await deleteByIndex(tx.objectStore('itinerary_items'),tx.objectStore('itinerary_items').index('trip_id'),tripId);
    tx.objectStore('trips').put({
      id:tripId,slug:tripId,title:seedTrip.title,start_date:seedTrip.days[0]?.date||null,
      end_date:seedTrip.days.at(-1)?.date||null,timezone:'Atlantic/Reykjavik',
      version:1,updated_at:now,deleted_at:null,source:'fallback'
    });
    seedTrip.days.forEach((day,dayIndex)=>{
      const dayId=`${tripId}-fallback-day-${dayIndex}`;
      tx.objectStore('days').put({
        id:dayId,trip_id:tripId,date:day.date,label:day.label,short:day.short,name:day.name,
        km:day.km,drive:day.drive,driveMinutes:day.driveMinutes||0,heroImageUrl:null,sunrise:null,sunset:null,
        sort_order:dayIndex,version:1,updated_at:now,deleted_at:null
      });
      (day.events||[]).forEach((event,eventIndex)=>tx.objectStore('itinerary_items').put({
        id:`${tripId}-fallback-event-${dayIndex}-${eventIndex}`,trip_id:tripId,day_id:dayId,
        sort_order:eventIndex,payload:clone(event),version:1,updated_at:now,deleted_at:null
      }));
    });
    tx.objectStore('meta').put({key:seedKey,value:'release-1.1-fallback',updated_at:now});
    await txDone(tx);return true;
  }

  async function loadTrip(db,tripId=currentTripId()){
    if(!tripId)return null;
    const tx=db.transaction('trips','readonly');
    const tripRow=await requestToPromise(tx.objectStore('trips').get(tripId));
    await txDone(tx);
    if(!tripRow)return null;
    const days=(await getAllFromIndex(db,'days','trip_id',tripId)).filter(x=>!x.deleted_at).sort((a,b)=>a.sort_order-b.sort_order);
    const items=(await getAllFromIndex(db,'itinerary_items','trip_id',tripId)).filter(x=>!x.deleted_at);
    const bookings=(await getAllFromIndex(db,'bookings','trip_id',tripId)).filter(x=>!x.deleted_at).sort((a,b)=>a.sort_order-b.sort_order).map(x=>clone(x.payload));
    return {
      id:tripRow.id,slug:tripRow.slug||tripRow.id,title:tripRow.title,timezone:tripRow.timezone,
      startDate:tripRow.start_date,endDate:tripRow.end_date,settings:tripRow.settings||{},role:tripRow.role||null,source:tripRow.source||'local',
      days:days.map(day=>({
        id:day.id,date:day.date,label:day.label,short:day.short||'',name:day.name,km:day.km,
        drive:day.drive,driveMinutes:day.driveMinutes,heroImageUrl:day.heroImageUrl,
        sunrise:day.sunrise,sunset:day.sunset,version:day.version,
        events:items.filter(i=>i.day_id===day.id).sort((a,b)=>a.sort_order-b.sort_order).map(i=>clone(i.payload))
      })),
      bookings
    };
  }

  async function replaceTrip(db,payload){
    const tripId=payload?.trip?.slug||currentTripId();
    if(!tripId)throw new Error('trip_required');
    const now=new Date().toISOString();
    const tx=db.transaction(['trips','days','itinerary_items','bookings','meta'],'readwrite');
    await deleteByIndex(tx.objectStore('days'),tx.objectStore('days').index('trip_id'),tripId);
    await deleteByIndex(tx.objectStore('itinerary_items'),tx.objectStore('itinerary_items').index('trip_id'),tripId);
    await deleteByIndex(tx.objectStore('bookings'),tx.objectStore('bookings').index('trip_id'),tripId);
    tx.objectStore('trips').put({
      id:tripId,slug:tripId,title:payload.trip.title,timezone:payload.trip.timezone,
      start_date:payload.trip.startDate,end_date:payload.trip.endDate,settings:payload.trip.settings||{},role:payload.role||null,
      version:payload.trip.version||1,updated_at:now,deleted_at:null,source:'cloud'
    });
    (payload.days||[]).forEach((day,dayIndex)=>{
      const dayId=day.id||`${tripId}-day-${dayIndex}`;
      tx.objectStore('days').put({
        id:dayId,trip_id:tripId,date:day.date,label:day.label,short:day.short||'',name:day.name,
        km:Number(day.km)||0,drive:day.drive||'',driveMinutes:Number(day.driveMinutes)||0,
        heroImageUrl:day.heroImageUrl||null,sunrise:day.sunrise||null,sunset:day.sunset||null,
        sort_order:dayIndex,version:day.version||1,updated_at:now,deleted_at:null
      });
      (day.events||[]).forEach((event,eventIndex)=>tx.objectStore('itinerary_items').put({
        id:event.id||`${tripId}-event-${dayIndex}-${eventIndex}`,trip_id:tripId,day_id:dayId,
        sort_order:Number(event.sortOrder??eventIndex),payload:clone(event),version:event.version||1,updated_at:now,deleted_at:null
      }));
    });
    (payload.bookings||[]).forEach((booking,index)=>tx.objectStore('bookings').put({
      id:booking.id||`${tripId}-booking-${index}`,trip_id:tripId,sort_order:index,
      payload:clone(booking),version:booking.version||1,updated_at:now,deleted_at:null
    }));
    tx.objectStore('meta').put({key:'cloud_state:'+tripId,value:'trusted_device',updated_at:now});
    tx.objectStore('meta').put({key:'last_sync:'+tripId,value:now,updated_at:now});
    await txDone(tx);
    setFastMeta('cloud_state:'+tripId,'trusted_device');
    setFastMeta('last_sync:'+tripId,now);
    upsertFastTripDirectory({
      id:tripId,slug:tripId,title:payload.trip.title,timezone:payload.trip.timezone,
      start_date:payload.trip.startDate,end_date:payload.trip.endDate,role:payload.role||null,
      source:'cloud',updated_at:now
    });
    return loadTrip(db,tripId);
  }

  async function queueOperation(db,{entity_type,entity_id,action='update',base_version=1,patch={}}){
    const tripId=currentTripId();if(!tripId)throw new Error('trip_required');
    const tx=db.transaction('sync_queue','readwrite');
    const store=tx.objectStore('sync_queue');
    const all=await requestToPromise(store.getAll());
    // Coalesce repeated offline edits of the same entity/action to the latest state.
    // This avoids replaying several updates with the same server baseVersion.
    (all||[]).filter(x=>x.trip_id===tripId&&x.status==='pending'&&x.entity_type===entity_type&&x.entity_id===entity_id&&x.action===action)
      .forEach(x=>store.delete(x.op_id));
    const op={op_id:crypto.randomUUID(),trip_id:tripId,entity_type,entity_id,action,base_version,patch:clone(patch),status:'pending',created_at:new Date().toISOString(),attempts:0};
    store.put(op);await txDone(tx);return op;
  }
  async function getPendingOperations(db){
    const tx=db.transaction('sync_queue','readonly');
    const rows=await requestToPromise(tx.objectStore('sync_queue').index('status').getAll('pending'));
    await txDone(tx);return rows.sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
  }
  async function completeOperation(db,opId){
    const tx=db.transaction('sync_queue','readwrite');
    tx.objectStore('sync_queue').delete(opId);
    await txDone(tx);
  }
  async function updateOperation(db,opId,patch){
    const tx=db.transaction('sync_queue','readwrite');
    const store=tx.objectStore('sync_queue');
    const row=await requestToPromise(store.get(opId));
    if(row)store.put({...row,...clone(patch)});
    await txDone(tx);
  }
  async function listTrips(db){
    const fast=readFastTripDirectory();
    if(!db)return fast;
    let rows=[];
    try{
      const tx=db.transaction('trips','readonly');
      rows=await requestToPromise(tx.objectStore('trips').getAll());
      await txDone(tx);
    }catch(err){
      console.warn('IndexedDB trip directory read failed; using fast directory',err);
      return fast;
    }
    const mapped=(rows||[]).filter(x=>!x.deleted_at).map(x=>({
      id:x.id,slug:x.slug||x.id,title:x.title,start_date:x.start_date,end_date:x.end_date,
      timezone:x.timezone,role:x.role||'viewer',source:x.source||'local',updated_at:x.updated_at
    }));
    const merged=new Map(fast.map(x=>[x.slug||x.id,x]));
    mapped.forEach(x=>merged.set(x.slug||x.id,x));
    const result=[...merged.values()].sort((a,b)=>String(a.start_date||'').localeCompare(String(b.start_date||'')));
    writeFastTripDirectory(result);
    return result;
  }
  async function saveUiTrip(db,trip){
    if(!trip?.slug&&!currentTripId())throw new Error('trip_required');
    return replaceTrip(db,{
      trip:{
        slug:trip.slug||currentTripId(),title:trip.title||'Travel OS',timezone:trip.timezone||'UTC',
        startDate:trip.startDate||trip.days?.[0]?.date||null,endDate:trip.endDate||trip.days?.at(-1)?.date||null,
        settings:trip.settings||{},version:trip.version||1
      },
      role:trip.role||null,
      days:clone(trip.days||[]),
      bookings:clone(trip.bookings||[])
    });
  }

  let dbPromise=null;
  async function dbOrNull(){
    if(!('indexedDB' in window))return null;
    if(!dbPromise){
      dbPromise=openDb().catch(err=>{
        console.warn('Travel OS offline cache unavailable',err);
        dbPromise=null;
        return null;
      });
    }
    const db=await dbPromise;
    if(!db)dbPromise=null;
    return db;
  }

  const api={
    async init(seedTrip){
      const device=getFastDevice();
      const db=await dbOrNull();
      if(!db)return {trip:seedTrip?clone(seedTrip):null,device,mode:'memory'};
      await migrateDeviceFromDb(db);
      try{if(currentTripId())await withTimeout(seedIfNeeded(db,seedTrip),1500,'seed_timeout')}catch(err){console.warn('Offline seed skipped',err)}
      let trip=null;try{trip=await withTimeout(loadTrip(db),1500,'load_trip_timeout')}catch(err){console.warn('Offline trip load skipped',err)}
      return {trip,device:getFastDevice(),mode:'indexeddb'};
    },
    async getTrip(tripId){
      const db=await dbOrNull();if(!db)return null;
      try{return await withTimeout(loadTrip(db,tripId||currentTripId()),1800,'load_trip_timeout')}catch(_){return null}
    },
    async listTrips(){
      const fast=readFastTripDirectory();
      const db=await dbOrNull();
      if(!db)return fast;
      try{
        const rows=await withTimeout(listTrips(db),4500,'list_trips_timeout');
        return rows?.length?rows:fast;
      }catch(_){return fast}
    },
    async saveUiTrip(trip){
      const db=await dbOrNull();if(!db)return null;
      return withTimeout(saveUiTrip(db,trip),2500,'save_ui_trip_timeout');
    },
    async replaceTrip(payload){
      const db=await dbOrNull();if(!db)return null;
      return withTimeout(replaceTrip(db,payload),2200,'replace_trip_timeout');
    },
    async clearTrip(tripId){
      const id=tripId||currentTripId();if(!id)return;
      try{localStorage.removeItem(META_PREFIX+'cloud_state:'+id);localStorage.removeItem(META_PREFIX+'last_sync:'+id)}catch(_){}
      removeFastTripDirectory(id);
      const db=await dbOrNull();if(!db)return;
      const tx=db.transaction(['trips','days','itinerary_items','bookings','sync_queue','conflicts','meta'],'readwrite');
      await deleteByIndex(tx.objectStore('days'),tx.objectStore('days').index('trip_id'),id);
      await deleteByIndex(tx.objectStore('itinerary_items'),tx.objectStore('itinerary_items').index('trip_id'),id);
      await deleteByIndex(tx.objectStore('bookings'),tx.objectStore('bookings').index('trip_id'),id);
      tx.objectStore('trips').delete(id);
      tx.objectStore('meta').delete('cloud_state:'+id);
      tx.objectStore('meta').delete('last_sync:'+id);
      const syncStore=tx.objectStore('sync_queue');
      const syncRows=await requestToPromise(syncStore.getAll());
      syncRows.filter(x=>x.trip_id===id).forEach(x=>syncStore.delete(x.op_id));
      const conflictStore=tx.objectStore('conflicts');
      const conflictRows=await requestToPromise(conflictStore.getAll());
      conflictRows.filter(x=>x.trip_id===id).forEach(x=>conflictStore.delete(x.id));
      await txDone(tx);
    },
    async getDevice(){return getFastDevice()},
    async getCloudState(){
      const id=currentTripId();if(!id)return null;
      const fast=getFastMeta('cloud_state:'+id);if(fast!==null)return fast;
      const db=await dbOrNull();if(!db)return null;
      try{const value=await withTimeout(getMeta(db,'cloud_state:'+id),1000,'meta_timeout');if(value!==undefined)setFastMeta('cloud_state:'+id,value);return value??null}catch(_){return null}
    },
    async setCloudState(value){
      const id=currentTripId();if(!id)return null;
      setFastMeta('cloud_state:'+id,value);
      const db=await dbOrNull();if(db)setMeta(db,'cloud_state:'+id,value).catch(()=>{});
      return value;
    },
    async getLastSync(){
      const id=currentTripId();if(!id)return null;
      const fast=getFastMeta('last_sync:'+id);if(fast!==null)return fast;
      const db=await dbOrNull();if(!db)return null;
      try{return await withTimeout(getMeta(db,'last_sync:'+id),1000,'meta_timeout')}catch(_){return null}
    },
    async queueOperation(op){const db=await dbOrNull();if(!db)throw new Error('offline_cache_unavailable');return queueOperation(db,op)},
    async getPendingOperations(){const db=await dbOrNull();if(!db)return [];return getPendingOperations(db)},
    async completeOperation(opId){const db=await dbOrNull();if(!db)return;return completeOperation(db,opId)},
    async updateOperation(opId,patch){const db=await dbOrNull();if(!db)return;return updateOperation(db,opId,patch)},
    get currentTripId(){return currentTripId()},
    dbName:DB_NAME
  };
  window.TravelStore=api;
})();