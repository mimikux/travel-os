(() => {
  const DB_NAME = 'travel-os-local';
  const DB_VERSION = 1;
  const CURRENT_TRIP_ID = 'iceland-2026';

  function requestToPromise(req){
    return new Promise((resolve,reject)=>{
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }

  function txDone(tx){
    return new Promise((resolve,reject)=>{
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error);
      tx.onabort=()=>reject(tx.error||new Error('IndexedDB transaction aborted'));
    });
  }

  function openDb(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains('meta')) db.createObjectStore('meta',{keyPath:'key'});
        if(!db.objectStoreNames.contains('trips')) db.createObjectStore('trips',{keyPath:'id'});
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
        if(!db.objectStoreNames.contains('device')) db.createObjectStore('device',{keyPath:'key'});
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });
  }

  function clone(v){return JSON.parse(JSON.stringify(v));}

  function stableEventId(dayLabel,index){return `${CURRENT_TRIP_ID}-event-${String(dayLabel).toLowerCase()}-${index}`;}
  function stableBookingId(index){return `${CURRENT_TRIP_ID}-booking-${index}`;}

  async function seedIfNeeded(db,seedTrip){
    const tx=db.transaction(['meta','trips','days','itinerary_items','bookings'],'readwrite');
    const meta=tx.objectStore('meta');
    const seeded=await requestToPromise(meta.get('seed_version'));
    if(seeded){await txDone(tx);return false;}

    const now=new Date().toISOString();
    tx.objectStore('trips').put({
      id:CURRENT_TRIP_ID,
      title:seedTrip.title,
      start_date:seedTrip.days?.[0]?.date||null,
      end_date:seedTrip.days?.[seedTrip.days.length-1]?.date||null,
      timezone:'Atlantic/Reykjavik',
      version:1,
      updated_at:now,
      deleted_at:null
    });

    seedTrip.days.forEach((day,dayIndex)=>{
      const dayId=`${CURRENT_TRIP_ID}-day-${String(day.label).toLowerCase()}`;
      tx.objectStore('days').put({
        id:dayId,
        trip_id:CURRENT_TRIP_ID,
        date:day.date,
        label:day.label,
        short:day.short,
        name:day.name,
        km:day.km,
        drive:day.drive,
        sort_order:dayIndex,
        version:1,
        updated_at:now,
        deleted_at:null
      });
      (day.events||[]).forEach((event,eventIndex)=>{
        tx.objectStore('itinerary_items').put({
          id:stableEventId(day.label,eventIndex),
          trip_id:CURRENT_TRIP_ID,
          day_id:dayId,
          sort_order:eventIndex,
          payload:clone(event),
          version:1,
          updated_at:now,
          deleted_at:null
        });
      });
    });

    (seedTrip.bookings||[]).forEach((booking,index)=>{
      tx.objectStore('bookings').put({
        id:stableBookingId(index),
        trip_id:CURRENT_TRIP_ID,
        sort_order:index,
        payload:clone(booking),
        version:1,
        updated_at:now,
        deleted_at:null
      });
    });

    meta.put({key:'seed_version',value:'v1-alpha-seed-1',updated_at:now});
    meta.put({key:'cloud_state',value:'local_only',updated_at:now});
    await txDone(tx);
    return true;
  }

  async function ensureDevice(db){
    const tx=db.transaction('device','readwrite');
    const store=tx.objectStore('device');
    let device=await requestToPromise(store.get('current'));
    if(!device){
      device={
        key:'current',
        device_public_id:crypto.randomUUID(),
        device_secret:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),
        label:(navigator.userAgentData?.platform||navigator.platform||'Browser')+' device',
        created_at:new Date().toISOString(),
        approval_status:'local_only'
      };
      store.put(device);
    }
    await txDone(tx);
    return device;
  }

  async function getAllFromIndex(db,storeName,indexName,key){
    const tx=db.transaction(storeName,'readonly');
    const index=tx.objectStore(storeName).index(indexName);
    const rows=await requestToPromise(index.getAll(key));
    await txDone(tx);
    return rows;
  }

  async function loadTrip(db,tripId=CURRENT_TRIP_ID){
    const tx=db.transaction('trips','readonly');
    const tripRow=await requestToPromise(tx.objectStore('trips').get(tripId));
    await txDone(tx);
    if(!tripRow) return null;

    const days=(await getAllFromIndex(db,'days','trip_id',tripId))
      .filter(x=>!x.deleted_at)
      .sort((a,b)=>a.sort_order-b.sort_order);
    const allItems=(await getAllFromIndex(db,'itinerary_items','trip_id',tripId))
      .filter(x=>!x.deleted_at);
    const bookings=(await getAllFromIndex(db,'bookings','trip_id',tripId))
      .filter(x=>!x.deleted_at)
      .sort((a,b)=>a.sort_order-b.sort_order)
      .map(x=>clone(x.payload));

    return {
      title:tripRow.title,
      days:days.map(day=>({
        date:day.date,label:day.label,short:day.short,name:day.name,km:day.km,drive:day.drive,
        events:allItems.filter(i=>i.day_id===day.id).sort((a,b)=>a.sort_order-b.sort_order).map(i=>clone(i.payload))
      })),
      bookings
    };
  }

  async function getMeta(db,key){
    const tx=db.transaction('meta','readonly');
    const row=await requestToPromise(tx.objectStore('meta').get(key));
    await txDone(tx);
    return row?.value;
  }

  async function setMeta(db,key,value){
    const tx=db.transaction('meta','readwrite');
    tx.objectStore('meta').put({key,value,updated_at:new Date().toISOString()});
    await txDone(tx);
  }

  async function queueOperation(db,{entity_type,entity_id,action='update',base_version=1,patch={}}){
    const op={
      op_id:crypto.randomUUID(),trip_id:CURRENT_TRIP_ID,
      entity_type,entity_id,action,base_version,patch:clone(patch),
      status:'pending',created_at:new Date().toISOString(),attempts:0
    };
    const tx=db.transaction('sync_queue','readwrite');
    tx.objectStore('sync_queue').put(op);
    await txDone(tx);
    return op;
  }

  async function getPendingOperations(db){
    const tx=db.transaction('sync_queue','readonly');
    const rows=await requestToPromise(tx.objectStore('sync_queue').index('status').getAll('pending'));
    await txDone(tx);
    return rows.sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
  }

  let dbPromise=null;
  const api={
    async init(seedTrip){
      if(!('indexedDB' in window)) return {trip:clone(seedTrip),device:null,mode:'memory'};
      dbPromise=dbPromise||openDb();
      const db=await dbPromise;
      await seedIfNeeded(db,seedTrip);
      const device=await ensureDevice(db);
      const trip=await loadTrip(db);
      return {trip:trip||clone(seedTrip),device,mode:'indexeddb'};
    },
    async getTrip(){const db=await (dbPromise||openDb());return loadTrip(db);},
    async getDevice(){const db=await (dbPromise||openDb());return ensureDevice(db);},
    async getCloudState(){const db=await (dbPromise||openDb());return getMeta(db,'cloud_state');},
    async setCloudState(value){const db=await (dbPromise||openDb());return setMeta(db,'cloud_state',value);},
    async queueOperation(op){const db=await (dbPromise||openDb());return queueOperation(db,op);},
    async getPendingOperations(){const db=await (dbPromise||openDb());return getPendingOperations(db);},
    currentTripId:CURRENT_TRIP_ID,
    dbName:DB_NAME
  };
  window.TravelStore=api;
})();
