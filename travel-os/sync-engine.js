(() => {
  class TravelSyncEngine {
    constructor(){
      this.state='local_only';
      this.lastSyncAt=null;
      this.listeners=new Set();
      this.online=navigator.onLine;
      window.addEventListener('online',()=>{this.online=true;this.emit();this.syncSoon();});
      window.addEventListener('offline',()=>{this.online=false;this.emit();});
    }
    onChange(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn)}
    emit(){for(const fn of this.listeners){try{fn(this.snapshot())}catch(_){}}}
    snapshot(){return {state:this.state,online:this.online,lastSyncAt:this.lastSyncAt}}
    async init(){
      this.state=await window.TravelStore?.getCloudState?.()||'local_only';
      this.emit();
      return this.snapshot();
    }
    async syncSoon(){
      if(this.state==='local_only') return this.snapshot();
      return this.snapshot();
    }
  }
  window.TravelSync=new TravelSyncEngine();
})();
