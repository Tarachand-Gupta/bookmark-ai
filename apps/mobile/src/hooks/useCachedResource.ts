import {useCallback,useEffect,useRef,useState} from 'react';
import {AppState} from 'react-native';
import {useWorkspace} from '../context/WorkspaceContext';
import {mobileCache} from '../lib/mobile-cache';
export function useCachedResource<T>(resource:string,load:()=>Promise<T>,active=true,enabled=true){
 const {scope,readOnly}=useWorkspace(),identity=`${scope.accountId}:${scope.origin}:${resource}`;
 const initial=mobileCache.peek<T>(scope,resource);
 const [state,setState]=useState({identity,data:initial?.data??null as T|null,updatedAt:initial?.updatedAt??null as number|null,loading:!initial,refreshing:false,error:null as string|null});
 const aliveRef=useRef(true),identityRef=useRef(identity);identityRef.current=identity;
 const boundEpoch=mobileCache.epoch(scope);
 const [reload,setReload]=useState(0),loadRef=useRef(load);loadRef.current=load;const generation=useRef(0),liveUpdated=useRef(0),scopeRef=useRef(scope);scopeRef.current=scope;
 const refresh=useCallback(()=>setReload(n=>n+1),[]);
 useEffect(()=>{aliveRef.current=true;const id=++generation.current;liveUpdated.current=0;const cached=mobileCache.peek<T>(scope,resource);setState({identity,data:cached?.data??null,updatedAt:cached?.updatedAt??null,loading:!cached,refreshing:!readOnly&&enabled,error:null});const started=mobileCache.epoch(scope);let alive=true;
 void mobileCache.read<T>(scope,resource).then(snapshot=>{if(!alive||generation.current!==id||liveUpdated.current)return;setState(prev=>({...prev,data:snapshot?.data??null,updatedAt:snapshot?.updatedAt??null,loading:false}));}).catch(()=>{if(alive)setState(prev=>({...prev,loading:false}))});
 if(!readOnly&&enabled)void loadRef.current().then(async data=>{if(!alive||generation.current!==id)return;liveUpdated.current=Date.now();setState({identity,data,updatedAt:liveUpdated.current,loading:false,refreshing:false,error:null});await mobileCache.write(scope,resource,data,started,liveUpdated.current);}).catch(error=>{if(alive&&generation.current===id)setState(prev=>({...prev,loading:false,refreshing:false,error:error instanceof Error?error.message:'Could not refresh saved data.'}));});
 return()=>{alive=false;aliveRef.current=false;generation.current++};
 },[identity,reload,readOnly,enabled]);
 useEffect(()=>{if(active&&!readOnly&&state.updatedAt&&Date.now()-state.updatedAt>60000)refresh();},[active,readOnly]);
 useEffect(()=>{const sub=AppState.addEventListener('change',s=>{if(s==='active'&&active&&!readOnly)refresh()});return()=>sub.remove()},[active,readOnly,refresh]);
 const replace=useCallback((data:T)=>{if(!aliveRef.current||identityRef.current!==identity||boundEpoch!==mobileCache.epoch(scope))return;const currentScope=scope;setState(prev=>({...prev,data,updatedAt:Date.now(),error:null}));void mobileCache.write(currentScope,resource,data,boundEpoch);},[identity,resource,boundEpoch]);
 return {...(state.identity===identity?state:{identity,data:null,updatedAt:null,loading:true,refreshing:false,error:null}),readOnly,refresh,replace};
}
