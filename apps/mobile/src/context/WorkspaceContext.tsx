import {createContext,useContext,type ReactNode} from 'react';
import {getApiUrl} from '../api';
import {AUTH_NAMESPACE} from '../lib/auth-config';
import type {CacheScope} from '../lib/snapshot-cache';
export interface WorkspaceState{scope:CacheScope;readOnly:boolean;}
const Context=createContext<WorkspaceState|null>(null);
export function WorkspaceProvider({accountId,readOnly,children}:{accountId:string;readOnly:boolean;children:ReactNode}){return <Context.Provider value={{scope:{namespace:AUTH_NAMESPACE,accountId,origin:getApiUrl()},readOnly}}>{children}</Context.Provider>}
export function useWorkspace(){const value=useContext(Context);if(!value)throw new Error('WorkspaceProvider missing');return value;}
