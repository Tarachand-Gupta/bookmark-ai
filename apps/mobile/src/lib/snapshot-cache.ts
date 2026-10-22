export interface Snapshot<T>{version:1;data:T;updatedAt:number;}
export interface CacheScope{namespace:string;accountId:string;origin:string;}
export interface SnapshotStorage{getItem(key:string):Promise<string|null>;setItem(key:string,value:string):Promise<void>;getAllKeys():Promise<readonly string[]>;multiRemove(keys:readonly string[]):Promise<void>;}
export function snapshotPrefix(scope:CacheScope){return`${scope.namespace}:account:${scope.accountId}:${scope.origin}:snapshot:`;}
export function snapshotKey(scope:CacheScope,resource:string){return snapshotPrefix(scope)+resource;}
/** Age never removes a usable offline snapshot. Network results still win over
 * late disk reads, and invalidation prevents a late response restoring a logout. */
export function createSnapshotCache(storage:SnapshotStorage){
 const memory=new Map<string,Snapshot<unknown>>(),epochs=new Map<string,number>(),queues=new Map<string,Promise<unknown>>();
 const serial=<T>(scope:CacheScope,work:()=>Promise<T>):Promise<T>=>{const prefix=snapshotPrefix(scope);const task=(queues.get(prefix)??Promise.resolve()).catch(()=>undefined).then(work);queues.set(prefix,task);return task;};
 const epoch=(scope:CacheScope)=>epochs.get(snapshotPrefix(scope))??0;
 return {
  epoch,
  peek<T>(scope:CacheScope,resource:string):Snapshot<T>|null{return(memory.get(snapshotKey(scope,resource)) as Snapshot<T>)??null;},
  async read<T>(scope:CacheScope,resource:string):Promise<Snapshot<T>|null>{const key=snapshotKey(scope,resource),started=epoch(scope);const cached=memory.get(key) as Snapshot<T>|undefined;if(cached)return cached;const raw=await storage.getItem(key);if(started!==epoch(scope))return null;const newer=memory.get(key) as Snapshot<T>|undefined;if(newer)return newer;if(!raw)return null;try{const parsed=JSON.parse(raw) as Snapshot<T>;if(parsed.version!==1||!Number.isFinite(parsed.updatedAt)||!('data'in parsed))return null;const latest=memory.get(key) as Snapshot<T>|undefined;if(latest&&latest.updatedAt>=parsed.updatedAt)return latest;memory.set(key,parsed);return parsed;}catch{return null;}},
  async write<T>(scope:CacheScope,resource:string,data:T,started=epoch(scope),now=Date.now()):Promise<Snapshot<T>|null>{if(started!==epoch(scope))return null;const value:Snapshot<T>={version:1,data,updatedAt:now},key=snapshotKey(scope,resource);memory.set(key,value);return serial(scope,async()=>{if(started!==epoch(scope))return null;await storage.setItem(key,JSON.stringify(value));return started===epoch(scope)?value:null;});},
  async clear(scope:CacheScope){const prefix=snapshotPrefix(scope);epochs.set(prefix,epoch(scope)+1);for(const key of memory.keys())if(key.startsWith(prefix))memory.delete(key);await serial(scope,async()=>{const keys=(await storage.getAllKeys()).filter(key=>key.startsWith(prefix));if(keys.length)await storage.multiRemove(keys);});},
 };
}
/** Stable keys prevent filter-order differences from showing unrelated cached rows. */
export function resourceKey(name:string,filters:Record<string,unknown>={}){return`${name}:${JSON.stringify(Object.fromEntries(Object.entries(filters).filter(([,value])=>value!==undefined&&value!==null&&value!=='').sort(([a],[b])=>a.localeCompare(b))))}`;}
export interface OfflineAccount {id:string;origin:string;verifiedAt:number;name:string;email?:string;avatarUrl?:string;}
export function offlineAccountAllowed(marker:OfflineAccount|null,input:{origin:string;currentAccountId:string|null;explicitlyInvalidated:boolean;knownMfaRequired:boolean}):boolean{return !!marker&&marker.origin===input.origin&&!input.explicitlyInvalidated&&!input.knownMfaRequired&&(!input.currentAccountId||input.currentAccountId===marker.id);}
