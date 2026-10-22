import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {mobileCache} from '../lib/mobile-cache';
import * as Crypto from 'expo-crypto';
import type {OrganizationOperation,OrganizationResponse} from '@bookmark-ai/types';
import {ApiRequestError,getAccountIdentity,getOrganization,getOrganizationOperation,request} from '../api';
import {newOrganizationJob,runOrganizationJob,type OrganizationJob,type OrganizationRequest} from '../lib/organization-jobs';
import {useWorkspace} from './WorkspaceContext';
import {useCachedResource} from '../hooks/useCachedResource';
interface State {data:OrganizationResponse|null;accountId:string|null;error:string|null;offline:boolean;updatedAt:number|null;refreshing:boolean;revision:number;jobs:OrganizationJob[];running:string|null;refresh:()=>void;execute:(label:string,requests:OrganizationRequest[])=>Promise<OrganizationJob>;resume:(id:string)=>Promise<OrganizationJob|undefined>;pause:()=>void;changed:()=>void;}
const Context=createContext<State|null>(null);
export function OrganizationProvider({children}:{children:ReactNode}){
 const workspace=useWorkspace(),{scope,readOnly}=workspace;
 const resource=useCachedResource('organization',getOrganization);
 const identity=useCachedResource('identity',getAccountIdentity);
 const [revision,setRevision]=useState(0),[jobs,setJobs]=useState<OrganizationJob[]>([]),[running,setRunning]=useState<string|null>(null),[loaded,setLoaded]=useState(false);
 const alive=useRef(true),busy=useRef(false),pauseRequested=useRef(false),jobRef=useRef<OrganizationJob[]>([]);
 const storage=`${scope.accountId}:${scope.origin}:organization-jobs`,epoch=useRef(mobileCache.epoch(scope));
 const offline=readOnly||!!resource.error||!!identity.error;
 const writable=useRef(!offline);writable.current=!offline;
 useEffect(()=>{alive.current=true;let current=true;setLoaded(false);void mobileCache.read<OrganizationJob[]>(scope,'organization-jobs').then(snapshot=>{if(!current)return;const restored=(snapshot?.data??[]).filter(j=>j&&Array.isArray(j.requests)).map(j=>j.status==='running'?{...j,status:'uncertain' as const}:j);jobRef.current=restored;setJobs(restored);setLoaded(true);}).catch(()=>{if(current)setLoaded(false)});return()=>{current=false;alive.current=false;pauseRequested.current=true;};},[storage]);
 const refresh=useCallback(()=>{resource.refresh();identity.refresh()},[resource.refresh,identity.refresh]);
 const save=useCallback(async(job:OrganizationJob)=>{if(!alive.current||epoch.current!==mobileCache.epoch(scope))throw new Error('The account changed. Reopen Recent changes for this account.');const all=[job,...jobRef.current.filter(j=>j.id!==job.id)],next=[...all.filter(j=>j.status!=='completed'),...all.filter(j=>j.status==='completed').slice(0,100)];const saved=await mobileCache.write(scope,'organization-jobs',next,epoch.current);if(!saved||!alive.current)throw new Error('The account changed. Reopen Recent changes for this account.');jobRef.current=next;setJobs(next);},[storage]);
 const run=useCallback(async(job:OrganizationJob)=>{if(!writable.current)throw new Error('Reconnect and restore sign-in before changing your library. Saved data remains available.');if(busy.current)throw new Error('Finish or pause the current change first.');if(!loaded)throw new Error('Account recovery is still loading. Try again.');busy.current=true;pauseRequested.current=false;setRunning(job.id);try{return await runOrganizationJob(job,{save,send:async r=>{if(!writable.current||!alive.current)throw new Error('Reconnect before continuing this change.');return(await request<{operation:OrganizationOperation}>(r.path,{method:r.method,body:r.body})).operation;},reconcile:async id=>{try{return(await getOrganizationOperation(id)).operation}catch(e){if(e instanceof ApiRequestError&&e.status===404)return null;throw e}}},()=>pauseRequested.current||!alive.current);}finally{busy.current=false;if(alive.current){setRunning(null);setRevision(n=>n+1);refresh();}}},[save,loaded,refresh]);
 const execute=useCallback((label:string,requests:OrganizationRequest[])=>run(newOrganizationJob(label,requests,Crypto.randomUUID())),[run]);
 const resume=useCallback(async(id:string)=>{const job=jobRef.current.find(j=>j.id===id);return job?run(job):undefined;},[run]);
 return <Context.Provider value={{data:resource.data,accountId:identity.data?.accountId===scope.accountId?scope.accountId:null,error:resource.error,offline,updatedAt:resource.updatedAt,refreshing:resource.refreshing,revision,jobs,running,refresh,execute,resume,pause:()=>{pauseRequested.current=true},changed:()=>{setRevision(n=>n+1);refresh();}}}>{children}</Context.Provider>;
}
export function useOrganization(){const value=useContext(Context);if(!value)throw new Error('OrganizationProvider missing');return value;}
export function operationRequest(body:Record<string,unknown>):OrganizationRequest{return{path:'/api/organization/operations',method:'POST',body:{...body,operationId:Crypto.randomUUID()}}}
