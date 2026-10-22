import {useCallback} from 'react';
import type {Session} from '@bookmark-ai/types';
import {deleteSession,listSessions} from '../api';
import {useCachedResource} from './useCachedResource';
export interface SessionsState {sessions:Session[];loading:boolean;refreshing:boolean;error:string|null;updatedAt:number|null;readOnly:boolean;refresh:()=>void;remove:(id:string)=>Promise<void>;}
export function useSessions():SessionsState{
 const resource=useCachedResource('sessions',listSessions);
 const remove=useCallback(async(id:string)=>{if(resource.readOnly||resource.error)throw new Error('Reconnect and restore sign-in before deleting sessions.');await deleteSession(id);resource.replace({sessions:(resource.data?.sessions??[]).filter(s=>s.id!==id)});},[resource.data,resource.readOnly,resource.error,resource.replace]);
 return {sessions:resource.data?.sessions??[],loading:resource.loading,refreshing:resource.refreshing,error:resource.error,updatedAt:resource.updatedAt,readOnly:resource.readOnly,refresh:resource.refresh,remove};
}
